#!/usr/bin/env bash
# Iter 162 — Coqui TTS install for the Sound Board's voice-cloning
# engine. Sets up a self-contained Python venv at
# /opt/dialeros/.coqui-venv, installs the Coqui TTS package, and
# pre-loads the XTTS-v2 model (~1.8GB) so the first runtime call
# doesn't pay the model-fetch latency.
#
# XTTS-v2 voice cloning works zero-shot from a 6-15 second audio
# sample — the operator records or uploads a reference clip via
# the Sound Board, then picks it as the "clone source" when
# generating TTS audio.
#
# LICENSE NOTE: XTTS-v2 ships under the Coqui Public Model License
# (CPML), which is NOT a permissive commercial license — it
# permits non-commercial / research use plus commercial use with
# Coqui's consent (see model card on Hugging Face). For
# commercial deployment, either:
#   (a) reach a license agreement with Coqui
#   (b) swap the model in /opt/dialeros/coqui-tts-daemon.py to a
#       permissive alternative like
#       "tts_models/en/ljspeech/vits" (MPL 2.0) — no cloning,
#       but natural-sounding single-speaker output.
# The Coqui TTS Python package itself is MPL 2.0.
#
# Idempotent. Re-running:
#   - keeps the existing venv
#   - skips already-cached model files
#
# Resource budget (verified on the 5.8GB dialeros.voipzap.com box):
#   - venv on disk:  ~1.5GB (torch CPU wheels)
#   - model:          ~1.8GB
#   - RAM resident:   ~3GB once daemon's loaded
# A systemd MemoryMax=4G cap on dialeros-coqui-tts.service protects
# the rest of the stack from OOM.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (use sudo)" >&2
  exit 1
fi

VENV_DIR=/opt/dialeros/.coqui-venv
CACHE_DIR=/var/lib/dialeros/ai/coqui-cache
DAEMON_USER=dialeros

echo "[install-coqui] checking deps"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  python3-venv python3-pip libsndfile1 espeak-ng >/dev/null

# Cache dir for model downloads — owned by the daemon user so it
# can write fresh model versions without sudo.
mkdir -p "${CACHE_DIR}"
chown -R "${DAEMON_USER}:${DAEMON_USER}" "${CACHE_DIR}"

if [ -d "${VENV_DIR}" ]; then
  echo "[install-coqui] venv already at ${VENV_DIR}, reusing"
else
  echo "[install-coqui] creating venv ${VENV_DIR}"
  python3 -m venv "${VENV_DIR}"
  chown -R "${DAEMON_USER}:${DAEMON_USER}" "${VENV_DIR}"
fi

PIP="${VENV_DIR}/bin/pip"

# torch CPU wheels are ~600MB. Pin to a known-good version. Coqui
# TTS pulls in transformers/numpy/scipy etc. — total venv ~1.5GB.
echo "[install-coqui] upgrading pip + installing TTS (this can take 5-10 min)"
sudo -u "${DAEMON_USER}" -H "${PIP}" install --upgrade pip setuptools wheel >/dev/null
sudo -u "${DAEMON_USER}" -H "${PIP}" install \
  --extra-index-url https://download.pytorch.org/whl/cpu \
  torch==2.1.2 torchaudio==2.1.2 >/dev/null

# Pin Coqui TTS to a release that's known to load XTTS-v2 cleanly.
# Newer versions of TTS sometimes break the model loader's import
# path; 0.22.0 is the last stable on the original Coqui repo.
sudo -u "${DAEMON_USER}" -H "${PIP}" install TTS==0.22.0 >/dev/null

# Aiohttp for the daemon's HTTP layer (small, ~3MB).
sudo -u "${DAEMON_USER}" -H "${PIP}" install aiohttp >/dev/null

# Preload the XTTS-v2 model into the cache so the first daemon
# start doesn't pay the download latency. Coqui's TTS class fetches
# on construct; we drive that here as the daemon user with the
# same TTS_HOME the daemon will use at runtime.
echo "[install-coqui] preloading XTTS-v2 model (~1.8GB; one-time)"
sudo -u "${DAEMON_USER}" -H \
  TTS_HOME="${CACHE_DIR}" \
  COQUI_TOS_AGREED=1 \
  "${VENV_DIR}/bin/python" - <<'PYEOF' || true
import os
os.environ.setdefault("TTS_HOME", "/var/lib/dialeros/ai/coqui-cache")
os.environ.setdefault("COQUI_TOS_AGREED", "1")
from TTS.api import TTS
print("[install-coqui] downloading tts_models/multilingual/multi-dataset/xtts_v2 ...")
tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False, gpu=False)
print("[install-coqui] model loaded; cache populated at", os.environ["TTS_HOME"])
PYEOF

echo "[install-coqui] done."
echo
echo "Next steps:"
echo "  1. Install the systemd unit:"
echo "       cp /opt/dialeros/infra/systemd/dialeros-coqui-tts.service \\"
echo "          /etc/systemd/system/"
echo "  2. Start the daemon:"
echo "       systemctl daemon-reload"
echo "       systemctl enable --now dialeros-coqui-tts"
echo "  3. Smoke test:"
echo "       curl -fsS http://127.0.0.1:11123/health"
echo "  4. The Sound Board TTS card will auto-detect the daemon."
