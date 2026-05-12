import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';

// Envelope encryption for at-rest secrets (SIP digest passwords, etc.)
//
// Phase 0/1: master key is a random 32-byte file at data/.master_key with
// 0600 perms. The file is gitignored.
//
// Production replacement: swap getMasterKey() to fetch from HashiCorp Vault
// transit, AWS KMS, or a hardware HSM. The on-disk file path becomes
// emergency fallback only.

const KEY_PATH =
  process.env.DIALEROS_MASTER_KEY_PATH ??
  resolve(process.cwd(), 'data', '.master_key');

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

let _key: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_key) return _key;
  if (existsSync(KEY_PATH)) {
    const k = readFileSync(KEY_PATH);
    if (k.length !== KEY_LEN) {
      throw new Error(
        `master key at ${KEY_PATH} has wrong length (expected ${KEY_LEN}, got ${k.length})`,
      );
    }
    _key = k;
    return _key;
  }
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  const k = randomBytes(KEY_LEN);
  writeFileSync(KEY_PATH, k);
  try {
    chmodSync(KEY_PATH, 0o600);
  } catch {
    // Windows doesn't honor POSIX perms; the file is gitignored, so the
    // dev-host risk is bounded. Production should use KMS anyway.
  }
  _key = k;
  return _key;
}

// Envelope format: v1:ivHex:ciphertextHex:tagHex
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getMasterKey(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('invalid secret envelope');
  }
  const [, ivHex, encHex, tagHex] = parts;
  const iv = Buffer.from(ivHex!, 'hex');
  const enc = Buffer.from(encHex!, 'hex');
  const tag = Buffer.from(tagHex!, 'hex');
  if (tag.length !== TAG_LEN) {
    throw new Error('invalid auth tag length');
  }
  const decipher = createDecipheriv(ALGO, getMasterKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
