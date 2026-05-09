import { redirect } from 'next/navigation';
import { isSetupComplete } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (!isSetupComplete()) {
    redirect('/setup');
  }
  const user = await getCurrentUser();
  if (user) {
    redirect('/');
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-1">DialerOS</h1>
        <p className="text-fg-subtle text-sm mb-6">Sign in to continue.</p>
        <LoginForm />
      </div>
    </div>
  );
}
