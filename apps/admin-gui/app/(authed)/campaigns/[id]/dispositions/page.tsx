import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import {
  LEAD_STATUS_TARGETS,
  getCampaign,
  getCampaignDispositionPalette,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { PaletteEditor } from './editor';

export const dynamic = 'force-dynamic';

export default async function CampaignDispositionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">
          Disposition palette
        </h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) notFound();
  const palette = JSON.parse(
    JSON.stringify(getCampaignDispositionPalette(id)),
  );

  return (
    <div className="max-w-3xl">
      <div className="text-xs text-fg-subtle mb-1">
        <Link
          href={`/campaigns/${id}`}
          className="text-link hover:underline"
        >
          ← back to {campaign.name}
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">
        Disposition palette — {campaign.name}
      </h1>
      <p className="text-fg-subtle text-sm mb-6">
        Custom disposition codes for this campaign. When set,
        agents wrapping up calls on this campaign see THIS list
        instead of the floor-wide hardcoded set. Empty palette =
        falls back to hardcoded (SALE / CALLBACK / NO_INTEREST /
        etc.). Each code maps to a lead status — picking it on
        wrap-up sets that lead&apos;s status accordingly.
      </p>
      <PaletteEditor
        campaignId={id}
        initial={palette}
        leadStatusOptions={[...LEAD_STATUS_TARGETS]}
      />
    </div>
  );
}
