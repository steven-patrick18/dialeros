'use client';

import { useMemo, useState } from 'react';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface DayWindow {
  open: string;
  close: string;
}

type Schedule = Record<DayKey, DayWindow | null>;

const DAYS: ReadonlyArray<{ key: DayKey; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const EMPTY_24_7: Schedule = {
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
};

// Common timezones — short list with America/* on top since most
// of our operators are US-based; users can also type any IANA
// name via the free-form input.
const TZ_PRESETS = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
];

function parseInitial(json: string | null): Schedule | 'always-open' {
  if (!json || json.trim() === '') return 'always-open';
  try {
    const obj = JSON.parse(json) as Partial<Schedule>;
    const out: Schedule = { ...EMPTY_24_7 };
    for (const { key } of DAYS) {
      const v = obj[key];
      if (
        v &&
        typeof v === 'object' &&
        typeof v.open === 'string' &&
        typeof v.close === 'string'
      ) {
        out[key] = { open: v.open, close: v.close };
      }
    }
    return out;
  } catch {
    return 'always-open';
  }
}

function scheduleToJson(s: Schedule): string {
  return JSON.stringify(s);
}

export function BusinessHoursEditor({
  initialBusinessHoursJson,
  initialTimezone,
  onChange,
}: {
  initialBusinessHoursJson: string | null;
  initialTimezone: string;
  onChange: (businessHoursJson: string | null, timezone: string) => void;
}) {
  const initial = useMemo(
    () => parseInitial(initialBusinessHoursJson),
    [initialBusinessHoursJson],
  );
  const [always247, setAlways247] = useState(initial === 'always-open');
  const [schedule, setSchedule] = useState<Schedule>(
    initial === 'always-open'
      ? {
          mon: { open: '09:00', close: '17:00' },
          tue: { open: '09:00', close: '17:00' },
          wed: { open: '09:00', close: '17:00' },
          thu: { open: '09:00', close: '17:00' },
          fri: { open: '09:00', close: '17:00' },
          sat: null,
          sun: null,
        }
      : initial,
  );
  const [timezone, setTimezone] = useState(initialTimezone || 'UTC');

  function emit(nextAlways: boolean, nextSchedule: Schedule, nextTz: string) {
    onChange(nextAlways ? null : scheduleToJson(nextSchedule), nextTz);
  }

  function setAlways(v: boolean) {
    setAlways247(v);
    emit(v, schedule, timezone);
  }

  function toggleDay(key: DayKey) {
    const next: Schedule = {
      ...schedule,
      [key]: schedule[key]
        ? null
        : { open: '09:00', close: '17:00' },
    };
    setSchedule(next);
    emit(always247, next, timezone);
  }

  function setTime(key: DayKey, which: 'open' | 'close', value: string) {
    const cur = schedule[key];
    if (!cur) return;
    const next: Schedule = { ...schedule, [key]: { ...cur, [which]: value } };
    setSchedule(next);
    emit(always247, next, timezone);
  }

  function setTz(v: string) {
    setTimezone(v);
    emit(always247, schedule, v);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={always247}
            onChange={(e) => setAlways(e.target.checked)}
            className="h-4 w-4"
          />
          <span>Always open (24/7)</span>
        </label>
        <p className="text-xs text-fg-subtle mt-1">
          When checked, business-hours and holidays are ignored
          for this in-group. Inbound calls always route normally.
        </p>
      </div>

      <div>
        <label className="block text-sm mb-1">Timezone (IANA)</label>
        <div className="flex gap-2">
          <select
            value={timezone}
            onChange={(e) => setTz(e.target.value)}
            className="border border-border rounded bg-bg px-2 py-1 text-sm"
          >
            {TZ_PRESETS.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
            {!TZ_PRESETS.includes(timezone) && (
              <option value={timezone}>{timezone} (custom)</option>
            )}
          </select>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTz(e.target.value)}
            placeholder="America/New_York"
            className="flex-1 border border-border rounded bg-bg px-2 py-1 text-sm font-mono text-xs"
          />
        </div>
      </div>

      {!always247 && (
        <div className="border border-border rounded p-3 bg-card space-y-2">
          {DAYS.map(({ key, label }) => {
            const win = schedule[key];
            const open = win?.open ?? '09:00';
            const close = win?.close ?? '17:00';
            return (
              <div key={key} className="flex items-center gap-3">
                <label className="flex items-center gap-2 w-24">
                  <input
                    type="checkbox"
                    checked={!!win}
                    onChange={() => toggleDay(key)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm w-10">{label}</span>
                </label>
                {win ? (
                  <>
                    <input
                      type="time"
                      value={open}
                      onChange={(e) => setTime(key, 'open', e.target.value)}
                      className="border border-border rounded bg-bg px-2 py-0.5 text-sm"
                    />
                    <span className="text-fg-subtle text-xs">to</span>
                    <input
                      type="time"
                      value={close}
                      onChange={(e) => setTime(key, 'close', e.target.value)}
                      className="border border-border rounded bg-bg px-2 py-0.5 text-sm"
                    />
                  </>
                ) : (
                  <span className="text-fg-muted text-xs">closed</span>
                )}
              </div>
            );
          })}
          <p className="text-xs text-fg-subtle mt-2">
            Times are 24h in the in-group&apos;s timezone. A holiday
            on this date (
            <a href="/settings/holidays" className="text-link hover:underline">
              manage
            </a>
            ) forces after-hours routing even within these windows.
          </p>
        </div>
      )}
    </div>
  );
}
