import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import type { StudentProfile } from '@/types/curriculum';

interface ProtectedRouteProps {
  children: (profile: StudentProfile) => React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { session, loading: authLoading } = useAuth();
  const location = useLocation();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('student_profiles')
        .select('*')
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setProfileError('We could not load your profile. Please refresh.');
        setProfileLoading(false);
        return;
      }
      if (!data) {
        // First login: create the profile row.
        const metaName = (session.user.user_metadata?.display_name ?? '') as string;
        const fallback = session.user.email?.split('@')[0] ?? 'Student';
        const { data: created, error: insertError } = await supabase
          .from('student_profiles')
          .insert({ display_name: (metaName || fallback).slice(0, 40) })
          .select('*')
          .single();
        if (cancelled) return;
        if (insertError || !created) {
          setProfileError('We could not set up your profile. Please refresh.');
          setProfileLoading(false);
          return;
        }
        setProfile(created);
      } else {
        setProfile(data);
      }
      setProfileLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  if (authLoading || (session && profileLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/signin" state={{ from: location.pathname }} replace />;
  }

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="max-w-sm rounded-2xl border border-line bg-raised p-6 text-center shadow-sm">
          <p className="text-sm text-ink-soft">{profileError}</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return <>{children(profile)}</>;
}
