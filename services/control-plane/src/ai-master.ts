// Iter 199 — Global Master AI (Phase L). One row id='global'.
// Skeleton: enable flag + config blob. Memory / exemplars /
// transfer-learning land in iters 200+.
import { getDb } from './db';

export interface AiMasterRow {
  id: string;
  enabled: number;
  config_json: string | null;
  created_at: string;
  updated_at: string;
}

export function getAiMaster(): AiMasterRow {
  const row = getDb()
    .prepare(`SELECT * FROM ai_master WHERE id = 'global'`)
    .get() as unknown as AiMasterRow | undefined;
  return (
    row ?? {
      id: 'global',
      enabled: 0,
      config_json: null,
      created_at: '',
      updated_at: '',
    }
  );
}

export function setAiMasterEnabled(on: boolean): void {
  getDb()
    .prepare(
      `UPDATE ai_master SET enabled = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'global'`,
    )
    .run(on ? 1 : 0);
}
