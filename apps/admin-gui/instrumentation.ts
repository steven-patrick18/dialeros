// Next.js calls register() exactly once when the server starts.
// We use it to re-arm pacers for any campaign whose status was 'active'
// when the previous process exited — a restart shouldn't pause your dialer.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { resumeActivePacers } = await import('@dialeros/control-plane');
  try {
    const { started } = resumeActivePacers();
    console.log(`[pacing] resumed ${started} active pacer(s) on boot`);
  } catch (e) {
    console.error('[pacing] resume on boot failed:', e);
  }
}
