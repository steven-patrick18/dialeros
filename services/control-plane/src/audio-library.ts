/* Iter 150 — Sound Board (audio library) domain module.
 *
 * Central catalogue of audio files referenced by call menus,
 * voicemail drops, in-group greetings, hold music, disclaimers.
 * Replaces the per-feature "type a path here" pattern that
 * was easy to typo and impossible to inventory.
 *
 * Two ingest paths in iter 150 (TTS arrives in iter 151):
 *   - upload  — operator uploads a .wav/.mp3; ffmpeg normalizes
 *               to FreeSWITCH's preferred shape (8kHz mono PCM
 *               .wav). Stored at /var/lib/dialeros/audio/library/<id>.wav.
 *   - record  — operator records inline via the browser
 *               MediaRecorder API; server-side blob is fed
 *               through ffmpeg the same way.
 *
 * Files are immutable once stored — to "edit" an entry you
 * delete it and upload a replacement. Keeps the audit trail
 * meaningful (a referenced file can't change underneath a
 * call menu without admin noticing).
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  deleteAudioFileFromDb,
  getAudioFileFromDb,
  insertAudioFile,
  listAudioFilesFromDb,
  type AudioFileRecord,
} from './db';

export const AudioCategorySchema = z.enum([
  'menu_prompt',
  'hold',
  'voicemail',
  'disclaimer',
  'other',
]);
export type AudioCategory = z.infer<typeof AudioCategorySchema>;

export const AudioSourceSchema = z.enum([
  'uploaded',
  'recorded',
  // Iter 151 — TTS via local piper-tts. Audit-trail shows the
  // tts_text + tts_voice used at generation time (stored in the
  // audio_files row's description column for now).
  'tts',
]);
export type AudioSource = z.infer<typeof AudioSourceSchema>;

export const AudioFileMetaSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z0-9 _-]+$/,
      'Alphanumeric, spaces, dashes, underscores only.',
    ),
  description: z.string().max(500).default(''),
  category: AudioCategorySchema.default('menu_prompt'),
});
export type AudioFileMeta = z.infer<typeof AudioFileMetaSchema>;

// The library lives outside the next.js process root so a build
// rotation doesn't blow away the operator's recordings. FS reads
// from the same path so make sure freeswitch group can traverse.
export const AUDIO_LIBRARY_ROOT = '/var/lib/dialeros/audio/library';

export function newAudioFileId(): string {
  return randomUUID();
}

export function audioFilePath(id: string): string {
  return `${AUDIO_LIBRARY_ROOT}/${id}.wav`;
}

export function registerAudioFile(args: {
  id: string;
  name: string;
  description: string;
  category: AudioCategory;
  source: AudioSource;
  duration_ms: number | null;
  size_bytes: number;
  created_by_user_id: string | null;
}): void {
  insertAudioFile({
    id: args.id,
    name: args.name,
    description: args.description || null,
    category: args.category,
    path: audioFilePath(args.id),
    source: args.source,
    duration_ms: args.duration_ms,
    size_bytes: args.size_bytes,
    created_by_user_id: args.created_by_user_id,
  });
}

export function listAudioFiles(
  category?: AudioCategory,
): AudioFileRecord[] {
  return listAudioFilesFromDb(category);
}

export function getAudioFile(id: string): AudioFileRecord | undefined {
  return getAudioFileFromDb(id);
}

export function deleteAudioFile(id: string): boolean {
  return deleteAudioFileFromDb(id);
}
