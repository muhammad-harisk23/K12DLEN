import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { friendlyAuthError } from './SignUpPage';

export function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Only allow internal redirect targets (no protocol, must start with '/').
  const nextParam = searchParams.get('next');
  const nextPath =
    nextParam && /^\/(?!\/)[^:]*$/.test(nextParam) ? nextParam : '/dashboard';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(friendlyAuthError(signInError.message));
      setLoading(false);
      return;
    }
    // Success: the auth listener updates state; route to the redirect target.
    navigate(nextPath, { replace: true });
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Pick up right where you left off."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && (
          <p className="rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" loading={loading} className="w-full">
          Sign in
        </Button>
        <p className="text-center text-sm text-ink-soft">
          New here?{' '}
          <Link to="/signup" className="font-medium text-accent hover:text-accent-strong">
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
