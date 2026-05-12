import { NextResponse } from 'next/server';
import {
  getLeadList,
  leadCountFor,
  listLeadsInList,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { csvHeaders, csvRow } from '@/lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 126 — CSV export of every lead in a list. Streams the rows
// in batches so a 100k-lead list doesn't try to allocate the whole
// thing in JS heap. Admin / supervisor only — lead data is the
// most sensitive surface in the app.
//
// Columns:
//   phone, name, email, status, last_called_at, timezone,
//   preferred_cid, custom_fields_<keys flattened>, created_at,
//   updated_at
//
// Custom fields are flattened to one column per unique key found
// in the FIRST BATCH. Rare keys that only appear later won't get
// their own column — the call site can switch to a "json" output
// format if they need lossless export. v1 covers the 95% case.

const BATCH = 500;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  const list = getLeadList(id);
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 });
  }
  const total = leadCountFor(id);

  // Pull the first batch sync — we need it to discover the custom-
  // field columns for the header row. Subsequent batches stream.
  const first = listLeadsInList(id, BATCH, 0);
  const customKeys = collectCustomKeys(first);

  const safeName = list.name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${safeName}-${stamp}.csv`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Header row
      const header = [
        'phone',
        'name',
        'email',
        'status',
        'last_called_at',
        'timezone',
        'preferred_cid',
        'created_at',
        'updated_at',
        ...customKeys.map((k) => `custom_${k}`),
      ];
      controller.enqueue(encoder.encode(csvRow(header)));

      const writeBatch = (batch: typeof first) => {
        for (const r of batch) {
          const custom = parseCustom(r.custom_fields_json);
          controller.enqueue(
            encoder.encode(
              csvRow([
                r.phone,
                r.name,
                r.email,
                r.status,
                r.last_called_at,
                r.timezone,
                r.preferred_cid,
                r.created_at,
                r.updated_at,
                ...customKeys.map((k) => custom[k] ?? ''),
              ]),
            ),
          );
        }
      };

      writeBatch(first);

      let offset = first.length;
      while (offset < total) {
        const batch = listLeadsInList(id, BATCH, offset);
        if (batch.length === 0) break;
        writeBatch(batch);
        offset += batch.length;
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: csvHeaders(filename) });
}

function collectCustomKeys(
  rows: ReturnType<typeof listLeadsInList>,
): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const obj = parseCustom(r.custom_fields_json);
    for (const k of Object.keys(obj)) set.add(k);
  }
  return [...set].sort();
}

function parseCustom(raw: string): Record<string, string> {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j)) {
      out[k] = v == null ? '' : String(v);
    }
    return out;
  } catch {
    return {};
  }
}
