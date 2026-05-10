import Link from 'next/link';

// Iter 42 — ViciDial-style top module strip. Only renders inside the
// vicidial theme (CSS in globals.css toggles display via .vicidial-
// modulestrip). Mirrors ViciDial's classic dark-blue header band with
// module links across the top: AGENT | ADMIN | REPORTS | etc.
//
// On other themes the strip is `display: none` so the page chrome is
// unchanged.

const MODULES_ADMIN: Array<{ label: string; href: string }> = [
  { label: 'Agent', href: '/agent' },
  { label: 'Admin', href: '/' },
  { label: 'Reports', href: '/reports' },
  { label: 'Audit', href: '/audit' },
  { label: 'Cluster', href: '/cluster/nodes' },
];

const MODULES_AGENT: Array<{ label: string; href: string }> = [
  { label: 'Agent', href: '/agent' },
];

export function ModuleStrip({ role }: { role: string }) {
  const items = role === 'agent' ? MODULES_AGENT : MODULES_ADMIN;
  return (
    <div
      className="vicidial-modulestrip"
      style={{
        background:
          'linear-gradient(180deg, #4f7fc7 0%, #3a5fb1 50%, #2a4a91 100%)',
        borderBottom: '1px solid #1f3f87',
        color: '#ffffff',
        padding: '6px 16px',
        fontFamily: 'Verdana, Geneva, Arial, sans-serif',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span
          style={{
            fontWeight: 700,
            letterSpacing: '0.04em',
            textShadow: '0 -1px 0 rgba(0,0,0,0.25)',
          }}
        >
          DialerOS
        </span>
        <span style={{ opacity: 0.4 }}>|</span>
        <nav style={{ display: 'flex', gap: 14 }}>
          {items.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              style={{
                color: '#ffffff',
                textDecoration: 'none',
                textShadow: '0 -1px 0 rgba(0,0,0,0.25)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {m.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
