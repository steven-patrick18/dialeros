import type { ProvisioningLevel } from '../event-bus';
import type { NodeInput } from '../schema';

export interface AnsibleRunnerInput {
  nodeId: string;
  input: NodeInput;
  emit: (level: ProvisioningLevel, phase: string, message: string) => void;
}

export type AnsibleRunnerResult =
  | { ok: true }
  | { ok: false; error: string };

export interface AnsibleRunner {
  readonly kind: 'mock' | 'real';
  run(input: AnsibleRunnerInput): Promise<AnsibleRunnerResult>;
}
