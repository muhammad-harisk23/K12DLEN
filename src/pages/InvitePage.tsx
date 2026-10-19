import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { redeemRoomInvite } from '@/lib/rooms';
import { friendlyAuthError } from '@/pages/SignUpPage';

type InviteState =
  | { status: 'checking' }
  | { status: 'needs-signin' }
  | { status: 'redeeming' }
  | { status: 'invalid' }
  | { status: 'error'; message: string };

function isWellFormedCode(code: string | undefined): boolean {
  return Boolean(code && /^[0-9a-f]{32}$/.test(code));
}

/**
 * Invitation landing page. Route: /invite/:code
 * - Signed out: friendly join card that routes through sign-in and back.
 * - Signed in: redeems the invitation (idempotent) and joins the room.
 */
export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const { session } = useAuth();
  const [state, setState] = useState<InviteState>({ status: 'checking' });

  useEffect(() => {
    if (!isWellFormedCode(code)) {
      setState({ status: 'invalid' });
      return;
    }
    if (!session) {
      setState({ status: 'needs-signin' });
      return;
    }
    let cancelled = false;
    setState({ status: 'redeeming' });
    (async () => {
      try {
        const { roomId } = await redeemRoomInvite(code!);
        if (!cancelled) window.location.assign(`/rooms/${roomId}`);
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message:
              err instanceof Error
                ? err.message
                : friendlyAuthError(String(err)),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, session]);

  const backLink = (
    <Link
      to="/dashboard"
      className="font-medium text-accent hover:text-accent-strong"
    >
      Back to dashboard
    </Link>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      {state.status === 'checking' && (
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading invitation" />
      )}

      {state.status === 'redeeming' && (
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Accepting invitation" />
          <p className="text-sm text-ink-soft">Accepting your invitation…</p>
        </div>
      )}

      {state.status === 'needs-signin' && (
        <div className="w-full max-w-sm rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-8 w-8 text-accent" aria-hidden />
          <h1 className="mt-3 font-display text-lg font-bold text-ink">
            You're invited to a study room
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Sign in (or create an account) to accept this invitation and join
            the room.
          </p>
          <Link
            to={`/signin?next=/invite/${code}`}
            className="mt-5 flex min-h-touch items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
          >
            Sign in to join
          </Link>
          <p className="mt-3 text-sm text-ink-soft">
            New here?{' '}
            <Link
              to={`/signup?next=/invite/${code}`}
              className="font-medium text-accent hover:text-accent-strong"
            >
              Create an account
            </Link>
          </p>
        </div>
      )}

      {state.status === 'invalid' && (
        <div className="w-full max-w-sm rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
          <h1 className="font-display text-lg font-bold text-ink">
            Invitation not found
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            This invitation link is not valid. Ask your classmate to share it
            again.
          </p>
          <p className="mt-5 text-sm">{backLink}</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="w-full max-w-sm rounded-2xl border border-line bg-raised p-8 text-center shadow-sm">
          <h1 className="font-display text-lg font-bold text-ink">
            Invitation could not be accepted
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-red-700" role="alert">
            {state.message}
          </p>
          <p className="mt-5 text-sm">{backLink}</p>
        </div>
      )}
    </div>
  );
}
