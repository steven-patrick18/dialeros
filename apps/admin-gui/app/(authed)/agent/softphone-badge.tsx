'use client';

import { useSoftphone } from '@/components/softphone';

/**
 * Iter 37 — small status pill for the agent console header. Green
 * when registered, yellow while connecting, red on error. Same
 * shape as the badge in /settings/telephony, just lives here so it
 * can use the agent's SoftphoneProvider context.
 */
export function AgentSoftphoneBadge() {
  const sp = useSoftphone();
  if (sp.error) {
    return (
      <span
        className="text-[10px] uppercase px-1.5 py-0.5 rounded border bg-error/10 text-error border-error/40"
        title={sp.error}
      >
        Softphone error
      </span>
    );
  }
  if (sp.registered) {
    return (
      <span
        className="text-[10px] uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40"
        title={`Registered as ${sp.extension}`}
      >
        Softphone {sp.extension}
      </span>
    );
  }
  if (sp.ready) {
    return (
      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border bg-warn/10 text-warn border-warn/40">
        Softphone registering…
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border bg-fg-subtle/15 text-fg-muted border-border">
      Softphone connecting…
    </span>
  );
}
