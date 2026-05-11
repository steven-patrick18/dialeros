import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  appendAudit,
  getCampaign,
  updateCampaign,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VOICEMAIL_ROOT = '/var/lib/dialeros/voicemails';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MiB; FS will refuse anything bigger anyway

// Iter 66 — upload a .wav voicemail for a campaign. When the campaigns
// amd_action is set to "voicemail", the pacer's originate app becomes
// &playback(<this-file>) so the lead hears the recording at answer
// and the call hangs up. No agent bridge.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'multipart/form-data with a "file" field is required.' },
      { status: 400 },
    );
  }
  if (!file.name.toLowerCase().endsWith('.wav')) {
    return NextResponse.json(
      { error: 'Voicemail must be a .wav file (FS plays it via mod_sndfile).' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} > ${MAX_BYTES} bytes).` },
      { status: 413 },
    );
  }
  const safePath = resolve(VOICEMAIL_ROOT, `${id}.wav`);
  await mkdir(VOICEMAIL_ROOT, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(safePath, buf);

  updateCampaign(id, { voicemail_path: safePath });

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'campaign.voicemail_uploaded',
    targetType: 'campaign',
    targetId: id,
    payload: {
      bytes: file.size,
      filename: file.name,
      path: safePath,
    },
  });

  return NextResponse.json({ ok: true, path: safePath, bytes: file.size });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Clear the column. We leave the .wav on disk in case the admin
  // re-enables voicemail mode and reuses the same path; the
  // recording-retention sweep eventually cleans up unused files.
  updateCampaign(id, { voicemail_path: null });
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'campaign.voicemail_cleared',
    targetType: 'campaign',
    targetId: id,
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
