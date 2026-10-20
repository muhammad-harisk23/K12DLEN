import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';

export function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
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

    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    });

    if (signUpError) {
      setError(friendlyAuthError(signUpError.message));
      setLoading(false);
      return;
    }

    // Email confirmation is off; a successful signup signs the user in.
    navigate(nextPath, { replace: true });
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Just an email, a password, and the name classmates will see."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <TextField
          label="Your name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
          required
          maxLength={40}
          placeholder="Aarav"
        />
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
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
        />
        {error && (
          <p className="rounded-xl border border-line-strong bg-sunken px-3.5 py-2.5 text-sm font-medium text-ink" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" loading={loading} className="w-full">
          Create account
        </Button>
        <p className="text-center text-sm text-ink-soft">
          Already studying with us?{' '}
          <Link to="/signin" className="font-medium text-accent hover:text-accent-strong">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function friendlyAuthError(message: string): string {
  if (message.includes('already registered')) {
    return 'That email already has an account. Try signing in instead.';
  }
  if (message.toLowerCase().includes('password')) {
    return 'Your password should be at least 8 characters.';
  }
  if (message.includes('invalid')) {
    return 'Please check your email address and try again.';
  }
  if (message.includes('rate limit')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return 'Something went wrong. Please try again.';
}
