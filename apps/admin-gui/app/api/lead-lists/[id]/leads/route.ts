import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getLeadList,
  ingestCsv,
  leadCountFor,
  pageLeads,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!getLeadList(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get('size') ?? 50)),
  );
  const total = leadCountFor(id);
  return NextResponse.json({
    page,
    page_size: pageSize,
    total,
    leads: pageLeads(id, page, pageSize),
  });
}

// CSV upload — accepts multipart/form-data with file field "file", or
// raw text/csv body.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!getLeadList(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let csv = '';
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'no file uploaded (form field "file" required)' },
        { status: 400 },
      );
    }
    csv = await file.text();
  } else {
    csv = await req.text();
  }

  if (!csv.trim()) {
    return NextResponse.json({ error: 'empty CSV' }, { status: 400 });
  }

  // Reject excessively large payloads at the API layer (nginx already
  // limits client_max_body_size to 50M).
  if (csv.length > 60 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'CSV too large (max 60MB)' },
      { status: 413 },
    );
  }

  const result = ingestCsv(id, csv);
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'lead_list.csv_uploaded',
    targetType: 'lead_list',
    targetId: id,
    payload: {
      parsed: result.parsed,
      inserted: result.inserted,
      duplicates: result.duplicates,
      rejected: result.rejected,
    },
  });

  return NextResponse.json(result);
}
