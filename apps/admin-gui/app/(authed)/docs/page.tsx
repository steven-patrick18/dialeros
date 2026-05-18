import { redirect } from 'next/navigation';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Iter 216 — admin Documentation page: download the generated
// Administrator Manual + the page-by-page Presentation (PDF).

const DOCS_DIR =
  process.env.DIALEROS_DOCS_DIR ??
  resolve(process.cwd(), '../../docs');

function meta(name: string): {
  size: string;
  updated: string;
  ok: boolean;
} {
  try {
    const s = statSync(resolve(DOCS_DIR, name));
    return {
      size: (s.size / 1024 / 1024).toFixed(2) + ' MB',
      updated: s.mtime.toISOString().slice(0, 16).replace('T', ' '),
      ok: true,
    };
  } catch {
    return { size: '—', updated: '—', ok: false };
  }
}

export default async function DocsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Documentation</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const docs = [
    {
      file: 'DialerOS-Admin-Manual.pdf',
      title: 'Administrator Manual',
      desc: 'Full operations & configuration guide — telephony, inbound/outbound, agents, the Master/Worker AI, reports, cluster, settings, troubleshooting, and go-live checklists.',
    },
    {
      file: 'DialerOS-Presentation.pdf',
      title: 'Admin Presentation (page-by-page)',
      desc: 'A guided tour: every key admin page with a screenshot, its purpose, and the key actions. Good for onboarding & training new admins/supervisors.',
    },
  ];
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">Documentation</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Downloadable guides for running DialerOS. Admin only.
      </p>
      <div className="space-y-4">
        {docs.map((d) => {
          const m = meta(d.file);
          return (
            <div
              key={d.file}
              className="border border-border rounded p-4 bg-card flex items-start gap-4"
            >
              <div className="flex-1">
                <h2 className="text-sm font-semibold">{d.title}</h2>
                <p className="text-xs text-fg-subtle mt-1">{d.desc}</p>
                <p className="text-[11px] text-fg-muted mt-2">
                  PDF · {m.size}
                  {m.ok
                    ? ` · updated ${m.updated} UTC`
                    : ' · not generated yet'}
                </p>
              </div>
              {m.ok ? (
                <a
                  href={`/api/docs/${d.file}`}
                  className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm whitespace-nowrap self-center"
                >
                  Download PDF
                </a>
              ) : (
                <span className="text-xs text-fg-muted self-center">
                  unavailable
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-fg-muted mt-6">
        Tip: regenerate these after major UI changes so screenshots
        stay current.
      </p>
    </div>
  );
}
