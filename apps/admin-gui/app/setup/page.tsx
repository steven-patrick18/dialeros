import { redirect } from 'next/navigation';
import { isSetupComplete } from '@dialeros/control-plane';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if (isSetupComplete()) {
    redirect('/login');
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-1">Set up DialerOS</h1>
        <p className="text-fg-subtle text-sm mb-6">
          Create the first administrator account. This account can then add
          other users.
        </p>
        <SetupForm />
      </div>
    </div>
  );
}
