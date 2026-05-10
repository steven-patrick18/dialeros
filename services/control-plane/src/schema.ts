import { z } from 'zod';

export const NodeRoleSchema = z.enum([
  'telephony',
  'web',
  'database',
  'ai-worker',
]);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

// Iter 61 — nodes can wear multiple roles. The single-box default
// is a node that's `web + database + telephony` at the same time.
// Splitting the deploy later is just unchecking + checking roles on
// the relevant nodes.
export const NodeRolesSchema = z
  .array(NodeRoleSchema)
  .min(1, 'Pick at least one role.');

export const NodeInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric, underscores, or hyphens.'),
  host: z.string().min(1, 'Host is required.'),
  port: z.number().int().min(1).max(65535).default(22),
  ssh_user: z.string().min(1).default('root'),
  ssh_password: z.string().min(1, 'SSH password is required.'),
  // Either `role` (legacy single) or `roles` (multi) accepted. The
  // node module normalises to the multi shape at write time.
  role: NodeRoleSchema.optional(),
  roles: NodeRolesSchema.optional(),
});
export type NodeInput = z.infer<typeof NodeInputSchema>;

export const NodeStatusSchema = z.enum(['PROVISIONING', 'READY', 'FAILED']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export interface NodeRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  ssh_user: string;
  /** @deprecated since iter 61 — read `roles` instead. Kept for
   * row-level back-compat until every code path migrates. */
  role: NodeRole;
  /** JSON-encoded NodeRole[] in DB; parsed to string[] in helpers. */
  roles: string | null;
  /** Iter 61 — true for the auto-registered "this host" row. The
   * node UI hides destructive ops on self rows so a single-box
   * admin can't delete themselves out of the system. */
  is_self: number;
  status: NodeStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
