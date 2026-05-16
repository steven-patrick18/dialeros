import { redirect } from 'next/navigation';
import {
  getSelfNode,
  listAudioFiles,
  listAudioUsage,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { AudioCenterClient } from './client';

export const dynamic = 'force-dynamic';

// Iter 201 — Audio Center. Consolidates + upgrades the iter-150
// Sound Board: every audio file on this cluster, full details,
// who uses it, upload + safe delete. Single shared library root
// (/var/lib/dialeros/audio/library); node shown for ops context.

export default async function AudioCenterPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Audio Center</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const files = JSON.parse(JSON.stringify(listAudioFiles())) as Array<{
    id: string;
    name: string;
    description: string | null;
    category: string;
    path: string;
    source: string;
    duration_ms: number | null;
    size_bytes: number;
    created_at: string;
    created_by_user_id: string | null;
  }>;
  const usage = JSON.parse(JSON.stringify(listAudioUsage())) as Array<{
    audio_path: string;
    ref_type: string;
    ref_id: string;
    ref_name: string;
    field: string;
  }>;
  const self = getSelfNode();
  const totalBytes = files.reduce((a, f) => a + (f.size_bytes || 0), 0);

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold mb-1">Audio Center</h1>
      <p className="text-fg-subtle text-sm mb-4">
        Every audio file on this cluster — prompts, voicemail
        drops, recording notices, hold music, disclaimers — with
        size, duration, source, and exactly which campaigns /
        call-menus consume it. Upload here; files normalize to
        8&nbsp;kHz mono PCM .wav for FreeSWITCH.
      </p>
      <AudioCenterClient
        initialFiles={files}
        usage={usage}
        stats={{
          count: files.length,
          totalBytes,
          root: '/var/lib/dialeros/audio/library',
          node: self?.name ?? '(unregistered)',
        }}
      />
    </div>
  );
}
