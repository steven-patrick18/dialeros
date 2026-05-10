import net from 'node:net';

/**
 * Iter 28 — minimal FreeSWITCH ESL (Event Socket Library) client.
 *
 * Speaks just enough of the inbound-mode ESL protocol to authenticate
 * and run a synchronous `api` command against a local FreeSWITCH. No
 * event subscription, no async dialplan — that lands later when the
 * pacer wires originate.
 *
 * The protocol: connect → server emits "Content-Type: auth/request"
 * → send "auth <password>\n\n" → server emits 200 OK or 500 on bad
 * password. To run a command: send "api <cmd>\n\n", server emits
 * "Content-Type: api/response\n" + headers + body of the configured
 * Content-Length.
 */

export interface EslOptions {
  host?: string;
  port?: number;
  password?: string;
  timeoutMs?: number;
}

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8021,
  password: 'ClueCon',
  timeoutMs: 4000,
};

class EslError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'EslError';
  }
}

/**
 * Run a single ESL `api` command. Returns the response body (everything
 * after the headers). Throws EslError with a short code on failure so
 * the API layer can map cleanly to HTTP status.
 */
export function eslApi(command: string, opts: EslOptions = {}): Promise<string> {
  const cfg = { ...DEFAULTS, ...opts };
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: cfg.host,
      port: cfg.port,
    });
    socket.setEncoding('utf8');
    socket.setTimeout(cfg.timeoutMs);

    let buffer = '';
    let phase: 'wait-auth-request' | 'wait-auth-reply' | 'wait-api-response' =
      'wait-auth-request';
    let pendingBody = 0;
    let body = '';

    function fail(code: string, msg: string) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      reject(new EslError(msg, code));
    }

    socket.on('error', (e) => fail('connect_failed', e.message));
    socket.on('timeout', () => fail('timeout', `ESL timed out after ${cfg.timeoutMs}ms`));
    socket.on('close', () => {
      if (phase !== 'wait-api-response' || !body) {
        // Already settled, or closed before body finished.
      }
    });

    socket.on('data', (chunk: string) => {
      buffer += chunk;

      // Drain blocks separated by blank lines until we run out of full
      // headers or hit a body we still need to accumulate.
      while (true) {
        if (pendingBody > 0) {
          if (buffer.length < pendingBody) return;
          body += buffer.slice(0, pendingBody);
          buffer = buffer.slice(pendingBody);
          pendingBody = 0;
          // Body fully received — for our limited use case, that's the answer.
          if (phase === 'wait-api-response') {
            socket.end();
            socket.destroy();
            resolve(body.replace(/\n+$/, ''));
            return;
          }
        }

        const sep = buffer.indexOf('\n\n');
        if (sep === -1) return; // need more bytes
        const headerBlock = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const headers = parseHeaders(headerBlock);

        if (phase === 'wait-auth-request') {
          if (headers['content-type'] !== 'auth/request') {
            return fail(
              'unexpected_state',
              `expected auth/request, got ${headers['content-type']}`,
            );
          }
          phase = 'wait-auth-reply';
          socket.write(`auth ${cfg.password}\n\n`);
          continue;
        }

        if (phase === 'wait-auth-reply') {
          if (headers['content-type'] !== 'command/reply') {
            return fail(
              'unexpected_state',
              `expected command/reply for auth, got ${headers['content-type']}`,
            );
          }
          if (!headers['reply-text']?.startsWith('+OK')) {
            return fail('auth_failed', headers['reply-text'] ?? 'auth failed');
          }
          phase = 'wait-api-response';
          socket.write(`api ${command}\n\n`);
          continue;
        }

        if (phase === 'wait-api-response') {
          if (headers['content-type'] !== 'api/response') {
            return fail(
              'unexpected_state',
              `expected api/response, got ${headers['content-type']}`,
            );
          }
          const len = Number(headers['content-length'] ?? '0');
          if (len > 0) {
            pendingBody = len;
            continue;
          }
          // No body — empty response.
          socket.end();
          socket.destroy();
          resolve('');
          return;
        }
      }
    });
  });
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

export interface FreeSwitchHealth {
  reachable: boolean;
  version?: string;
  uptime?: string;
  sessions?: number;
  error?: string;
  errorCode?: string;
}

export async function getFreeSwitchHealth(
  opts: EslOptions = {},
): Promise<FreeSwitchHealth> {
  try {
    const status = await eslApi('status', opts);
    // status output like:
    //   UP 0 years, 0 days, 1 hour, 14 minutes, 6 seconds, ...
    //   FreeSWITCH (Version 1.10.x ...)
    //   ...
    //   0 session(s) since startup
    //   ...
    const upMatch = status.match(/^UP\s+(.+)$/m);
    const verMatch = status.match(/Version\s+([0-9][^\s)]+)/);
    const sessMatch = status.match(/(\d+)\s+session(?:\(s\))?\s+(?:peak|total)/i);

    return {
      reachable: true,
      version: verMatch?.[1],
      uptime: upMatch?.[1],
      sessions: sessMatch ? Number(sessMatch[1]) : undefined,
    };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return {
      reachable: false,
      error: err.message ?? 'unreachable',
      errorCode: err.code ?? 'unknown',
    };
  }
}
