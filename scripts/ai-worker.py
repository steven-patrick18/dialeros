#!/usr/bin/env python3
"""
Iter 137 — fully-local AI worker. Replaces iter 136's OpenAI
reference. Zero external API calls; everything stays on the box.

Pipeline:
    1. GET /api/internal/ai-pending   (localhost admin-gui)
    2. whisper.cpp transcribes the .wav off disk
    3. ollama (localhost) summarises the transcript
    4. POST /api/internal/ai-process  (localhost admin-gui)

Nothing leaves the VPS. The only HTTP hops are 127.0.0.1:1111
(admin-gui) and 127.0.0.1:11434 (ollama).

Env (from /etc/dialeros/admin.env via the systemd unit):
    DIALEROS_ADMIN_URL          default http://127.0.0.1:1111
    KAMAILIO_INBOUND_TOKEN      shared secret for /api/internal/*
    DIALEROS_AI_LIMIT           rows per tick, default 3 (local
                                inference is slower than cloud;
                                smaller batches keep us responsive)
    WHISPER_BIN                 path to whisper-cli binary
                                (default /usr/local/bin/whisper-cli)
    WHISPER_MODEL               path to .bin model
                                (default /var/lib/dialeros/ai/models/ggml-base.en.bin)
    OLLAMA_URL                  default http://127.0.0.1:11434
    OLLAMA_MODEL                default qwen2.5:3b
    AI_WORK_DIR                 scratch dir for whisper intermediates
                                (default /tmp; cleaned per row)

Run scripts/install-ai-stack.sh first to set up whisper.cpp +
Ollama on the box.

Stdlib-only — no pip deps so the worker is portable.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

ADMIN_URL = os.environ.get('DIALEROS_ADMIN_URL', 'http://127.0.0.1:1111').rstrip('/')
TOKEN = os.environ.get('KAMAILIO_INBOUND_TOKEN', '')
LIMIT = int(os.environ.get('DIALEROS_AI_LIMIT', '3'))
WHISPER_BIN = os.environ.get('WHISPER_BIN', '/usr/local/bin/whisper-cli')
WHISPER_MODEL = os.environ.get(
    'WHISPER_MODEL',
    '/var/lib/dialeros/ai/models/ggml-base.en.bin',
)
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://127.0.0.1:11434').rstrip('/')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'qwen2.5:3b')
WORK_DIR = Path(os.environ.get('AI_WORK_DIR', '/tmp'))

SUMMARY_PROMPT = (
    "You are summarising a phone call transcript from a call-centre's "
    "dialler. Produce a concise 3-5 sentence summary covering:\n"
    "  - Who answered (lead name if mentioned, else describe).\n"
    "  - Reason the call was placed and how the conversation went.\n"
    "  - Outcome and any commitment (sale, callback time, "
    "not interested, do-not-call request, voicemail dropped, etc.).\n"
    "  - Compliance flags (DNC request, hostile interaction, "
    "wrong number).\n"
    "Keep under 200 words. Plain prose, no markdown, no preamble."
)


def fail(code: int, msg: str) -> None:
    print(f'[ai-worker] {msg}', file=sys.stderr)
    sys.exit(code)


# -- Preflight: tools available --------------------------------------------

if not Path(WHISPER_BIN).is_file() or not os.access(WHISPER_BIN, os.X_OK):
    fail(
        2,
        f'WHISPER_BIN={WHISPER_BIN} not an executable file. '
        f'Run scripts/install-ai-stack.sh to set it up.',
    )
if not Path(WHISPER_MODEL).is_file():
    fail(
        2,
        f'WHISPER_MODEL={WHISPER_MODEL} not on disk. '
        f'install-ai-stack.sh downloads it for you.',
    )

# -- HTTP helpers ----------------------------------------------------------


def http_json(method: str, url: str, body: dict | None = None) -> dict:
    data = None
    headers = {'Accept': 'application/json'}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if TOKEN:
        headers['X-Inbound-Token'] = TOKEN
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode('utf-8'))


# -- Transcription via whisper.cpp ----------------------------------------


def transcribe_local(audio_path: Path) -> str:
    """Run whisper.cpp on the .wav and read back the .txt it produces."""
    with tempfile.TemporaryDirectory(dir=WORK_DIR, prefix='whisper-') as td:
        out_prefix = Path(td) / 'out'
        # whisper-cli writes <out_prefix>.txt when -otxt is set
        cmd = [
            WHISPER_BIN,
            '-m', WHISPER_MODEL,
            '-f', str(audio_path),
            '-otxt',
            '-of', str(out_prefix),
            '-t', str(max(1, os.cpu_count() or 2)),
            '-l', 'en',
            '--no-prints',
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=20 * 60,  # 20-minute hard cap per recording
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f'whisper-cli exit {proc.returncode}: '
                f'{(proc.stderr or proc.stdout)[:500]}'
            )
        txt_file = Path(f'{out_prefix}.txt')
        if not txt_file.is_file():
            raise RuntimeError(
                f'whisper-cli produced no .txt at {txt_file}'
            )
        return txt_file.read_text(encoding='utf-8').strip()


# -- Summarisation via Ollama (localhost) ---------------------------------


ALLOWED_FLAGS = (
    'DNC_REQUESTED',
    'HOSTILE',
    'WRONG_NUMBER',
    'RECORDING_OBJECTION',
    'CALLBACK_PROMISED',
    'SALE_CONFIRMED',
    'VOICEMAIL_DROPPED',
)
ALLOWED_SENTIMENT = ('positive', 'neutral', 'negative', 'mixed')

CLASSIFY_PROMPT = (
    "You are classifying a call-centre transcript. Respond with "
    "ONLY a single JSON object — no preamble, no markdown. Schema:\n"
    '{\n'
    '  "sentiment": "positive" | "neutral" | "negative" | "mixed",\n'
    '  "flags": string[]\n'
    '}\n'
    "flags must be a subset of: " + ", ".join(ALLOWED_FLAGS) + "\n"
    "Examples:\n"
    "  - Lead asks to be removed → flags includes DNC_REQUESTED.\n"
    "  - Caller agreed to a follow-up at a specific time → "
    "CALLBACK_PROMISED.\n"
    "  - Lead bought / signed up / agreed → SALE_CONFIRMED.\n"
    "  - Lead was angry, shouted, profanity → HOSTILE.\n"
    "  - Lead says 'wrong number' → WRONG_NUMBER.\n"
    "  - Mention of being recorded was objected to → RECORDING_OBJECTION.\n"
    "  - Hit a voicemail / answering machine → VOICEMAIL_DROPPED.\n"
    "Empty flags array is fine when nothing applies."
)


def classify_local(transcript: str) -> tuple[str | None, list[str] | None]:
    """Return (sentiment, flags) from a structured LLM response.
    Either may be None if the LLM produced unparseable output."""
    body = {
        'model': OLLAMA_MODEL,
        'system': CLASSIFY_PROMPT,
        'prompt': f'Transcript:\n{transcript}',
        'format': 'json',
        'stream': False,
        'options': {
            'temperature': 0.0,
            'num_predict': 200,
        },
    }
    req = urllib.request.Request(
        f'{OLLAMA_URL}/api/generate',
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        outer = json.loads(resp.read().decode('utf-8'))
    raw = outer.get('response') or ''
    try:
        parsed = json.loads(raw)
    except Exception:
        return None, None
    sentiment = parsed.get('sentiment')
    if sentiment not in ALLOWED_SENTIMENT:
        sentiment = None
    flags_raw = parsed.get('flags') or []
    if not isinstance(flags_raw, list):
        flags = None
    else:
        seen: list[str] = []
        for f in flags_raw:
            if isinstance(f, str) and f in ALLOWED_FLAGS and f not in seen:
                seen.append(f)
        flags = seen
    return sentiment, flags


def summarise_local(transcript: str, lead_phone: str, campaign_name: str) -> str:
    user_msg = (
        f'Call placed to {lead_phone} on campaign "{campaign_name}".\n\n'
        f'Transcript:\n{transcript}'
    )
    body = {
        'model': OLLAMA_MODEL,
        'system': SUMMARY_PROMPT,
        'prompt': user_msg,
        'stream': False,
        'options': {
            'temperature': 0.2,
            'num_predict': 400,
        },
    }
    req = urllib.request.Request(
        f'{OLLAMA_URL}/api/generate',
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    # Local inference is slower than cloud — 5 minute ceiling per
    # row covers worst-case CPU summarisation on a 5-min call.
    with urllib.request.urlopen(req, timeout=300) as resp:
        j = json.loads(resp.read().decode('utf-8'))
    return (j.get('response') or '').strip()


# -- Pipeline --------------------------------------------------------------


def post_back(
    intent_id: int,
    transcript: str | None,
    summary: str | None,
    sentiment: str | None = None,
    flags: list[str] | None = None,
) -> None:
    body: dict = {
        'intent_id': intent_id,
        'transcript_text': transcript,
        'ai_summary': summary,
    }
    if sentiment is not None:
        body['ai_sentiment'] = sentiment
    if flags is not None:
        body['ai_flags'] = flags
    http_json('POST', f'{ADMIN_URL}/api/internal/ai-process', body)


def process_one(row: dict[str, Any]) -> None:
    iid = row['id']
    rec_path = row.get('recording_path')
    if not rec_path:
        post_back(iid, None, None)
        print(f'[ai-worker] intent {iid}: no recording_path, dropped from queue')
        return
    p = Path(rec_path)
    if not p.is_file():
        post_back(iid, None, None)
        print(
            f'[ai-worker] intent {iid}: recording {rec_path} not on disk, dropped',
            file=sys.stderr,
        )
        return

    started = time.time()
    transcript: str | None = None
    summary: str | None = None
    try:
        transcript = transcribe_local(p)
    except Exception as e:
        print(
            f'[ai-worker] intent {iid}: whisper.cpp failed: {e}',
            file=sys.stderr,
        )
    transcribed_at = time.time()

    if transcript:
        try:
            summary = summarise_local(
                transcript,
                row.get('lead_phone', '(unknown)'),
                row.get('campaign_name', '(unknown)'),
            )
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:400]
            print(
                f'[ai-worker] intent {iid}: ollama HTTP {e.code}: {body}',
                file=sys.stderr,
            )
        except urllib.error.URLError as e:
            print(
                f'[ai-worker] intent {iid}: ollama unreachable: {e.reason} '
                f'(is ollama running on {OLLAMA_URL}?)',
                file=sys.stderr,
            )
        except Exception as e:
            print(
                f'[ai-worker] intent {iid}: summarise failed: {e}',
                file=sys.stderr,
            )
    sentiment: str | None = None
    flags: list[str] | None = None
    if transcript:
        try:
            sentiment, flags = classify_local(transcript)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:400]
            print(
                f'[ai-worker] intent {iid}: classify HTTP {e.code}: {body}',
                file=sys.stderr,
            )
        except Exception as e:
            print(
                f'[ai-worker] intent {iid}: classify failed: {e}',
                file=sys.stderr,
            )
    done_at = time.time()

    post_back(iid, transcript, summary, sentiment, flags)
    print(
        f'[ai-worker] intent {iid}: '
        f'transcript={"yes" if transcript else "no"} '
        f'summary={"yes" if summary else "no"} '
        f'sentiment={sentiment or "n/a"} '
        f'flags={",".join(flags) if flags else "[]"} '
        f'whisper_s={transcribed_at - started:.1f} '
        f'llm_s={done_at - transcribed_at:.1f}'
    )


def main() -> int:
    try:
        j = http_json(
            'GET',
            f'{ADMIN_URL}/api/internal/ai-pending?limit={LIMIT}',
        )
    except urllib.error.HTTPError as e:
        fail(3, f'ai-pending fetch failed HTTP {e.code}')
    except Exception as e:
        fail(3, f'ai-pending fetch failed: {e}')
    pending = j.get('pending', [])
    if not pending:
        print('[ai-worker] no pending intents')
        return 0
    print(f'[ai-worker] processing {len(pending)} intent(s) locally')
    for row in pending:
        try:
            process_one(row)
        except Exception as e:
            iid = row.get('id', '?')
            print(
                f'[ai-worker] intent {iid}: outer-loop exception: {e}',
                file=sys.stderr,
            )
            try:
                post_back(iid, None, None)
            except Exception as e2:
                print(
                    f'[ai-worker] intent {iid}: post_back fallback failed: {e2}',
                    file=sys.stderr,
                )
    return 0


if __name__ == '__main__':
    sys.exit(main())
