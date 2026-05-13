/* Iter 152 — Write the generated dialplan to disk + ask FS to reload.
 *
 * Separated from the pure XML builder so call-menu.ts can keep
 * deploy-related concerns (file I/O, fs_cli) isolated and the
 * builder stays trivially testable.
 *
 * Permissions assumption: /etc/freeswitch/dialplan/default is
 * mode 2775 with group=freeswitch (SGID so new files inherit the
 * group) and dialeros is a member of freeswitch. iter 152's
 * one-off prep step on the VPS sets this; the writer fails clean
 * with an actionable message if perms aren't right.
 *
 * fs_cli reload: best-effort. If fs_cli is missing or FS is down,
 * we still consider the deploy successful from the DB+file
 * standpoint — the dialplan is on disk and will pick up on FS
 * restart or manual `fs_cli -x reloadxml`.
 *
 * Webpack note: this file is imported transitively from the
 * control-plane index, which the admin-gui's client + edge bundles
 * also touch. We dodge UnhandledSchemeError on 'fs/promises' +
 * 'child_process' by using createRequire — same pattern as db.ts
 * for node:sqlite. The Node resolver picks it up at runtime; webpack
 * static analysis never sees the require.
 */
import { createRequire } from 'module';
import {
  buildCallMenuDialplanXml,
  callMenuDialplanPath,
} from './call-menu-dialplan';
import {
  getCallMenuFromDb,
  listCallMenuOptionsFromDb,
} from './db';

type FsPromisesShape = {
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: string },
  ): Promise<void>;
  unlink(path: string): Promise<void>;
};

type ChildProcessShape = {
  spawn(
    bin: string,
    args: string[],
    options?: { stdio?: unknown },
  ): {
    stdout: { on: (event: string, cb: (chunk: Buffer) => void) => void };
    stderr: { on: (event: string, cb: (chunk: Buffer) => void) => void };
    on: (event: string, cb: (arg?: unknown) => void) => void;
  };
};

const _require = createRequire(import.meta.url) as (m: string) => unknown;
const fsp = _require('fs/promises') as FsPromisesShape;
const cp = _require('child_process') as ChildProcessShape;

const FS_CLI_BIN = process.env.FS_CLI_BIN || '/usr/bin/fs_cli';

/** Write the dialplan file + reload FS. Throws if file write
 * fails. Reload failure is logged but not thrown. */
export async function deployCallMenuDialplan(menuId: string): Promise<{
  written: boolean;
  reloaded: boolean;
  reload_error?: string;
}> {
  const menu = getCallMenuFromDb(menuId);
  if (!menu) {
    throw new Error(`call_menu ${menuId} not found`);
  }
  const options = listCallMenuOptionsFromDb(menuId);
  const xml = buildCallMenuDialplanXml({ menu, options });
  const path = callMenuDialplanPath(menuId);
  try {
    await fsp.writeFile(path, xml, { encoding: 'utf8' });
  } catch (e) {
    throw new Error(
      `failed to write ${path}: ${(e as Error).message}. ` +
        `Check that /etc/freeswitch/dialplan/default is g+w with ` +
        `group=freeswitch and dialeros is in that group.`,
    );
  }
  const reloadResult = await reloadFsDialplan();
  return {
    written: true,
    reloaded: reloadResult.ok,
    reload_error: reloadResult.ok ? undefined : reloadResult.error,
  };
}

/** Remove the dialplan file + reload FS. Idempotent — silent if
 * the file doesn't exist. */
export async function removeCallMenuDialplan(menuId: string): Promise<{
  removed: boolean;
  reloaded: boolean;
  reload_error?: string;
}> {
  const path = callMenuDialplanPath(menuId);
  let removed = false;
  try {
    await fsp.unlink(path);
    removed = true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new Error(`failed to unlink ${path}: ${(e as Error).message}`);
    }
  }
  const reloadResult = await reloadFsDialplan();
  return {
    removed,
    reloaded: reloadResult.ok,
    reload_error: reloadResult.ok ? undefined : reloadResult.error,
  };
}

async function reloadFsDialplan(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  return new Promise((resolve) => {
    const proc = cp.spawn(FS_CLI_BIN, ['-x', 'reloadxml'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
      if (stdout.length > 16384) stdout = stdout.slice(stdout.length - 16384);
    });
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
      if (stderr.length > 16384) stderr = stderr.slice(stderr.length - 16384);
    });
    proc.on('error', (e) => {
      resolve({
        ok: false,
        error: `fs_cli not available: ${(e as Error).message}`,
      });
    });
    proc.on('close', (code) => {
      if (code === 0) {
        if (stdout.includes('OK') || stdout.includes('Success')) {
          resolve({ ok: true });
        } else {
          resolve({
            ok: false,
            error: `fs_cli reload returned no OK: ${stdout.trim().slice(0, 400)}`,
          });
        }
      } else {
        resolve({
          ok: false,
          error: `fs_cli exited ${code}: ${(stderr || stdout).trim().slice(0, 400)}`,
        });
      }
    });
  });
}
