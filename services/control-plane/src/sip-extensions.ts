// Iter 39 — derive a SIP extension number for a user. Deterministic so
// the same user always lands on the same extension across processes:
// the browser softphone registers as it, the test-call route bridges
// to it, and the pacer originates with `&bridge(user/<ext>)` to it.
//
// Hash range is 1000..1019 to match the FS default directory which
// ships pre-provisioned users 1000-1019 / pw 1234. Per-user phones
// (iter 38) replace this with real owned credentials.

const FIRST_EXTENSION = 1000;
const EXTENSION_COUNT = 20;

export function extensionForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) - h + userId.charCodeAt(i)) | 0;
  }
  return String(FIRST_EXTENSION + (Math.abs(h) % EXTENSION_COUNT));
}
