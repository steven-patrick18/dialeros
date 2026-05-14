import { redirect } from 'next/navigation';
import { listHolidays } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { HolidaysEditor } from './editor';

export const dynamic = 'force-dynamic';

// Iter 180 — Org-wide holiday calendar. Each row forces every
// in-group to after-hours routing on its date (in the in-group's
// timezone). Admin only.

export default async function HolidaysPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Holidays</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  // RSC-safe plain-object cast.
  const rows = JSON.parse(JSON.stringify(listHolidays())) as Array<{
    id: number;
    holiday_date: string;
    name: string;
    enabled: number;
    created_at: string;
  }>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">Holidays</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Org-wide holiday calendar. On a holiday date, every
        in-group is forced into after-hours routing regardless of
        its business-hours schedule — callers hit
        <span className="font-mono"> after_hours_call_menu_id </span>
        if set, or get a reject. Disable a row to keep it on file
        without taking effect (e.g. the business decides to stay
        open this year).
      </p>
      <HolidaysEditor initialRows={rows} />
    </div>
  );
}
