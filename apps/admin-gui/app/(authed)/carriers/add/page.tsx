import { AddCarrierForm } from './add-form';

export default function AddCarrierPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Add Carrier</h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Configure a SIP trunk. Digest passwords are encrypted at rest with the
        cluster master key.
      </p>
      <AddCarrierForm />
    </div>
  );
}
