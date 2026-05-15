#!/usr/bin/env bash
# Iter 190 — Compile mod_audio_stream (lightweight community
# alternative to SignalWire's mod_audio_fork) against the
# installed FreeSWITCH. This is the FS-side module that streams
# the caller's RTP audio over a WebSocket to the DialerOS AI
# media bridge daemon (scripts/ai-media-bridge.py).
#
# One-time, operator-run, requires root. Idempotent — skips when
# the .so is already present + loadable.
#
# Nothing here reaches an external service AT RUNTIME; the module
# only ever connects to ws://127.0.0.1:11124 (the local bridge).

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "[install-audio-fork] must run as root" >&2
  exit 1
fi

SRC="${AUDIO_STREAM_SRC:-/var/lib/dialeros/ai/mod_audio_stream}"
FS_MOD_DIR="${FS_MOD_DIR:-/usr/lib/freeswitch/mod}"
[ -d "$FS_MOD_DIR" ] || FS_MOD_DIR="/usr/local/freeswitch/mod"

if [ -f "$FS_MOD_DIR/mod_audio_stream.so" ]; then
  echo "[install-audio-fork] mod_audio_stream.so already at $FS_MOD_DIR"
  exit 0
fi

echo "[install-audio-fork] installing build deps"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential cmake git libfreeswitch-dev libssl-dev \
  libwebsockets-dev || true

if [ ! -d "$SRC" ]; then
  git clone --depth 1 \
    https://github.com/amigniter/mod_audio_stream.git "$SRC"
else
  git -C "$SRC" pull --ff-only || true
fi

(
  cd "$SRC"
  cmake -B build -DCMAKE_BUILD_TYPE=Release
  cmake --build build -j
)

# The build drops mod_audio_stream.so somewhere under build/;
# find + install it.
SO="$(find "$SRC/build" -name 'mod_audio_stream.so' | head -1)"
if [ -z "$SO" ]; then
  echo "[install-audio-fork] build produced no .so" >&2
  exit 3
fi
install -m 0755 "$SO" "$FS_MOD_DIR/mod_audio_stream.so"

# Autoload via modules.conf.xml if not already listed.
MODCONF="/etc/freeswitch/autoload_configs/modules.conf.xml"
if [ -f "$MODCONF" ] && ! grep -q mod_audio_stream "$MODCONF"; then
  sed -i 's#</modules>#  <load module="mod_audio_stream"/>\n</modules>#' \
    "$MODCONF"
fi

fs_cli -x 'load mod_audio_stream' 2>/dev/null || \
  echo "[install-audio-fork] load it via: fs_cli -x 'load mod_audio_stream'"

echo "[install-audio-fork] done. mod_audio_stream.so -> $FS_MOD_DIR"
echo "Bridge daemon: systemctl enable --now dialeros-ai-media-bridge"
