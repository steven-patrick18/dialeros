// Iter 180 — Pure-function tests for the business-hours helpers.
import { describe, expect, it } from 'vitest';
import {
  closedReason,
  isOpenNow,
  localizeInstant,
  parseBusinessHoursJson,
  type BusinessHoursContext,
  type BusinessHoursSchedule,
} from '../src/business-hours';

const MF9TO5: BusinessHoursSchedule = {
  mon: { open: '09:00', close: '17:00' },
  tue: { open: '09:00', close: '17:00' },
  wed: { open: '09:00', close: '17:00' },
  thu: { open: '09:00', close: '17:00' },
  fri: { open: '09:00', close: '17:00' },
  sat: null,
  sun: null,
};

function ctx(
  schedule: BusinessHoursSchedule | null,
  timezone: string,
  holidays: string[] = [],
): BusinessHoursContext {
  return {
    schedule,
    timezone,
    holidayDates: new Set(holidays),
  };
}

describe('parseBusinessHoursJson', () => {
  it('parses a valid schedule', () => {
    const json = JSON.stringify(MF9TO5);
    const out = parseBusinessHoursJson(json);
    expect(out).toEqual(MF9TO5);
  });

  it('returns null for null/empty input', () => {
    expect(parseBusinessHoursJson(null)).toBeNull();
    expect(parseBusinessHoursJson('')).toBeNull();
    expect(parseBusinessHoursJson('   ')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseBusinessHoursJson('not json')).toBeNull();
    expect(parseBusinessHoursJson('{"mon":')).toBeNull();
  });

  it('returns null when a day window has bad HH:MM', () => {
    const bad = JSON.stringify({ ...MF9TO5, mon: { open: '9am', close: '5pm' } });
    expect(parseBusinessHoursJson(bad)).toBeNull();
  });
});

describe('localizeInstant', () => {
  it('returns UTC fields under UTC', () => {
    // 2026-05-14 (Thu) 14:30:00 UTC
    const now = new Date(Date.UTC(2026, 4, 14, 14, 30, 0));
    const out = localizeInstant(now, 'UTC');
    expect(out.dayKey).toBe('thu');
    expect(out.hhmm).toBe('14:30');
    expect(out.dateStr).toBe('2026-05-14');
  });

  it('respects the IANA timezone', () => {
    // Same UTC instant; America/New_York at 14:30 UTC = 10:30 EDT
    // (May 14 is during DST).
    const now = new Date(Date.UTC(2026, 4, 14, 14, 30, 0));
    const out = localizeInstant(now, 'America/New_York');
    expect(out.dayKey).toBe('thu');
    expect(out.hhmm).toBe('10:30');
    expect(out.dateStr).toBe('2026-05-14');
  });

  it('rolls over the calendar date when tz crosses midnight', () => {
    // 02:00 UTC = 22:00 prev day EDT
    const now = new Date(Date.UTC(2026, 4, 14, 2, 0, 0));
    const out = localizeInstant(now, 'America/New_York');
    expect(out.dateStr).toBe('2026-05-13');
    expect(out.dayKey).toBe('wed');
    expect(out.hhmm).toBe('22:00');
  });
});

describe('isOpenNow', () => {
  it('always-open when schedule is null', () => {
    const c = ctx(null, 'UTC');
    expect(isOpenNow(c, new Date('2026-05-14T03:00:00Z'))).toBe(true);
    expect(isOpenNow(c, new Date('2026-05-17T12:00:00Z'))).toBe(true); // Sun
  });

  it('open during Mon-Fri 9-5 window', () => {
    const c = ctx(MF9TO5, 'UTC');
    // Thu 14:30 UTC
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 14, 14, 30, 0))),
    ).toBe(true);
  });

  it('closed before 09:00', () => {
    const c = ctx(MF9TO5, 'UTC');
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 14, 8, 59, 0))),
    ).toBe(false);
  });

  it('closed exactly at 17:00 (half-open interval)', () => {
    const c = ctx(MF9TO5, 'UTC');
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 14, 17, 0, 0))),
    ).toBe(false);
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 14, 16, 59, 0))),
    ).toBe(true);
  });

  it('closed on weekends', () => {
    const c = ctx(MF9TO5, 'UTC');
    // Sat 12:00 UTC
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 16, 12, 0, 0))),
    ).toBe(false);
    // Sun 12:00 UTC
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 17, 12, 0, 0))),
    ).toBe(false);
  });

  it('closed on a holiday even within window', () => {
    const c = ctx(MF9TO5, 'UTC', ['2026-05-14']);
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 14, 14, 30, 0))),
    ).toBe(false);
  });

  it('respects the timezone — NY hours, UTC instant', () => {
    // Schedule says open 09:00-17:00 in America/New_York. UTC
    // 14:00 = 10:00 EDT (open). UTC 22:30 = 18:30 EDT (closed).
    const c = ctx(MF9TO5, 'America/New_York');
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 14, 14, 0, 0))),
    ).toBe(true);
    expect(
      isOpenNow(c, new Date(Date.UTC(2026, 4, 14, 22, 30, 0))),
    ).toBe(false);
  });
});

describe('closedReason', () => {
  it('reports holiday over after_hours', () => {
    const c = ctx(MF9TO5, 'UTC', ['2026-05-14']);
    // 8 AM Thu (would normally be after_hours, but holiday wins)
    expect(closedReason(c, new Date(Date.UTC(2026, 4, 14, 8, 0, 0)))).toBe(
      'holiday',
    );
  });

  it('reports closed_day on weekend', () => {
    const c = ctx(MF9TO5, 'UTC');
    expect(closedReason(c, new Date(Date.UTC(2026, 4, 16, 12, 0, 0)))).toBe(
      'closed_day',
    );
  });

  it('reports after_hours when day has a window but we are outside it', () => {
    const c = ctx(MF9TO5, 'UTC');
    expect(closedReason(c, new Date(Date.UTC(2026, 4, 14, 8, 0, 0)))).toBe(
      'after_hours',
    );
  });

  it('reports open during the window', () => {
    const c = ctx(MF9TO5, 'UTC');
    expect(closedReason(c, new Date(Date.UTC(2026, 4, 14, 12, 0, 0)))).toBe(
      'open',
    );
  });

  it('reports open when schedule is null', () => {
    const c = ctx(null, 'UTC');
    expect(closedReason(c, new Date(Date.UTC(2026, 4, 17, 3, 0, 0)))).toBe(
      'open',
    );
  });
});
