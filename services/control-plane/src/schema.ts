import { z } from 'zod';

export const NodeRoleSchema = z.enum([
  'telephony',
  'web',
  'database',
  'ai-worker',
]);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

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
  role: NodeRoleSchema,
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
  role: NodeRole;
  status: NodeStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
