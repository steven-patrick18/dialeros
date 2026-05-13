/* Iter 157 — Per-campaign short survey domain module.
 *
 * Phase H opener. Per-campaign questionnaires the agent fills in
 * during wrap-up (iter 158 ships the agent UI; iter 159 ships the
 * export + report).
 *
 * Data model:
 *   campaign_surveys      one row per campaign (UNIQUE constraint)
 *   survey_questions      ordered questions; question_type drives
 *                         the agent UI widget
 *   survey_answers        one row per (dial_intent, question);
 *                         agent who answered + when + the value
 *
 * Question types:
 *   single_choice   radio buttons, options_json = ["yes", "no", "maybe"]
 *   multi_choice    checkboxes, answer is JSON array of selected
 *   text            free-text input, options unused
 *   numeric         numeric input, options can carry [min, max]
 *   yes_no          shortcut for single_choice [yes, no] with
 *                   single-button UI render
 *
 * One survey per campaign keeps iter 157 simple. Multi-survey per
 * campaign (A/B testing different question sets) can ride iter
 * 159's reporting work if operators ask.
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  deleteSurveyFromDb,
  getSurveyForCampaign,
  insertSurvey,
  listSurveyQuestionsFromDb,
  replaceSurveyQuestions,
  updateSurveyFields,
  type SurveyQuestionRecord,
  type SurveyRecord,
} from './db';

export const SurveyQuestionTypeSchema = z.enum([
  'single_choice',
  'multi_choice',
  'text',
  'numeric',
  'yes_no',
]);
export type SurveyQuestionType = z.infer<typeof SurveyQuestionTypeSchema>;

export const SurveyQuestionInputSchema = z
  .object({
    ordering: z.number().int().min(0).max(99).default(0),
    question_text: z.string().min(1).max(500),
    question_type: SurveyQuestionTypeSchema,
    options: z.array(z.string().max(80)).max(20).default([]),
    is_required: z.boolean().default(false),
  })
  .refine(
    (d) =>
      // choice types must carry options; non-choice types ignore options.
      (d.question_type !== 'single_choice' &&
        d.question_type !== 'multi_choice') ||
      d.options.length >= 2,
    {
      message:
        'single_choice / multi_choice questions need at least 2 options.',
      path: ['options'],
    },
  );
export type SurveyQuestionInput = z.infer<typeof SurveyQuestionInputSchema>;

export const SurveyInputSchema = z.object({
  name: z.string().min(1).max(64),
  is_active: z.boolean().default(true),
  questions: z.array(SurveyQuestionInputSchema).max(30).default([]),
});
export type SurveyInput = z.infer<typeof SurveyInputSchema>;

export interface SurveyWithQuestions {
  survey: SurveyRecord;
  questions: SurveyQuestionRecord[];
}

/** Idempotent "save the survey for this campaign" — creates a new
 * survey row if none exists, else updates in place. Either way
 * the questions are replaced atomically (delete-and-insert in a
 * single transaction). Returns the new/updated survey id. */
export function saveCampaignSurvey(
  campaignId: string,
  input: SurveyInput,
): { id: string } {
  const existing = getSurveyForCampaign(campaignId);
  let id: string;
  if (existing) {
    id = existing.id;
    updateSurveyFields(id, {
      name: input.name,
      is_active: input.is_active,
    });
  } else {
    id = randomUUID();
    insertSurvey({
      id,
      campaign_id: campaignId,
      name: input.name,
      is_active: input.is_active,
    });
  }
  replaceSurveyQuestions(
    id,
    input.questions.map((q, idx) => ({
      ordering: q.ordering || idx,
      question_text: q.question_text,
      question_type: q.question_type,
      options_json:
        q.options.length > 0 ? JSON.stringify(q.options) : null,
      is_required: q.is_required,
    })),
  );
  return { id };
}

export function getCampaignSurvey(
  campaignId: string,
): SurveyWithQuestions | undefined {
  const survey = getSurveyForCampaign(campaignId);
  if (!survey) return undefined;
  return {
    survey,
    questions: listSurveyQuestionsFromDb(survey.id),
  };
}

export function deleteCampaignSurvey(campaignId: string): boolean {
  const existing = getSurveyForCampaign(campaignId);
  if (!existing) return false;
  return deleteSurveyFromDb(existing.id);
}

/** Parse the options_json column for the agent UI. Returns []
 * when unset or malformed (defensive — bad JSON shouldn't crash
 * the wrap-up screen). */
export function parseSurveyOptions(
  rec: SurveyQuestionRecord,
): string[] {
  if (!rec.options_json) return [];
  try {
    const parsed = JSON.parse(rec.options_json) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
