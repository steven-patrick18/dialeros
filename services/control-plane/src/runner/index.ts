import { MockAnsibleRunner } from './mock';
import type { AnsibleRunner } from './types';

export type {
  AnsibleRunner,
  AnsibleRunnerInput,
  AnsibleRunnerResult,
} from './types';

// Phase 0 iter 2: always returns mock runner.
//
// Phase 0 iter 3 plan:
//   1. Detect `ansible-playbook` on PATH (Linux/macOS master)
//   2. Detect `wsl ansible-playbook` (Windows master with WSL)
//   3. Allow override via DIALEROS_RUNNER=mock|real env var
//   4. Return RealAnsibleRunner that spawns ansible-playbook as a child
//      process and pipes stdout into emit(...)
//   5. Fall back to mock with a clear "Ansible not detected" log line

let _runner: AnsibleRunner | null = null;

export function getRunner(): AnsibleRunner {
  if (!_runner) {
    _runner = new MockAnsibleRunner();
  }
  return _runner;
}
