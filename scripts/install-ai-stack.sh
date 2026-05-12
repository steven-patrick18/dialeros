#!/usr/bin/env bash
# Iter 137 — install the local AI stack DialerOS's ai-worker.py
# uses: whisper.cpp (transcription) + Ollama (summarisation).
# Nothing in this script reaches an external service AT RUNTIME;
# both pieces run on this host. The one-time setup downloads:
#   - whisper.cpp source from GitHub
#   - ggml-base.en.bin Whisper weights from huggingface.co
#   - Ollama binary from ollama.com
#   - One LLM model (default qwen2.5:3b — ~2GB) from
#     registry.ollama.ai
# After this script finishes, the runtime path is 127.0.0.1 only.
#
# Idempotent — re-running upgrades + skips already-installed
# pieces.
#
# Requires root.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "[install-ai-stack] must run as root" >&2
  exit 1
fi

AI_ROOT="${AI_ROOT:-/var/lib/dialeros/ai}"
MODEL_DIR="$AI_ROOT/models"
WHISPER_SRC="$AI_ROOT/whisper.cpp"
WHISPER_BIN_DEST="${WHISPER_BIN:-/usr/local/bin/whisper-cli}"
WHISPER_MODEL_NAME="${WHISPER_MODEL_NAME:-ggml-base.en.bin}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"

mkdir -p "$MODEL_DIR"

# ---------- whisper.cpp ----------------------------------------------------

if [ -x "$WHISPER_BIN_DEST" ]; then
  echo "[install-ai-stack] whisper-cli already at $WHISPER_BIN_DEST"
else
  echo "[install-ai-stack] installing whisper.cpp"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential cmake git
  if [ ! -d "$WHISPER_SRC" ]; then
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$WHISPER_SRC"
  else
    git -C "$WHISPER_SRC" pull --ff-only || true
  fi
  (
    cd "$WHISPER_SRC"
    cmake -B build -DCMAKE_BUILD_TYPE=Release
    cmake --build build -j --target whisper-cli
  )
  # Recent whisper.cpp builds drop the binary at
  # build/bin/whisper-cli (older variants put it at ./main).
  if [ -x "$WHISPER_SRC/build/bin/whisper-cli" ]; then
    install -m 0755 "$WHISPER_SRC/build/bin/whisper-cli" "$WHISPER_BIN_DEST"
  elif [ -x "$WHISPER_SRC/build/whisper-cli" ]; then
    install -m 0755 "$WHISPER_SRC/build/whisper-cli" "$WHISPER_BIN_DEST"
  else
    echo "[install-ai-stack] could not find compiled whisper-cli binary" >&2
    exit 3
  fi
  echo "[install-ai-stack] installed whisper-cli at $WHISPER_BIN_DEST"
fi

# ---------- Whisper model --------------------------------------------------

WHISPER_MODEL_PATH="$MODEL_DIR/$WHISPER_MODEL_NAME"
if [ -f "$WHISPER_MODEL_PATH" ]; then
  echo "[install-ai-stack] whisper model already at $WHISPER_MODEL_PATH"
else
  echo "[install-ai-stack] fetching $WHISPER_MODEL_NAME (~150MB)"
  curl -fL \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$WHISPER_MODEL_NAME" \
    -o "$WHISPER_MODEL_PATH"
fi

# ---------- Ollama ---------------------------------------------------------

if command -v ollama >/dev/null 2>&1; then
  echo "[install-ai-stack] ollama already installed"
else
  echo "[install-ai-stack] installing Ollama"
  curl -fsSL https://ollama.com/install.sh | sh
fi

# Make sure the service is up before pulling.
systemctl enable --now ollama 2>/dev/null || true
sleep 2

# ---------- LLM weight pull ------------------------------------------------

if ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$OLLAMA_MODEL"; then
  echo "[install-ai-stack] LLM $OLLAMA_MODEL already pulled"
else
  echo "[install-ai-stack] pulling $OLLAMA_MODEL (one-time download)"
  ollama pull "$OLLAMA_MODEL"
fi

# ---------- Permissions ---------------------------------------------------

chown -R dialeros:dialeros "$AI_ROOT" || true

cat <<EOF

[install-ai-stack] done. Local-only AI stack ready.

  whisper-cli   : $WHISPER_BIN_DEST
  whisper model : $WHISPER_MODEL_PATH
  ollama        : $(which ollama 2>/dev/null || echo '(missing)')
  ollama model  : $OLLAMA_MODEL (running on 127.0.0.1:11434)

Enable the worker:
  sudo systemctl daemon-reload
  sudo systemctl enable --now dialeros-ai-worker.timer

Tail it:
  journalctl -fu dialeros-ai-worker.service

Once enabled the worker picks up answered recordings every 5
minutes, transcribes them locally with whisper.cpp, and
summarises locally via Ollama. NOTHING leaves the host at
runtime.
EOF
