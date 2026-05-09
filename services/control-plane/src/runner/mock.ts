import type { NodeRole } from '../schema';
import type {
  AnsibleRunner,
  AnsibleRunnerInput,
  AnsibleRunnerResult,
} from './types';

interface PhaseStep {
  phase: string;
  message: string;
  ms: number;
}

const COMMON_STEPS: PhaseStep[] = [
  { phase: 'common:hostname', message: 'Setting hostname to {name}', ms: 600 },
  {
    phase: 'common:packages',
    message: 'Installing base packages: python3 sudo curl rsync ufw chrony',
    ms: 1500,
  },
  { phase: 'common:user', message: 'Creating dialeros service user', ms: 400 },
  { phase: 'common:sudo', message: 'Configuring sudoers for dialeros', ms: 300 },
  {
    phase: 'common:firewall',
    message: 'Enabling UFW (default-deny inbound, allow SSH)',
    ms: 500,
  },
];

const ROLE_STEPS: Record<NodeRole, PhaseStep[]> = {
  telephony: [
    {
      phase: 'telephony:stub',
      message: 'Phase 1 stub — Kamailio + FreeSWITCH install pending',
      ms: 600,
    },
  ],
  web: [
    {
      phase: 'web:stub',
      message: 'Phase 0 iter 3 stub — Node.js + nginx install pending',
      ms: 600,
    },
  ],
  database: [
    {
      phase: 'database:stub',
      message: 'Phase 0 iter 3 stub — PostgreSQL install pending',
      ms: 600,
    },
  ],
  'ai-worker': [
    {
      phase: 'ai-worker:stub',
      message: 'Phase 4 stub — whisper + llama + Piper toolchain pending',
      ms: 600,
    },
  ],
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class MockAnsibleRunner implements AnsibleRunner {
  readonly kind = 'mock' as const;

  async run(input: AnsibleRunnerInput): Promise<AnsibleRunnerResult> {
    const { input: cfg, emit } = input;

    emit(
      'INFO',
      'init',
      `Connecting to ${cfg.ssh_user}@${cfg.host}:${cfg.port} (mock — no real SSH)`,
    );
    await wait(700);
    emit('INFO', 'init', 'SSH connection established');
    await wait(200);

    // Convention: a node name containing "fail" deterministically fails
    // partway through, so the FAILED status path is testable without code edits.
    const shouldFail = cfg.name.toLowerCase().includes('fail');

    const steps = [...COMMON_STEPS, ...ROLE_STEPS[cfg.role]];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      emit(
        'PHASE',
        step.phase,
        '▶ ' + step.message.replace('{name}', cfg.name),
      );
      await wait(step.ms);

      // Inject failure midway through if the node name says so.
      if (shouldFail && i === Math.floor(steps.length / 2)) {
        emit(
          'ERROR',
          step.phase,
          'Failed to acquire dpkg lock — apt held by another process',
        );
        return {
          ok: false,
          error: `${step.phase}: apt lock held by another process`,
        };
      }

      emit('INFO', step.phase, '  ok');
    }

    emit('INFO', 'finalize', 'Touching /etc/dialeros/bootstrap.done');
    await wait(250);

    return { ok: true };
  }
}
