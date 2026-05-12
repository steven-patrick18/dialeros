import { NextRequest, NextResponse } from 'next/server';
import {
  getPhoneByExtension,
  getUser,
} from '@dialeros/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 119 — FreeSWITCH mod_xml_curl directory lookup endpoint.
//
// FS posts here on every REGISTER (and on auth challenges,
// presence subscriptions, etc.) with section=directory and a
// `user` + `domain` pair. We look up the phone in the phones
// table and return XML matching FS's expected directory schema:
//
//   <document type="freeswitch/xml">
//     <section name="directory">
//       <domain name="<domain>">
//         <user id="<extension>">
//           <params>
//             <param name="password" value="<plaintext>"/>
//           </params>
//           <variables>
//             <variable name="user_context" value="default"/>
//             <variable name="effective_caller_id_name"   value="<name>"/>
//             <variable name="effective_caller_id_number" value="<ext>"/>
//           </variables>
//         </user>
//       </domain>
//     </section>
//   </document>
//
// Unknown extension → the standard "not found" document. FS then
// challenges back as 403, the phone gives up. This is also what
// non-directory sections (configuration, dialplan, languages)
// land here as — we 'not found' those so FS falls through to its
// static XML.
//
// Authentication: FS runs on the same box and is firewalled
// inside the deployment. mod_xml_curl can send a basic-auth
// header; we check the same X-Inbound-Token header Kamailio
// uses to keep this hook off-limits to outside callers. If the
// token isn't configured we accept anything but log a warning
// (matches the inbound-route pattern).

const INTERNAL_TOKEN = process.env.KAMAILIO_INBOUND_TOKEN ?? '';

function notFoundXml(): string {
  return [
    '<document type="freeswitch/xml">',
    '  <section name="result">',
    '    <result status="not found"/>',
    '  </section>',
    '</document>',
  ].join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function directoryXml(args: {
  domain: string;
  extension: string;
  password: string;
  displayName: string;
}): string {
  const d = escapeXml(args.domain);
  const e = escapeXml(args.extension);
  const p = escapeXml(args.password);
  const name = escapeXml(args.displayName);
  return [
    '<document type="freeswitch/xml">',
    '  <section name="directory">',
    `    <domain name="${d}">`,
    `      <user id="${e}">`,
    '        <params>',
    `          <param name="password" value="${p}"/>`,
    `          <param name="vm-password" value="${p}"/>`,
    '          <param name="dial-string" value="{presence_id=${dialed_user}@${dialed_domain}}${sofia_contact(${dialed_user}@${dialed_domain})}"/>',
    '        </params>',
    '        <variables>',
    '          <variable name="user_context" value="default"/>',
    `          <variable name="effective_caller_id_name" value="${name}"/>`,
    `          <variable name="effective_caller_id_number" value="${e}"/>`,
    '          <variable name="toll_allow" value="domestic,international,local"/>',
    '          <variable name="accountcode" value="dialeros"/>',
    '        </variables>',
    '      </user>',
    '    </domain>',
    '  </section>',
    '</document>',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  // Two header forms accepted:
  //   X-Inbound-Token: <token>          — Kamailio / direct curl
  //   Authorization: Basic <b64(u:p)>   — FS mod_xml_curl which
  //                                       only speaks Basic/Digest.
  //                                       We use the password slot
  //                                       as the token; the user
  //                                       slot is ignored.
  let presented = req.headers.get('x-inbound-token') ?? '';
  if (!presented) {
    const auth = req.headers.get('authorization') ?? '';
    const m = /^Basic\s+(.+)$/i.exec(auth);
    if (m) {
      try {
        const decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        presented = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      } catch {
        /* malformed Basic header — fall through to token check */
      }
    }
  }
  if (INTERNAL_TOKEN && presented !== INTERNAL_TOKEN) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!INTERNAL_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn(
      '[fs-directory] KAMAILIO_INBOUND_TOKEN not set — accepting unauthenticated requests',
    );
  }

  // FS sends form-encoded POST with mod_xml_curl. Read either
  // body — modern FS uses application/x-www-form-urlencoded.
  const form = await req.formData().catch(() => null);
  if (!form) {
    return new NextResponse(notFoundXml(), {
      headers: { 'content-type': 'text/xml' },
    });
  }

  const section = String(form.get('section') ?? '');
  const user = String(form.get('user') ?? '').trim();
  const domain = String(form.get('domain') ?? '').trim();

  // We only answer for the directory section. Configuration,
  // dialplan, etc. fall through to FS's static XML.
  if (section !== 'directory' || !user) {
    return new NextResponse(notFoundXml(), {
      headers: { 'content-type': 'text/xml' },
    });
  }

  const phone = getPhoneByExtension(user);
  if (!phone) {
    return new NextResponse(notFoundXml(), {
      headers: { 'content-type': 'text/xml' },
    });
  }

  // display_name comes from the user record so hard phones show
  // a meaningful Caller ID when ringing other extensions on the
  // floor (admin/supervisor consult, supervisor barge, etc.).
  const u = getUser(phone.user_id);
  const displayName = u?.display_name || u?.username || phone.extension;

  return new NextResponse(
    directoryXml({
      domain: domain || '127.0.0.1',
      extension: phone.extension,
      password: phone.password,
      displayName,
    }),
    { headers: { 'content-type': 'text/xml' } },
  );
}
