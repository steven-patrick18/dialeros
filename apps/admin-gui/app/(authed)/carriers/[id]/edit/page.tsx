import { notFound } from 'next/navigation';
import { getCarrier, parseCodecs } from '@dialeros/control-plane';
import { EditCarrierForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function EditCarrierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const carrier = getCarrier(id);
  if (!carrier) notFound();

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">
        Edit carrier: <span className="text-accent">{carrier.name}</span>
      </h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Leave the digest password blank to keep the existing encrypted value.
      </p>
      <EditCarrierForm
        carrier={{
          id: carrier.id,
          name: carrier.name,
          host: carrier.host,
          port: carrier.port,
          transport: carrier.transport,
          auth_mode: carrier.auth_mode,
          digest_username: carrier.digest_username,
          has_digest_password: !!carrier.digest_password_encrypted,
          ip_acl: carrier.ip_acl,
          codecs: parseCodecs(carrier),
          max_channels: carrier.max_channels,
          max_cps: carrier.max_cps,
          mos_threshold: carrier.mos_threshold,
          enabled: carrier.enabled === 1,
        }}
      />
    </div>
  );
}
