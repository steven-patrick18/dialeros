import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import {
  getCampaign,
  getCampaignSurvey,
  parseSurveyOptions,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { SurveyEditor } from './survey-editor';

export const dynamic = 'force-dynamic';

// Iter 157 — Per-campaign survey admin page.
// Reached via the "Manage survey" link on /campaigns/[id].
// Renders the editor with the existing survey (if any) pre-loaded.
// Agent wrap-up consumption arrives in iter 158.

export default async function CampaignSurveyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Campaign survey</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) notFound();

  const existing = getCampaignSurvey(id);
  const initialData = existing
    ? {
        name: existing.survey.name,
        is_active: existing.survey.is_active === 1,
        questions: existing.questions.map((q) => ({
          ordering: q.ordering,
          question_text: q.question_text,
          question_type: q.question_type,
          options: parseSurveyOptions(q),
          is_required: q.is_required === 1,
        })),
      }
    : {
        name: `${campaign.name}_survey`,
        is_active: true,
        questions: [],
      };

  return (
    <div>
      <div className="text-xs text-fg-subtle mb-1">
        <Link
          href={`/campaigns/${id}`}
          className="text-link hover:underline"
        >
          ← back to {campaign.name}
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">Survey — {campaign.name}</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Short questionnaire the agent fills in during wrap-up after
        a connected call. Question types: single-choice, multi-choice,
        free text, numeric, or yes/no. Required questions block
        wrap-up submit. iter 158 ships the agent UI; iter 159 ships
        the per-question response report + CSV export.
      </p>
      <SurveyEditor
        campaignId={id}
        initial={initialData}
        hasExisting={Boolean(existing)}
      />
    </div>
  );
}
