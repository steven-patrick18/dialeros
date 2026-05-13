#!/usr/bin/env bash
# Iter 151 — install piper-tts for the Sound Board TTS feature.
#
# piper is a fast, CPU-only neural TTS engine. Runs entirely on the
# box — no external API calls (consistent with iter 137's no-cloud-AI
# constraint). One ~70MB binary + per-voice model files (~25-100MB
# each).
#
# Idempotent. Re-running is safe — existing piper + voices are kept.
#
# What lands on disk:
#   /usr/local/bin/piper                          piper binary
#   /var/lib/dialeros/ai/piper-voices/<voice>.onnx
#   /var/lib/dialeros/ai/piper-voices/<voice>.onnx.json
#
# Default voice: en_US-amy-medium (clear American female, ~63MB).
# Operators can drop additional .onnx voice files into the
# piper-voices dir; the Sound Board TTS card auto-discovers them.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (use sudo)" >&2
  exit 1
fi

PIPER_VERSION="2023.11.14-2"  # Last release tag with prebuilt linux x86_64
PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz"
PIPER_DIR=/usr/local/share/piper
PIPER_BIN=/usr/local/bin/piper
VOICES_DIR=/var/lib/dialeros/ai/piper-voices
DEFAULT_VOICE_NAME="en_US-amy-medium"
DEFAULT_VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium"

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
  # The release ships a wrapper script + libs; symlink to /usr/local/bin
  ln -sf "${PIPER_DIR}/piper" "${PIPER_BIN}"
  echo "[install-piper] piper installed at ${PIPER_BIN}"
fi

echo "[install-piper] piper version: $(${PIPER_BIN} --help 2>&1 | head -1 || echo '(no --help)')"

# Voices dir owned by dialeros, readable by group (admin-gui reads
# the .onnx.json sidecars to enumerate available voices).
mkdir -p "${VOICES_DIR}"
chown -R dialeros:dialeros "${VOICES_DIR}"
chmod 0755 "${VOICES_DIR}"

ONNX="${VOICES_DIR}/${DEFAULT_VOICE_NAME}.onnx"
JSON="${VOICES_DIR}/${DEFAULT_VOICE_NAME}.onnx.json"

if [ -f "${ONNX}" ] && [ -f "${JSON}" ]; then
  echo "[install-piper] default voice ${DEFAULT_VOICE_NAME} already present"
else
  echo "[install-piper] downloading default voice ${DEFAULT_VOICE_NAME}"
  curl -fsSL "${DEFAULT_VOICE_BASE}/${DEFAULT_VOICE_NAME}.onnx" -o "${ONNX}"
  curl -fsSL "${DEFAULT_VOICE_BASE}/${DEFAULT_VOICE_NAME}.onnx.json" -o "${JSON}"
  chown dialeros:dialeros "${ONNX}" "${JSON}"
  echo "[install-piper] voice downloaded ($(du -h "${ONNX}" | cut -f1))"
fi

echo "[install-piper] done."
echo
echo "Try it:"
echo "  echo 'Hello from DialerOS.' | ${PIPER_BIN} --model ${ONNX} --output_file /tmp/test.wav"
echo "  aplay /tmp/test.wav  # or scp to your laptop and play"
echo
echo "Add more voices: drop the .onnx + .onnx.json files into ${VOICES_DIR}"
echo "Voice catalog: https://huggingface.co/rhasspy/piper-voices"
