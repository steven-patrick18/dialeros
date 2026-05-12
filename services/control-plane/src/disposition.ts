import { z } from 'zod';
import { disposeIntent, type DialIntentRecord } from './db';
import { appendAudit } from './audit';

// ViciDial-style disposition codes. SALE/DNC are terminal;
// ANSWERING_MACHINE / CALLBACK / VOICEMAIL_DROPPED / SURVEYED
// leave the lead dialable so the pacer can revisit it.
//
// Iter 107 — added VOICEMAIL_DROPPED (we played our VM message)
// and SURVEYED (survey completed). Both are distinct from
// ANSWERING_MACHINE: they carry positive signal (the prospect
// got our content / completed our flow) which matters for
// dialable_status filtering (re-engage VM recipients on a
// different cadence than no-answers) and for the inbound
// whitelist (a return call from a VM_PLAYED lead routes to the
// campaign that left them the message).
export const DispositionSchema = z.enum([
  'SALE',
  'DNC',
  'NO_INTEREST',
  'WRONG_NUMBER',
  'BAD_NUMBER',
  'ANSWERING_MACHINE',
  'CALLBACK',
  'VOICEMAIL_DROPPED',
  'SURVEYED',
]);
export type Disposition = z.infer<typeof DispositionSchema>;

const DISPOSITION_TO_LEAD_STATUS: Record<Disposition, string> = {
  SALE: 'CONVERTED',
  DNC: 'DNC',
  NO_INTEREST: 'DEAD',
  WRONG_NUMBER: 'BAD_NUMBER',
  BAD_NUMBER: 'BAD_NUMBER',
  ANSWERING_MACHINE: 'CALLED_NO_ANSWER',
  CALLBACK: 'CALLBACK_SCHEDULED',
  VOICEMAIL_DROPPED: 'VM_PLAYED',
  SURVEYED: 'SURVEYED',
};

export const DisposeInputSchema = z
  .object({
    disposition: DispositionSchema,
    callback_at: z.string().datetime().optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (d) => d.disposition !== 'CALLBACK' || !!d.callback_at,
    {
      message: 'callback_at (ISO 8601) is required for CALLBACK disposition.',
      path: ['callback_at'],
    },
  );
export type DisposeInput = z.infer<typeof DisposeInputSchema>;

export interface DisposeResult {
  intent: DialIntentRecord;
  newLeadStatus: string;
}

/**
 * Apply an agent's disposition to a dial intent. Returns undefined when the
 * intent does not exist or is not assigned to userId — the API layer maps
 * that to 404 / 403 respectively.
 *
 * Idempotent: re-disposing a row that already has a disposition returns the
 * existing record without re-firing audit.
 */
export function disposeAgentIntent(args: {
  intentId: number;
  userId: string;
  ip: string | null;
  input: DisposeInput;
}): DisposeResult | undefined {
  const newLeadStatus = DISPOSITION_TO_LEAD_STATUS[args.input.disposition];
  const intent = disposeIntent({
    intentId: args.intentId,
    userId: args.userId,
    disposition: args.input.disposition,
    newLeadStatus,
    callbackAt: args.input.callback_at ?? null,
  });
  if (!intent) return undefined;

  // disposeIntent is idempotent — only audit if THIS call applied the change.
  if (intent.disposition === args.input.disposition && intent.dispositioned_at) {
    appendAudit({
      actorUserId: args.userId,
      actorIp: args.ip,
      action: 'intent.dispose',
      targetType: 'dial_intent',
      targetId: String(args.intentId),
      payload: {
        disposition: args.input.disposition,
        new_lead_status: newLeadStatus,
        callback_at: args.input.callback_at ?? null,
        note: args.input.note ?? null,
      },
    });
  }

  return { intent, newLeadStatus };
}
