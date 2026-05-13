/* Iter 149 — Call Menu (IVR) domain module.
 *
 * A Call Menu is a DTMF-driven branch point:
 *   prompt audio (or TTS text) plays -> caller presses a digit ->
 *   the matched option routes to a destination (in-group,
 *   extension, voicemail, another call menu, DID, or hangup).
 *
 * Entry points (where calls flow INTO a menu):
 *   - DIDs                    iter 151 wires dids.call_menu_id
 *   - In-groups (overflow /
 *     after-hours)            iter 151 wires the two FK columns
 *   - Campaigns (no-agent
 *     drop instead of
 *     &hangup abandon)        iter 151 wires no_agent_call_menu_id
 *
 * Iter 149 ships the model + CRUD only. iter 150 generates the
 * FreeSWITCH dialplan from the model. iter 151 wires the entry
 * points. iter 152 adds analytics.
 *
 * Option ordering matters for the UI (drag-to-reorder), not for
 * routing — digits are unique per menu, the dialplan branches by
 * digit value not by ordering. Ordering is just a stable sort
 * key for display.
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  deleteCallMenuFromDb,
  getCallMenuFromDb,
  insertCallMenu,
  listCallMenuOptionsFromDb,
  listCallMenusFromDb,
  replaceCallMenuOptions,
  updateCallMenuFields,
  type CallMenuOptionRecord,
  type CallMenuRecord,
} from './db';

export const CallMenuActionTypeSchema = z.enum([
  'hangup',
  'voicemail',
  'in_group',
  'extension',
  'call_menu',
  'did',
]);
export type CallMenuActionType = z.infer<typeof CallMenuActionTypeSchema>;

// Valid DTMF digits. 0-9 + * + #. No A/B/C/D (POTS/SIP rarely
// signals those, and the .xml generator's regex matches base
// keypad only).
export const CallMenuDigitSchema = z
  .string()
  .regex(/^[0-9*#]$/, 'Digit must be 0-9, *, or #.');

export const CallMenuOptionInputSchema = z.object({
  digit: CallMenuDigitSchema,
  ordering: z.number().int().min(0).max(99).default(0),
  action_type: CallMenuActionTypeSchema,
  // The shape of action_value depends on action_type:
  //   hangup        — ''           (ignored; sentinel)
  //   voicemail     — path or ''   (path optional; empty = just hangup)
  //   in_group      — in_groups.id
  //   extension     — phone extension or sip URI
  //   call_menu     — sub-menu's call_menus.id
  //   did           — E.164 phone we transfer to
  // Validation of the cross-table reference happens at iter 151
  // wire-up; iter 149 just stores the string.
  action_value: z.string().max(255).default(''),
  label: z.string().max(64).default(''),
});
export type CallMenuOptionInput = z.infer<typeof CallMenuOptionInputSchema>;

export const CallMenuInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        'Alphanumeric, dashes, underscores only.',
      ),
    description: z.string().max(500).default(''),
    // Iter 149 stores TTS text only. Iter 150 adds audio upload
    // and prompt_path. Both fields exist on the table so iter 150
    // doesn't need another migration.
    prompt_tts_text: z.string().max(2000).default(''),
    prompt_path: z.string().max(512).default(''),
    timeout_seconds: z.number().int().min(1).max(60).default(5),
    max_retries: z.number().int().min(1).max(10).default(3),
    invalid_audio_path: z.string().max(512).default(''),
    timeout_audio_path: z.string().max(512).default(''),
    default_action_type: CallMenuActionTypeSchema.default('hangup'),
    default_action_value: z.string().max(255).default(''),
    options: z.array(CallMenuOptionInputSchema).max(12).default([]),
  })
  .refine(
    (d) => {
      // Digits unique per menu — two options both bound to "1"
      // would create an ambiguous dialplan branch.
      const seen = new Set<string>();
      for (const opt of d.options) {
        if (seen.has(opt.digit)) return false;
        seen.add(opt.digit);
      }
      return true;
    },
    { message: 'Duplicate digit across options.', path: ['options'] },
  );
export type CallMenuInput = z.infer<typeof CallMenuInputSchema>;

export interface CreateCallMenuResult {
  id: string;
}

export function createCallMenu(input: CallMenuInput): CreateCallMenuResult {
  const id = randomUUID();
  insertCallMenu({
    id,
    name: input.name,
    description: input.description || null,
    prompt_tts_text: input.prompt_tts_text || null,
    prompt_path: input.prompt_path || null,
    timeout_seconds: input.timeout_seconds,
    max_retries: input.max_retries,
    invalid_audio_path: input.invalid_audio_path || null,
    timeout_audio_path: input.timeout_audio_path || null,
    default_action_type: input.default_action_type,
    default_action_value: input.default_action_value || null,
  });
  replaceCallMenuOptions(
    id,
    input.options.map((o, idx) => ({
      digit: o.digit,
      ordering: o.ordering || idx,
      action_type: o.action_type,
      action_value: o.action_value || null,
      label: o.label || null,
    })),
  );
  return { id };
}

export function listCallMenus(): CallMenuRecord[] {
  return listCallMenusFromDb();
}

export function getCallMenu(id: string): CallMenuRecord | undefined {
  return getCallMenuFromDb(id);
}

export function getCallMenuOptions(id: string): CallMenuOptionRecord[] {
  return listCallMenuOptionsFromDb(id);
}

export function updateCallMenu(
  id: string,
  input: CallMenuInput,
): boolean {
  const existing = getCallMenuFromDb(id);
  if (!existing) return false;
  updateCallMenuFields(id, {
    name: input.name,
    description: input.description || null,
    prompt_tts_text: input.prompt_tts_text || null,
    prompt_path: input.prompt_path || null,
    timeout_seconds: input.timeout_seconds,
    max_retries: input.max_retries,
    invalid_audio_path: input.invalid_audio_path || null,
    timeout_audio_path: input.timeout_audio_path || null,
    default_action_type: input.default_action_type,
    default_action_value: input.default_action_value || null,
  });
  replaceCallMenuOptions(
    id,
    input.options.map((o, idx) => ({
      digit: o.digit,
      ordering: o.ordering || idx,
      action_type: o.action_type,
      action_value: o.action_value || null,
      label: o.label || null,
    })),
  );
  return true;
}

export function deleteCallMenu(id: string): boolean {
  return deleteCallMenuFromDb(id);
}
