import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// We do role-based redirects in the (authed) layout. To know which path
// is being rendered, we copy it into a header here — Next does not expose
// the current pathname to server components otherwise.
//
// We don't touch the session cookie or do any DB work in middleware; that
// happens in the layout with full Node runtime access.

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set('x-pathname', req.nextUrl.pathname);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
