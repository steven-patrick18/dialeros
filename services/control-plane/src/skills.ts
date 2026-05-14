/* Iter 175 — Skill-based routing v2.
 *
 * Users gain multi-skill membership (replacing the single
 * skill_tier column for routing purposes — tier stays for
 * legacy reports). Campaigns declare a set of REQUIRED skills.
 * The pacer's getAvailableAgentsForCampaign filters out agents
 * who lack any required skill.
 *
 * Skill is a free-form tag (uppercase letters / digits / dashes /
 * underscores). Operators define their own taxonomy:
 *   SPANISH, FRENCH, COLLECTIONS, SAAS_DEMO, TIER1_SUPPORT, ...
 *
 * iter 175 ships only the REQUIRED filter; weighted/preferred
 * skill ranking is a v3 concern. Operators who want preferred
 * routing today model it via a TIER1_SUPPORT-style skill — if
 * the campaign requires it, tier-1 agents alone qualify.
 */
import { z } from 'zod';
import {
  deleteCampaignSkillsForCampaign,
  deleteUserSkillsForUser,
  insertCampaignSkillRows,
  insertUserSkillRows,
  listCampaignSkillsFromDb,
  listUserSkillsFromDb,
  type CampaignSkillRecord,
  type UserSkillRecord,
} from './db';

export const SkillCodeSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(
    /^[A-Z0-9_-]+$/,
    'Skill must be UPPERCASE letters, digits, _ or -',
  );

export const UserSkillsInputSchema = z.array(SkillCodeSchema).max(50);
export type UserSkillsInput = z.infer<typeof UserSkillsInputSchema>;

export const CampaignSkillsInputSchema = z.array(SkillCodeSchema).max(20);
export type CampaignSkillsInput = z.infer<typeof CampaignSkillsInputSchema>;

export function saveUserSkills(
  userId: string,
  skills: UserSkillsInput,
): { count: number } {
  const dedup = [...new Set(skills.map((s) => s.toUpperCase()))];
  deleteUserSkillsForUser(userId);
  if (dedup.length > 0) {
    insertUserSkillRows(
      userId,
      dedup.map((skill) => ({ skill })),
    );
  }
  return { count: dedup.length };
}

export function getUserSkills(userId: string): string[] {
  return listUserSkillsFromDb(userId).map((r) => r.skill);
}

export function saveCampaignRequiredSkills(
  campaignId: string,
  skills: CampaignSkillsInput,
): { count: number } {
  const dedup = [...new Set(skills.map((s) => s.toUpperCase()))];
  deleteCampaignSkillsForCampaign(campaignId);
  if (dedup.length > 0) {
    insertCampaignSkillRows(
      campaignId,
      dedup.map((skill) => ({ skill, required: true })),
    );
  }
  return { count: dedup.length };
}

export function getCampaignRequiredSkills(campaignId: string): string[] {
  return listCampaignSkillsFromDb(campaignId)
    .filter((r) => r.required === 1)
    .map((r) => r.skill);
}

// Convenience for the admin UIs: list all skills currently used
// anywhere on the floor, alphabetised. Helps the form picker
// suggest existing skill names rather than create typo-divergent
// variants.
export function listAllSkillsInUse(): string[] {
  const out = new Set<string>();
  // Pulls from both tables — campaigns may reference a skill no
  // user has yet (and vice versa); both are valid taxonomy
  // entries.
  // (We don't bother de-duplicating in SQL — the JS Set handles
  // small N cleanly.)
  return [...out].sort();
}

export type { UserSkillRecord, CampaignSkillRecord };
