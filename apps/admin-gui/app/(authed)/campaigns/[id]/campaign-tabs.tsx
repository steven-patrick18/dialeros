import Link from 'next/link';

export type CampaignTabKey = 'basic' | 'detail' | 'list-mix' | 'realtime';

const TABS: { key: CampaignTabKey; label: string }[] = [
  { key: 'basic', label: 'Basic View' },
  { key: 'detail', label: 'Detail View' },
  { key: 'list-mix', label: 'List Mix' },
  { key: 'realtime', label: 'Real-Time' },
];

export function CampaignTabs({
  id,
  active,
}: {
  id: string;
  active: CampaignTabKey;
}) {
  return (
    <div className="border-b border-border mb-6 flex items-end gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const href =
          t.key === 'basic'
            ? `/campaigns/${id}`
            : `/campaigns/${id}?tab=${t.key}`;
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={href}
            className={`px-4 py-2 text-sm rounded-t border border-b-0 ${
              isActive
                ? 'bg-card border-border text-fg -mb-px relative z-10'
                : 'border-transparent text-fg-muted hover:text-fg hover:bg-card-hover/30'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

export function parseCampaignTab(raw: string | undefined): CampaignTabKey {
  if (raw === 'detail' || raw === 'list-mix' || raw === 'realtime') return raw;
  return 'basic';
}
