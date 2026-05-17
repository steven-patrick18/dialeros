import { redirect } from 'next/navigation';
import {
  getAiMaster,
  listCampaigns,
  listInGroups,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { userHasPermission } from '@dialeros/control-plane';
import { MasterToggle } from './toggle';
import { MemoryManager } from './memory';
import { PerfPanel } from './perf';

export const dynamic = 'force-dynamic';

// Iter 199 — Master AI (Phase L) skeleton. Identity discipline
// shipped this iter (persona name/designation, hard-guarded +
// reply-scrubbed). The global Master's memory (RAG), auto-
// curated exemplars, inbound-agent, learn-when-to-transfer, and
// portable/stackable brain land in iters 200-206.

export default async function AiMasterPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (!userHasPermission(me, 'ai.manage')) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Master AI</h1>
        <p className="text-error text-sm">ai.manage required.</p>
      </div>
    );
  }
  const m = getAiMaster();
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">
        Master AI <span className="text-fg-subtle text-base">· Phase L</span>
      </h1>
      <p className="text-fg-subtle text-sm mb-6">
        The global Master coordinates Workers + accumulates memory
        scoped per in-group / campaign. This iter ships identity
        discipline (set a persona&apos;s name + designation on{' '}
        <a href="/settings/ai-personas" className="text-link hover:underline">
          AI personas
        </a>{' '}
        — it states only that, hard-guarded + reply-scrubbed,
        never &ldquo;AI&rdquo;). Memory / exemplars / inbound-
        agent / learn-to-transfer / portable brain land in the
        next iters; the toggle below arms the Master once those
        ship.
      </p>
      <MasterToggle initialEnabled={m.enabled === 1} />
      <MemoryManager
        campaigns={JSON.parse(
          JSON.stringify(
            listCampaigns().map((c) => ({ id: c.id, name: c.name })),
          ),
        )}
        inGroups={JSON.parse(
          JSON.stringify(
            listInGroups().map((g) => ({ id: g.id, name: g.name })),
          ),
        )}
      />
      <PerfPanel />
    </div>
  );
}
