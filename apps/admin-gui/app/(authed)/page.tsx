import {
  leadCountFor,
  listCarriers,
  listLeadLists,
  listNodesFromDb,
  listRoutePlans,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const nodes = listNodesFromDb();
  const carriers = listCarriers();
  const routePlans = listRoutePlans();
  const leadLists = listLeadLists();
  const ready = nodes.filter((n) => n.status === 'READY').length;
  const carriersEnabled = carriers.filter((c) => c.enabled === 1).length;
  const plansEnabled = routePlans.filter((p) => p.enabled === 1).length;
  const totalLeads = leadLists.reduce((acc, l) => acc + leadCountFor(l.id), 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Dashboard</h1>
      <p className="text-fg-muted text-sm mb-6">
        Welcome to DialerOS. Cluster status appears here as you add nodes,
        carriers, route plans, and lead lists.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 max-w-4xl">
        <Stat
          label="Nodes ready"
          value={`${ready} / ${nodes.length}`}
          accent={ready > 0 ? 'text-success' : 'text-fg'}
        />
        <Stat
          label="Carriers enabled"
          value={`${carriersEnabled} / ${carriers.length}`}
          accent={carriersEnabled > 0 ? 'text-success' : 'text-fg'}
        />
        <Stat
          label="Route plans"
          value={`${plansEnabled} / ${routePlans.length}`}
          accent={plansEnabled > 0 ? 'text-success' : 'text-fg'}
        />
        <Stat
          label="Lead lists"
          value={`${leadLists.length}`}
          accent={leadLists.length > 0 ? 'text-success' : 'text-fg'}
        />
        <Stat
          label="Total leads"
          value={totalLeads.toLocaleString()}
          accent={totalLeads > 0 ? 'text-success' : 'text-fg'}
        />
      </div>

      <div className="mt-8 max-w-3xl">
        <p className="text-xs text-fg-subtle">
          Phase 0 complete (provisioning, auth, audit). Phase 1 in progress â€”
          carrier management is the entry point. Live SIP routing arrives
          alongside the FreeSWITCH integration.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = 'text-fg',
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="border border-border rounded p-4">
      <div className="text-xs text-fg-subtle uppercase">{label}</div>
      <div className={`text-2xl mt-1 ${accent}`}>{value}</div>
    </div>
  );
}
