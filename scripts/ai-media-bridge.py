#!/usr/bin/env python3
"""
Iter 190 — DialerOS AI media bridge daemon.

Long-running aiohttp WebSocket server on 127.0.0.1:11124 that
FreeSWITCH's mod_audio_fork (or the lighter mod_audio_stream)
connects to when a call leg is routed into the AI agent. It:

  1. Accepts the WS connection. First text frame is JSON
     metadata from FS: { uuid, persona_id, dial_intent_id?,
     from? }. We open an ai_call_session via the token-gated
     internal API.
  2. Subsequent BINARY frames are L16 (signed 16-bit LE) PCM
     mono audio from the caller, frame size = whatever FS sends
     (typically 20ms @ 8kHz = 320 bytes).
  3. Energy-based VAD segments the stream into utterances:
     speech starts when a frame's RMS crosses START_RMS, ends
     after SILENCE_HANG_MS of sub-threshold frames.
  4. On utterance end, the buffered PCM is written to a temp
     16kHz WAV (whisper.cpp wants 16k) and whisper-cli
     transcribes it. The transcript is POSTed as a 'caller'
     turn to the internal API.

iter 190 does STT-only — it transcribes + logs caller turns.
The LLM reply + TTS playback (the response half of the loop)
lands in iter 191; this daemon already records per-stage timing
columns so 191 just fills llm_ms / tts_ms.

NOTHING leaves the host: whisper-cli is local, the internal API
is 127.0.0.1, the only external surface is the FS WS which is
also localhost.

Env:
  AI_BRIDGE_HOST            default 127.0.0.1
  AI_BRIDGE_PORT            default 11124
  WHISPER_BIN               default /usr/local/bin/whisper-cli
  WHISPER_MODEL             default /var/lib/dialeros/ai/models/ggml-base.en.bin
  ADMIN_URL                 default http://127.0.0.1:1111
  KAMAILIO_INBOUND_TOKEN    token for the internal API (required
                            for DB writes; without it the daemon
                            still transcribes + logs to journal)
  AI_BRIDGE_SAMPLE_RATE     inbound PCM rate from FS, default 8000
"""
import asyncio
import audioop
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

try:
    from aiohttp import web, ClientSession, ClientTimeout
except Exception as e:  # pragma: no cover
    print(f"[ai-media-bridge] aiohttp import failed: {e}", file=sys.stderr)
    sys.exit(1)

LOG = logging.getLogger("ai-media-bridge")
logging.basicConfig(
    level=logging.INFO,
    format='{"ts":"%(asctime)s","lvl":"%(levelname)s","msg":%(message)s}',
)

HOST = os.environ.get("AI_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("AI_BRIDGE_PORT", "11124"))
WHISPER_BIN = os.environ.get("WHISPER_BIN", "/usr/local/bin/whisper-cli")
WHISPER_MODEL = os.environ.get(
    "WHISPER_MODEL", "/var/lib/dialeros/ai/models/ggml-base.en.bin"
)
ADMIN_URL = os.environ.get("ADMIN_URL", "http://127.0.0.1:1111")
INBOUND_TOKEN = os.environ.get("KAMAILIO_INBOUND_TOKEN", "")
IN_RATE = int(os.environ.get("AI_BRIDGE_SAMPLE_RATE", "8000"))

# --- VAD tunables (energy-based; no extra deps) ----------------------------
# RMS of signed-16 PCM ranges 0..32767. Phone speech is ~1000-8000;
# line noise / comfort noise is typically < 400.
START_RMS = int(os.environ.get("AI_BRIDGE_START_RMS", "700"))
SILENCE_HANG_MS = int(os.environ.get("AI_BRIDGE_SILENCE_HANG_MS", "700"))
MIN_UTTERANCE_MS = int(os.environ.get("AI_BRIDGE_MIN_UTTERANCE_MS", "300"))
MAX_UTTERANCE_MS = int(os.environ.get("AI_BRIDGE_MAX_UTTERANCE_MS", "15000"))


def rms_of(pcm: bytes) -> int:
    if not pcm:
        return 0
    try:
        return audioop.rms(pcm, 2)  # width=2 → signed 16-bit
    except audioop.error:
        return 0


class Utterance:
    """Accumulates PCM frames; the segmentation state machine
    decides when a complete utterance is ready for STT."""

    def __init__(self, frame_ms: int):
        self.frame_ms = frame_ms
        self.buf = bytearray()
        self.in_speech = False
        self.silence_ms = 0
        self.speech_ms = 0

    def push(self, frame: bytes) -> bool:
        """Feed one PCM frame. Returns True when an utterance just
        completed (caller should drain + transcribe)."""
        energy = rms_of(frame)
        speaking = energy >= START_RMS
        if not self.in_speech:
            if speaking:
                self.in_speech = True
                self.silence_ms = 0
                self.speech_ms = self.frame_ms
                self.buf.extend(frame)
            return False
        # in speech
        self.buf.extend(frame)
        self.speech_ms += self.frame_ms
        if speaking:
            self.silence_ms = 0
        else:
            self.silence_ms += self.frame_ms
        if self.speech_ms >= MAX_UTTERANCE_MS:
            return True
        if self.silence_ms >= SILENCE_HANG_MS:
            # End only if we captured enough actual speech.
            voiced_ms = self.speech_ms - self.silence_ms
            return voiced_ms >= MIN_UTTERANCE_MS
        return False

    def drain_wav16k(self) -> bytes:
        """Resample the buffered PCM to 16kHz mono s16 + wrap in a
        WAV container (whisper.cpp wants 16k)."""
        pcm = bytes(self.buf)
        self.buf = bytearray()
        self.in_speech = False
        self.silence_ms = 0
        self.speech_ms = 0
        if IN_RATE != 16000:
            pcm, _ = audioop.ratecv(pcm, 2, 1, IN_RATE, 16000, None)
        bio = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        with wave.open(bio, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(pcm)
        bio.flush()
        return bio.name


def transcribe(wav_path: str) -> str:
    """Run whisper-cli on the wav, return the trimmed transcript.
    Empty string on any failure (the loop just waits for the next
    utterance — a dropped turn beats a crash)."""
    try:
        out = subprocess.run(
            [
                WHISPER_BIN,
                "-m",
                WHISPER_MODEL,
                "-f",
                wav_path,
                "-nt",          # no timestamps
                "-l",
                "en",
                "--output-txt",
                "-of",
                wav_path,       # writes <wav_path>.txt
            ],
            capture_output=True,
            timeout=30,
            check=False,
        )
        txt_path = wav_path + ".txt"
        if os.path.exists(txt_path):
            text = Path(txt_path).read_text(errors="replace").strip()
            os.unlink(txt_path)
            return text
        # Fallback: parse stdout if --output-txt path differed.
        return out.stdout.decode(errors="replace").strip()
    except Exception as e:
        LOG.warning(json.dumps(f"whisper failed: {e}"))
        return ""
    finally:
        try:
            os.unlink(wav_path)
        except OSError:
            pass


async def api_post(path: str, payload: dict) -> dict | None:
    if not INBOUND_TOKEN:
        LOG.info(json.dumps(f"(no token) would POST {path}: {payload}"))
        return None
    try:
        async with ClientSession(timeout=ClientTimeout(total=5)) as s:
            async with s.post(
                f"{ADMIN_URL}{path}",
                json=payload,
                headers={"X-Inbound-Token": INBOUND_TOKEN},
            ) as r:
                if r.status >= 300:
                    LOG.warning(
                        json.dumps(f"{path} -> HTTP {r.status}")
                    )
                    return None
                return await r.json()
    except Exception as e:
        LOG.warning(json.dumps(f"{path} POST failed: {e}"))
        return None


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)

    meta: dict = {}
    session_id: str | None = None
    turn_index = 0
    utt: Utterance | None = None
    frame_ms = 20  # refined once we see the first audio frame

    async for msg in ws:
        if msg.type == web.WSMsgType.TEXT:
            try:
                meta = json.loads(msg.data)
            except json.JSONDecodeError:
                LOG.warning(json.dumps("bad metadata frame"))
                continue
            LOG.info(json.dumps(f"session meta: {meta}"))
            resp = await api_post(
                "/api/internal/ai-session/start",
                {
                    "call_uuid": meta.get("uuid"),
                    "persona_id": meta.get("persona_id"),
                    "dial_intent_id": meta.get("dial_intent_id"),
                    "from_phone": meta.get("from"),
                },
            )
            session_id = (resp or {}).get("session_id")
            # FS sends 8kHz s16 mono in 20ms frames by default.
            utt = Utterance(frame_ms)
        elif msg.type == web.WSMsgType.BINARY:
            if utt is None:
                utt = Utterance(frame_ms)
            frame = msg.data
            # Derive real frame_ms from the first frame size:
            # bytes / 2 (s16) / rate * 1000.
            if utt.speech_ms == 0 and not utt.in_speech:
                derived = int(len(frame) / 2 / IN_RATE * 1000) or 20
                utt.frame_ms = derived
            if utt.push(frame):
                wav = utt.drain_wav16k()
                t0 = time.time()
                text = transcribe(wav)
                stt_ms = int((time.time() - t0) * 1000)
                if text:
                    turn_index += 1
                    LOG.info(
                        json.dumps(
                            f"caller turn {turn_index}: {text[:160]}"
                        )
                    )
                    if session_id:
                        await api_post(
                            "/api/internal/ai-session/turn",
                            {
                                "session_id": session_id,
                                "turn_index": turn_index,
                                "role": "caller",
                                "text": text,
                                "stt_ms": stt_ms,
                            },
                        )
                    # iter 191 hooks the LLM reply + TTS playback
                    # here; iter 190 is STT-only.
        elif msg.type in (
            web.WSMsgType.CLOSE,
            web.WSMsgType.CLOSING,
            web.WSMsgType.ERROR,
        ):
            break

    if session_id:
        await api_post(
            "/api/internal/ai-session/end",
            {"session_id": session_id, "end_reason": "ws_closed"},
        )
    LOG.info(json.dumps(f"session closed: {session_id}"))
    return ws


async def health(_request: web.Request) -> web.Response:
    return web.json_response(
        {
            "ok": True,
            "whisper_bin": WHISPER_BIN,
            "whisper_model_present": os.path.exists(WHISPER_MODEL),
            "stt_only": True,
            "note": "iter 190 — STT half; LLM/TTS reply lands iter 191",
        }
    )


def main() -> None:
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/ws", ws_handler)
    LOG.info(json.dumps(f"listening on ws://{HOST}:{PORT}/ws"))
    web.run_app(app, host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
