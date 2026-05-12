#!/usr/bin/env python3
"""
Iter 136 — reference AI worker for the iter-135 post-call pipeline.

Polls /api/internal/ai-pending, transcribes each recording via
OpenAI Whisper, summarises the transcript via GPT-4o-mini, and
POSTs the result back to /api/internal/ai-process.

This worker runs ON the DialerOS box so it reads recordings
directly from disk (recording_path is an absolute filesystem
path). HTTP is only used for the two internal endpoints.

Env (from /etc/dialeros/admin.env via the systemd unit):
    DIALEROS_ADMIN_URL          default http://127.0.0.1:1111
    KAMAILIO_INBOUND_TOKEN      shared secret for /api/internal/*
    OPENAI_API_KEY              required
    DIALEROS_AI_LIMIT           rows per tick, default 5
    DIALEROS_AI_MODEL_SUMMARY   default gpt-4o-mini
    DIALEROS_AI_MODEL_STT       default whisper-1

Stdlib-only — no pip deps so the worker is portable. Errors on
ONE row don't abort the loop; we POST back ai_processed_at with
both fields NULL so the row drops off the pending queue and the
operator can investigate via the audit log + journal.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

ADMIN_URL = os.environ.get('DIALEROS_ADMIN_URL', 'http://127.0.0.1:1111').rstrip('/')
TOKEN = os.environ.get('KAMAILIO_INBOUND_TOKEN', '')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
LIMIT = int(os.environ.get('DIALEROS_AI_LIMIT', '5'))
MODEL_SUMMARY = os.environ.get('DIALEROS_AI_MODEL_SUMMARY', 'gpt-4o-mini')
MODEL_STT = os.environ.get('DIALEROS_AI_MODEL_STT', 'whisper-1')

SUMMARY_PROMPT = (
    "You are summarising a phone call transcript from a call-centre's "
    "dialler. The call was placed to a lead identified below. Produce a "
    "concise 3-5 sentence summary covering:\n"
    "  - Who answered (lead name if mentioned, else describe).\n"
    "  - Reason the call was placed and how the conversation went.\n"
    "  - Outcome and any commitment (sale, callback time, "
    "not interested, do-not-call request, voicemail dropped, etc.).\n"
    "  - Compliance flags (caller mentioned recording, DNC request, "
    "wrong number, hostile interaction).\n"
    "Keep under 200 words. Plain prose, no markdown."
)


def fail(code: int, msg: str) -> None:
    print(f'[ai-worker] {msg}', file=sys.stderr)
    sys.exit(code)


if not OPENAI_API_KEY:
    fail(2, 'OPENAI_API_KEY not set; nothing to do.')


def http_json(method: str, url: str, body: dict | None = None) -> dict:
    data = None
    headers = {'Accept': 'application/json'}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if TOKEN:
        headers['X-Inbound-Token'] = TOKEN
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def transcribe(audio_path: Path) -> str:
    # multipart/form-data — minimum viable hand-rolled encoder so
    # we stay stdlib-only.
    boundary = f'----dialeros-{int(time.time())}-{os.getpid()}'
    parts: list[bytes] = []

    def field(name: str, value: str) -> None:
        parts.append(f'--{boundary}\r\n'.encode())
        parts.append(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        )
        parts.append(value.encode())
        parts.append(b'\r\n')

    def file_field(name: str, filename: str, content: bytes, mime: str) -> None:
        parts.append(f'--{boundary}\r\n'.encode())
        parts.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
        )
        parts.append(f'Content-Type: {mime}\r\n\r\n'.encode())
        parts.append(content)
        parts.append(b'\r\n')

    file_field(
        'file',
        audio_path.name,
        audio_path.read_bytes(),
        'audio/wav',
    )
    field('model', MODEL_STT)
    field('response_format', 'text')
    parts.append(f'--{boundary}--\r\n'.encode())
    body = b''.join(parts)

    req = urllib.request.Request(
        'https://api.openai.com/v1/audio/transcriptions',
        data=body,
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': f'multipart/form-data; boundary={boundary}',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read().decode('utf-8').strip()


def summarise(transcript: str, lead_phone: str, campaign_name: str) -> str:
    user_msg = (
        f'Call placed to {lead_phone} on campaign "{campaign_name}".\n\n'
        f'Transcript:\n{transcript}'
    )
    body = {
        'model': MODEL_SUMMARY,
        'messages': [
            {'role': 'system', 'content': SUMMARY_PROMPT},
            {'role': 'user', 'content': user_msg},
        ],
        'temperature': 0.2,
        'max_tokens': 400,
    }
    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        j = json.loads(resp.read().decode('utf-8'))
    return j['choices'][0]['message']['content'].strip()


def post_back(intent_id: int, transcript: str | None, summary: str | None) -> None:
    http_json(
        'POST',
        f'{ADMIN_URL}/api/internal/ai-process',
        {
            'intent_id': intent_id,
            'transcript_text': transcript,
            'ai_summary': summary,
        },
    )


def process_one(row: dict[str, Any]) -> None:
    iid = row['id']
    rec_path = row.get('recording_path')
    if not rec_path:
        print(f'[ai-worker] intent {iid}: no recording_path, marking processed')
        post_back(iid, None, None)
        return
    p = Path(rec_path)
    if not p.is_file():
        print(
            f'[ai-worker] intent {iid}: recording {rec_path} not on disk, '
            f'marking processed to drop from queue',
            file=sys.stderr,
        )
        post_back(iid, None, None)
        return
    transcript: str | None = None
    summary: str | None = None
    try:
        transcript = transcribe(p)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:400]
        print(
            f'[ai-worker] intent {iid}: whisper failed HTTP {e.code}: {body}',
            file=sys.stderr,
        )
    except Exception as e:
        print(f'[ai-worker] intent {iid}: whisper failed: {e}', file=sys.stderr)
    if transcript:
        try:
            summary = summarise(
                transcript,
                row.get('lead_phone', '(unknown)'),
                row.get('campaign_name', '(unknown)'),
            )
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:400]
            print(
                f'[ai-worker] intent {iid}: gpt failed HTTP {e.code}: {body}',
                file=sys.stderr,
            )
        except Exception as e:
            print(f'[ai-worker] intent {iid}: gpt failed: {e}', file=sys.stderr)
    post_back(iid, transcript, summary)
    print(
        f'[ai-worker] intent {iid}: '
        f'transcript={"yes" if transcript else "no"} '
        f'summary={"yes" if summary else "no"}'
    )


def main() -> int:
    try:
        j = http_json('GET', f'{ADMIN_URL}/api/internal/ai-pending?limit={LIMIT}')
    except urllib.error.HTTPError as e:
        fail(3, f'ai-pending fetch failed HTTP {e.code}')
    except Exception as e:
        fail(3, f'ai-pending fetch failed: {e}')
    pending = j.get('pending', [])
    if not pending:
        print('[ai-worker] no pending intents')
        return 0
    print(f'[ai-worker] processing {len(pending)} intent(s)')
    for row in pending:
        try:
            process_one(row)
        except Exception as e:
            iid = row.get('id', '?')
            print(
                f'[ai-worker] intent {iid}: outer-loop exception: {e}',
                file=sys.stderr,
            )
            # Best-effort drop from queue so we don't burn forever on a
            # poison row.
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
