import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getFreeSwitchHealth } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const health = await getFreeSwitchHealth();
  return NextResponse.json(health);
}
