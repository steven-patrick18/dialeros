#!/usr/bin/env python3
"""
Iter 162 — Coqui TTS daemon for DialerOS Sound Board.

Long-running aiohttp server on 127.0.0.1:11123 that loads the
XTTS-v2 model once at startup (~30s, ~3GB RAM) and serves TTS
requests with cached state. spawn-per-request would burn the
30s warmup on every call — not workable for ad-hoc TTS use.

Endpoints:

  GET  /health
       { ok: true, model: "...", uptime_s: 1234, loaded: true }

  POST /tts
       Request body (JSON):
         text          str  (required, ≤ 2000 chars)
         language      str  (default "en")
         speaker_wav   str  path on disk to a 6-15s sample for
                            zero-shot voice cloning. Omit to use
                            a built-in default speaker.
       Response: audio/wav bytes (22050 Hz mono, model native rate).

Auth: localhost-bound; the admin-gui is the only caller. The TTS
endpoint on the admin-gui already enforces admin role before
forwarding requests here.

Logging: structured JSON lines to stdout so the systemd journal
collects them cleanly.
"""
import asyncio
import io
import json
import logging
import os
import sys
import tempfile
import time
from pathlib import Path

# Suppress Coqui's verbose import-time chatter so the journal
# stays readable. INFO+ from us, WARNING+ from libs.
logging.basicConfig(
    level=logging.INFO,
    format='{"ts":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s"}',
)
log = logging.getLogger("coqui-tts-daemon")

for name in ("TTS", "trainer", "transformers", "numba", "matplotlib"):
    logging.getLogger(name).setLevel(logging.WARNING)

CACHE_DIR = os.environ.get("TTS_HOME", "/var/lib/dialeros/ai/coqui-cache")
os.environ["TTS_HOME"] = CACHE_DIR
os.environ.setdefault("COQUI_TOS_AGREED", "1")

MODEL_NAME = os.environ.get(
    "COQUI_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2"
)
PORT = int(os.environ.get("COQUI_DAEMON_PORT", "11123"))
HOST = os.environ.get("COQUI_DAEMON_HOST", "127.0.0.1")

# Held in module scope so the same model survives across requests.
_tts = None
_started_at = time.time()
_request_lock = asyncio.Lock()

def load_model():
    global _tts
    if _tts is not None:
        return
    t0 = time.time()
    log.info(f"loading model {MODEL_NAME!r} from cache {CACHE_DIR!r}")
    from TTS.api import TTS  # noqa: import inside fn to delay heavy load to startup
    _tts = TTS(model_name=MODEL_NAME, progress_bar=False, gpu=False)
    log.info(f"model loaded in {time.time() - t0:.1f}s")


async def handle_health(_request):
    from aiohttp import web
    return web.json_response({
        "ok": True,
        "model": MODEL_NAME,
        "loaded": _tts is not None,
        "uptime_s": int(time.time() - _started_at),
    })


async def handle_tts(request):
    from aiohttp import web

    try:
        body = await request.json()
    except Exception as e:
        return web.json_response({"error": f"invalid JSON: {e}"}, status=400)

    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "text is required"}, status=400)
    if len(text) > 2000:
        return web.json_response(
            {"error": "text too long (max 2000 chars)"}, status=400
        )

    language = (body.get("language") or "en").strip() or "en"
    speaker_wav = body.get("speaker_wav") or None
    if speaker_wav is not None:
        # Strict allowlist: only paths under the audio library root.
        # Prevents the admin from being tricked into reading arbitrary
        # files by an XSS or future API quirk.
        ALLOWED_ROOT = "/var/lib/dialeros/audio/"
        if not speaker_wav.startswith(ALLOWED_ROOT):
            return web.json_response(
                {"error": f"speaker_wav must be under {ALLOWED_ROOT}"},
                status=400,
            )
        if not Path(speaker_wav).is_file():
            return web.json_response(
                {"error": f"speaker_wav not found: {speaker_wav}"}, status=400
            )

    # The XTTS model is not thread-safe + holds large GPU/CPU state;
    # serialise calls. Multiple TTS requests queue cleanly behind
    # the lock — single-box throughput is bounded by inference speed
    # anyway (~RTF 1.0 on CPU).
    async with _request_lock:
        if _tts is None:
            load_model()
        # XTTS-v2 expects a speaker_wav for cloning. Without one,
        # the API falls back to the model's bundled default speaker
        # (works but it's the same voice every time). Generation
        # runs in a thread so the asyncio loop stays responsive
        # for /health pings.
        t0 = time.time()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            out_path = tmp.name
        try:
            kwargs = {"text": text, "language": language, "file_path": out_path}
            if speaker_wav:
                kwargs["speaker_wav"] = speaker_wav
            else:
                # XTTS-v2 ships with a small built-in speaker set; pick a
                # neutral one when no clone source is given.
                kwargs["speaker"] = "Claribel Dervla"

            await asyncio.to_thread(_tts.tts_to_file, **kwargs)
            data = Path(out_path).read_bytes()
        except Exception as e:
            log.exception("tts generation failed")
            return web.json_response({"error": str(e)}, status=500)
        finally:
            try:
                Path(out_path).unlink()
            except FileNotFoundError:
                pass

    elapsed = time.time() - t0
    log.info(
        f"tts done text_len={len(text)} bytes={len(data)} "
        f"elapsed={elapsed:.2f}s clone={bool(speaker_wav)}"
    )
    return web.Response(
        body=data,
        content_type="audio/wav",
        headers={"X-TTS-Elapsed": f"{elapsed:.3f}"},
    )


def main():
    from aiohttp import web

    # Lazy-load on first request rather than blocking startup for
    # ~30s — keeps systemd's startup timeout happy + lets /health
    # respond immediately. The first /tts call pays the warmup.
    log.info(f"daemon starting on {HOST}:{PORT}, model={MODEL_NAME}")

    app = web.Application(client_max_size=4 * 1024 * 1024)
    app.add_routes([
        web.get("/health", handle_health),
        web.post("/tts", handle_tts),
    ])
    web.run_app(app, host=HOST, port=PORT, print=None, access_log=None)


if __name__ == "__main__":
    main()
