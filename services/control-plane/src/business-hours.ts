// Iter 180 — Business-hours + holidays pure helpers. No DB / no
// process.env dependencies; trivially unit-testable.
//
// The schedule shape stored on in_groups.business_hours_json:
//   {
//     mon: { open: "09:00", close: "17:00" } | null,
//     tue: ..., wed: ..., thu: ..., fri: ..., sat: ..., sun: ...
//   }
// null/missing day = closed that day.
// null/missing JSON entirely = "always open" (24/7).
//
// timezone is an IANA name (e.g. 'America/New_York'); we use
// Intl.DateTimeFormat with `timeZone` option to get the local
// day-of-week and HH:MM cleanly without a date-fns dependency.

import { z } from 'zod';

const HHMM_RE = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

export const BusinessHoursDaySchema = z
  .object({
    open: z.string().regex(HHMM_RE),
    close: z.string().regex(HHMM_RE),
  })
  .nullable();

export const BusinessHoursScheduleSchema = z.object({
  mon: BusinessHoursDaySchema,
  tue: BusinessHoursDaySchema,
  wed: BusinessHoursDaySchema,
  thu: BusinessHoursDaySchema,
  fri: BusinessHoursDaySchema,
  sat: BusinessHoursDaySchema,
  sun: BusinessHoursDaySchema,
});

export type BusinessHoursDay = z.infer<typeof BusinessHoursDaySchema>;
export type BusinessHoursSchedule = z.infer<
  typeof BusinessHoursScheduleSchema
>;

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const DAY_KEYS: readonly DayKey[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

export function parseBusinessHoursJson(
  json: string | null | undefined,
): BusinessHoursSchedule | null {
  if (!json || json.trim() === '') return null;
  try {
    const parsed = BusinessHoursScheduleSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Returns the {dayKey, hhmm, dateStr} tuple in the given timezone
 * for the supplied UTC instant. dateStr is YYYY-MM-DD for the
 * holiday lookup. */
export function localizeInstant(
  now: Date,
  timezone: string,
): { dayKey: DayKey; hhmm: string; dateStr: string } {
  // The robust way to extract IANA-tz local fields without
  // pulling Luxon: format with the desired fields and parse back.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  // Intl's 'weekday' short is 'Mon', 'Tue', etc.; normalize:
  const wd = get('weekday').toLowerCase().slice(0, 3) as DayKey;
  const dayKey = (
    (DAY_KEYS as readonly string[]).includes(wd) ? wd : 'mon'
  ) as DayKey;
  return {
    dayKey,
    hhmm: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
    dateStr: `${year}-${month}-${day}`,
  };
}

export interface BusinessHoursContext {
  schedule: BusinessHoursSchedule | null;
  timezone: string;
  // YYYY-MM-DD strings of active holidays (org-wide). Closed on
  // any of these regardless of schedule.
  holidayDates: ReadonlySet<string>;
}

/** Open-now check. Null schedule = always open. Holiday match
 * = closed. Otherwise: today's window must exist and now must be
 * in [open, close). */
export function isOpenNow(
  ctx: BusinessHoursContext,
  now: Date = new Date(),
): boolean {
  const { dayKey, hhmm, dateStr } = localizeInstant(now, ctx.timezone);
  if (ctx.holidayDates.has(dateStr)) return false;
  if (!ctx.schedule) return true; // 24/7
  const win = ctx.schedule[dayKey];
  if (!win) return false; // closed that day
  return hhmm >= win.open && hhmm < win.close;
}

/** Closed reason for audit / response payloads. */
export function closedReason(
  ctx: BusinessHoursContext,
  now: Date = new Date(),
): 'open' | 'holiday' | 'closed_day' | 'after_hours' {
  const { dayKey, hhmm, dateStr } = localizeInstant(now, ctx.timezone);
  if (ctx.holidayDates.has(dateStr)) return 'holiday';
  if (!ctx.schedule) return 'open';
  const win = ctx.schedule[dayKey];
  if (!win) return 'closed_day';
  if (hhmm >= win.open && hhmm < win.close) return 'open';
  return 'after_hours';
}
