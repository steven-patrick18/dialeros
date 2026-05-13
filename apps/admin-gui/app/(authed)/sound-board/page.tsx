import { redirect } from 'next/navigation';
import { listAudioFiles } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { SoundBoardClient } from './sound-board-client';

export const dynamic = 'force-dynamic';

// Iter 150 — Sound Board. Admin-only audio library. Lists every
// uploaded/recorded file, lets admins preview inline (<audio
// controls>), record new files via the browser MediaRecorder API,
// or upload existing .wav / .mp3. All ingest paths route through
// ffmpeg for normalization to 8kHz mono PCM — FS's preferred
// shape for IVR playback.

export default async function SoundBoardPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Sound Board</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const initial = listAudioFiles();

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Sound Board</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Audio library referenced by call menus, voicemail drops,
        in-group greetings, hold music, disclaimers. Upload a
        .wav / .mp3 or record one directly in your browser —
        every file is normalized to 8 kHz mono PCM .wav for
        FreeSWITCH playback. TTS generation lands in iter 151.
      </p>
      <SoundBoardClient initial={initial} />
    </div>
  );
}
