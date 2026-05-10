import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { decryptSecret, type CarrierRecord } from '@dialeros/control-plane';
import { eslApi } from './esl';
import {
  gatewayFilenameFor,
  gatewayNameFor,
  gatewayXml,
} from './freeswitch-config';

/**
 * Iter 30 — push a carrier's config to FreeSWITCH as a SIP gateway.
 *
 * Steps:
 *   1. Decrypt the carrier's stored password (if digest mode).
 *   2. Generate the gateway XML.
 *   3. Write to /etc/freeswitch/sip_profiles/external/dialeros-<id>.xml
 *      (the dialeros user must be in the freeswitch group — installed
 *      by scripts/install-freeswitch.sh).
 *   4. Tell mod_sofia to reread the external profile via ESL:
 *      `sofia profile external rescan`.
 *   5. Confirm the gateway appears in `sofia status gateway <name>`.
 */

const FS_EXTERNAL_DIR = '/etc/freeswitch/sip_profiles/external';

export interface PushResult {
  ok: boolean;
  step: 'decrypt' | 'xml' | 'write' | 'reload' | 'confirm' | 'done';
  message: string;
  gatewayName: string;
}

export async function pushCarrierToFreeSwitch(
  carrier: CarrierRecord,
): Promise<PushResult> {
  const gwName = gatewayNameFor(carrier);

  // 1 + 2: decrypt + render
  let xml: string;
  try {
    let password: string | null = null;
    if (carrier.auth_mode === 'digest' && carrier.digest_password_encrypted) {
      password = decryptSecret(carrier.digest_password_encrypted);
    }
    xml = gatewayXml({ carrier, digestPassword: password });
  } catch (e) {
    return {
      ok: false,
      step: 'xml',
      message: e instanceof Error ? e.message : String(e),
      gatewayName: gwName,
    };
  }

  // 3: write
  const file = path.join(FS_EXTERNAL_DIR, gatewayFilenameFor(carrier));
  try {
    await writeFile(file, xml, { mode: 0o640 });
  } catch (e) {
    return {
      ok: false,
      step: 'write',
      message: `failed to write ${file}: ${
        e instanceof Error ? e.message : String(e)
      }. Confirm dialeros is in the freeswitch group and the dir is g+w.`,
      gatewayName: gwName,
    };
  }

  // 4: tell FS to load the new XML.
  //
  // `sofia profile external rescan` only picks up NEW gateways — it
  // does NOT re-read an existing gateway's params. To force a
  // full reload of THIS gateway (e.g. after toggling ping or rotating
  // a digest password), kill it first, then rescan. killgw is a no-op
  // on the first push when the gateway doesn't yet exist.
  try {
    await eslApi(`sofia profile external killgw ${gwName}`, { timeoutMs: 5000 });
  } catch {
    // First-push case (no existing gateway) — fine, ignore.
  }
  try {
    await eslApi('sofia profile external rescan reloadxml', { timeoutMs: 8000 });
  } catch (e) {
    return {
      ok: false,
      step: 'reload',
      message: `wrote ${file} but ESL rescan failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      gatewayName: gwName,
    };
  }

  // 5: confirm — sofia takes a beat to register
  await sleep(800);
  try {
    const status = await eslApi(`sofia status gateway ${gwName}`, {
      timeoutMs: 5000,
    });
    if (/Invalid Gateway/i.test(status)) {
      return {
        ok: false,
        step: 'confirm',
        message: `wrote + reloaded but FreeSWITCH does not see gateway ${gwName}. Check FS logs.`,
        gatewayName: gwName,
      };
    }
  } catch (e) {
    // Confirm failure is non-fatal — file is written and reload was issued.
    return {
      ok: true,
      step: 'done',
      message: `pushed; status check failed (${
        e instanceof Error ? e.message : String(e)
      }) — usually transient.`,
      gatewayName: gwName,
    };
  }

  return {
    ok: true,
    step: 'done',
    message: `pushed gateway ${gwName} and confirmed via sofia status.`,
    gatewayName: gwName,
  };
}

/**
 * Iter 30 — remove a carrier's gateway file + tell FS to rescan.
 * Used by the carrier delete flow once it's wired through; today
 * exposed for symmetry.
 */
export async function removeCarrierFromFreeSwitch(
  carrier: Pick<CarrierRecord, 'id'>,
): Promise<{ ok: boolean; message: string }> {
  const file = path.join(FS_EXTERNAL_DIR, gatewayFilenameFor(carrier));
  try {
    await unlink(file);
  } catch (e) {
    const err = e as { code?: string };
    if (err.code !== 'ENOENT') {
      return {
        ok: false,
        message: `failed to remove ${file}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }
  try {
    await eslApi('sofia profile external rescan reloadxml', { timeoutMs: 8000 });
  } catch (e) {
    return {
      ok: false,
      message: `unlinked ${file} but ESL rescan failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  return { ok: true, message: `removed ${gatewayFilenameFor(carrier)}` };
}

export interface GatewayStatus {
  pushed: boolean;
  state?: string; // e.g. REGED, FAILED, NOREG, NOAVAIL
  pingTime?: string;
  rawSnippet?: string;
  error?: string;
}

/**
 * Parse the output of `sofia status gateway <name>`.
 *
 * A real FreeSWITCH response looks like:
 *
 *   Profile  : external
 *   Gateway  : dialeros-<id>
 *   Username : test_user
 *   Realm    : sip.carrier.com
 *   Proxy    : sip.carrier.com
 *   ...
 *   Status   : UP
 *   State    : REGED
 *   Ping-Time : 35.42ms
 */
export async function gatewayStatusFor(
  carrier: Pick<CarrierRecord, 'id'>,
): Promise<GatewayStatus> {
  const gwName = gatewayNameFor(carrier);
  let raw: string;
  try {
    raw = await eslApi(`sofia status gateway ${gwName}`, { timeoutMs: 4000 });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { pushed: false, error: err.message ?? 'unreachable' };
  }
  if (/Invalid Gateway/i.test(raw)) {
    return { pushed: false };
  }
  const stateMatch = raw.match(/^State\s*:\s*(\S+)/m);
  const pingMatch = raw.match(/^Ping-Time\s*:\s*(.+?)$/m);
  return {
    pushed: true,
    state: stateMatch?.[1],
    pingTime: pingMatch?.[1]?.trim(),
    rawSnippet: raw.split('\n').slice(0, 12).join('\n'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
