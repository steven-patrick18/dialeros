#!/usr/bin/env bash
# Iter 151 — install piper-tts.
# Iter 161 — extended to install 5 voices (low/medium/high quality
# tiers) instead of just amy-medium. Operators can drop additional
# .onnx + .onnx.json files into /var/lib/dialeros/ai/piper-voices
# at any time; the Sound Board TTS card enumerates the dir on each
# page load.
#
# Iter 162 will layer Coqui XTTS-v2 on top for voice cloning, which
# requires Python + PyTorch + ~3GB RAM for the model. Until then,
# the libritts-high + ryan-high + lessac-high voices below are the
# best you can get from CPU-only inference at ~RTF 0.15.
#
# Idempotent. Re-running is safe — existing binary + voices are
# preserved.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (use sudo)" >&2
  exit 1
fi

PIPER_VERSION="2023.11.14-2"
PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz"
PIPER_DIR=/usr/local/share/piper
PIPER_BIN=/usr/local/bin/piper
VOICES_DIR=/var/lib/dialeros/ai/piper-voices

# Voice catalog: { name -> hf-base-url-path }
# Naming: <lang>-<speaker>-<quality>
# Quality tiers:
#   x_low / low  ~10-20MB, fast, robotic
#   medium       ~60MB, balanced (iter 151 default was amy-medium)
#   high         ~100-130MB, slower, MUCH more natural
declare -A VOICES=(
  [en_US-amy-medium]="en/en_US/amy/medium"
  [en_US-libritts-high]="en/en_US/libritts/high"
  [en_US-ryan-high]="en/en_US/ryan/high"
  [en_US-lessac-high]="en/en_US/lessac/high"
  [en_GB-alba-medium]="en/en_GB/alba/medium"
)
HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"

echo "[install-piper] checking deps"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl ca-certificates xz-utils tar >/dev/null

if [ -x "${PIPER_BIN}" ]; then
  echo "[install-piper] piper already installed at ${PIPER_BIN}, skipping binary install"
else
  echo "[install-piper] downloading piper ${PIPER_VERSION}"
  TMPTAR=$(mktemp /tmp/piper-XXXXXX.tar.gz)
  curl -fsSL "${PIPER_URL}" -o "${TMPTAR}"
  mkdir -p "${PIPER_DIR}"
  tar -xzf "${TMPTAR}" -C "${PIPER_DIR}" --strip-components=1
  rm -f "${TMPTAR}"
  ln -sf "${PIPER_DIR}/piper" "${PIPER_BIN}"
  echo "[install-piper] piper installed at ${PIPER_BIN}"
fi

mkdir -p "${VOICES_DIR}"
chown -R dialeros:dialeros "${VOICES_DIR}"
chmod 0755 "${VOICES_DIR}"

for voice in "${!VOICES[@]}"; do
  path="${VOICES[$voice]}"
  onnx="${VOICES_DIR}/${voice}.onnx"
  json="${VOICES_DIR}/${voice}.onnx.json"
  if [ -f "${onnx}" ] && [ -f "${json}" ]; then
    echo "[install-piper] voice ${voice} already present"
    continue
  fi
  echo "[install-piper] downloading voice ${voice}"
  curl -fsSL "${HF_BASE}/${path}/${voice}.onnx" -o "${onnx}"
  curl -fsSL "${HF_BASE}/${path}/${voice}.onnx.json" -o "${json}"
  chown dialeros:dialeros "${onnx}" "${json}"
  size=$(du -h "${onnx}" | cut -f1)
  echo "[install-piper] voice ${voice} downloaded (${size})"
done

echo "[install-piper] done."
echo
echo "Installed voices:"
ls -lh "${VOICES_DIR}"/*.onnx 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'
echo
echo "Add more voices: drop the .onnx + .onnx.json files into ${VOICES_DIR}"
echo "Voice catalog: https://huggingface.co/rhasspy/piper-voices"
echo
echo "Quality tip: '-high' voices sound dramatically more natural"
echo "than '-medium'. The libritts/ryan/lessac high voices are the"
echo "best CPU-only piper can do."
