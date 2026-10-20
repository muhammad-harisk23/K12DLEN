import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useParams,
  useLocation,
} from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { SignInPage } from '@/pages/SignInPage';
import { SignUpPage } from '@/pages/SignUpPage';
import { LandingPage } from '@/pages/LandingPage';
import { OnboardingFlow } from '@/pages/OnboardingFlow';
import { DashboardPage } from '@/pages/DashboardPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { WorkspaceLoader } from '@/pages/WorkspaceLoader';
import { PracticePage } from '@/pages/PracticePage';
import { RoomsPage } from '@/pages/RoomsPage';
import { RoomPage } from '@/pages/RoomPage';
import { InvitePage } from '@/pages/InvitePage';
import { PaperUploadPage } from '@/pages/PaperUploadPage';
import { PaperReviewPage } from '@/pages/PaperReviewPage';
import { ExamConfigurePage } from '@/pages/ExamConfigurePage';
import { ExamRunnerPage } from '@/pages/ExamRunnerPage';
import { ExamResultsPage } from '@/pages/ExamResultsPage';
import { supabase } from '@/lib/supabase';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type {
  Board,
  ClassRow,
  StudentProfile,
  Subject,
} from '@/types/curriculum';

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <Loader2 className="h-6 w-6 animate-spin text-accent" aria-label="Loading" />
    </div>
  );
}

function SignedInRedirect() {
  const { session, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (session) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

function AppRoutes() {
  const { session } = useAuth();
  const [, setProfile] = useState<StudentProfile | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [curriculumReady, setCurriculumReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [boardsRes, classesRes, subjectsRes] = await Promise.all([
          supabase.from('boards').select('*').order('name'),
          supabase
            .from('classes')
            .select('*, syllabus_versions!inner(board_id, published)')
            .order('level'),
          supabase.from('subjects').select('*').order('display_order'),
        ]);
        if (cancelled) return;
        if (boardsRes.error || classesRes.error || subjectsRes.error) {
          console.error('Curriculum load failed', {
            boards: boardsRes.error,
            classes: classesRes.error,
            subjects: subjectsRes.error,
          });
        } else {
          setBoards((boardsRes.data ?? []) as Board[]);
          setClasses((classesRes.data ?? []) as ClassRow[]);
          setSubjects((subjectsRes.data ?? []) as Subject[]);
        }
      } catch (err) {
        // Network failure must not block routing; onboarding surfaces a
        // retry state when its lists are empty.
        console.error('Curriculum fetch threw', err);
      } finally {
        if (!cancelled) setCurriculumReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Routes>
      <Route
        path="/signin"
        element={session ? <Navigate to="/dashboard" replace /> : <SignInPage />}
      />
      <Route
        path="/signup"
        element={session ? <Navigate to="/dashboard" replace /> : <SignUpPage />}
      />
      <Route path="/" element={<SignedInRedirect />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            {(loadedProfile, refreshProfile) => {
              if (!loadedProfile.onboarded_at) {
                return (
                  <OnboardingFlow
                    profile={loadedProfile}
                    boards={boards}
                    classes={classes}
                    subjects={subjects}
                    ready={curriculumReady}
                    onDone={() => refreshProfile()}
                  />
                );
              }
              return (
                <AppShell profile={loadedProfile}>
                  <DashboardPage
                    profile={loadedProfile}
                    subjects={subjects}
                    onProfileChange={setProfile}
                  />
                </AppShell>
              );
            }}
          </ProtectedRoute>
        }
      />
      <Route
        path="/library"
        element={
          <ProtectedRoute>
            {(loadedProfile) => (
              <AppShell profile={loadedProfile}>
                <LibraryPage profile={loadedProfile} />
              </AppShell>
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/study/:resourceId"
        element={
          <ProtectedRoute>
            {(loadedProfile) => <StudyRoute profile={loadedProfile} />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/practice"
        element={
          <ProtectedRoute>
            {(loadedProfile) => (
              <AppShell profile={loadedProfile}>
                <PracticePage />
              </AppShell>
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/practice/:slug"
        element={
          <ProtectedRoute>
            {(loadedProfile) => (
              <AppShell profile={loadedProfile}>
                <PracticePage />
              </AppShell>
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/rooms"
        element={
          <ProtectedRoute>
            {(loadedProfile) => (
              <AppShell profile={loadedProfile}>
                <RoomsPage />
              </AppShell>
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/rooms/:roomId"
        element={
          <ProtectedRoute>
            {(loadedProfile) => <RoomRoute profile={loadedProfile} />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/papers"
        element={
          <ProtectedRoute>
            {(loadedProfile) => (
              <AppShell profile={loadedProfile}>
                <PaperUploadPage profile={loadedProfile} />
              </AppShell>
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/papers/:uploadId/review"
        element={
          <ProtectedRoute>
            {(loadedProfile) => {
              return (
                <AppShell profile={loadedProfile}>
                  <PaperReviewRoute profile={loadedProfile} />
                </AppShell>
              );
            }}
          </ProtectedRoute>
        }
      />
      <Route
        path="/papers/:uploadId/exam"
        element={
          <ProtectedRoute>
            {(loadedProfile) => (
              <AppShell profile={loadedProfile}>
                <ExamConfigureRoute profile={loadedProfile} />
              </AppShell>
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/papers/exams/:examId/start"
        element={
          <ProtectedRoute>
            {(loadedProfile) => (
              <AppShell profile={loadedProfile}>
                <ExamRunnerRoute profile={loadedProfile} />
              </AppShell>
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/papers/exams/attempts/:attemptId/results"
        element={
          <ProtectedRoute>
            {(loadedProfile) => (
              <AppShell profile={loadedProfile}>
                <ExamResultsRoute profile={loadedProfile} />
              </AppShell>
            )}
          </ProtectedRoute>
        }
      />
      <Route path="/invite/:code" element={<InvitePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function StudyRoute({ profile }: { profile: StudentProfile }) {
  const { resourceId } = useParams<{ resourceId: string }>();
  return (
    <AppShell profile={profile}>
      <WorkspaceLoader profile={profile} resourceId={resourceId ?? ''} />
    </AppShell>
  );
}

function RoomRoute({ profile }: { profile: StudentProfile }) {
  const { roomId } = useParams<{ roomId: string }>();
  return <RoomPage profile={profile} roomId={roomId ?? ''} />;
}

function PaperReviewRoute({ profile }: { profile: StudentProfile }) {
  const { uploadId } = useParams<{ uploadId: string }>();
  return <PaperReviewPage profile={profile} uploadId={uploadId ?? ''} />;
}

function ExamConfigureRoute({ profile }: { profile: StudentProfile }) {
  const { uploadId } = useParams<{ uploadId: string }>();
  return <ExamConfigurePage profile={profile} uploadId={uploadId ?? ''} />;
}

function ExamRunnerRoute({ profile }: { profile: StudentProfile }) {
  const { examId } = useParams<{ examId: string }>();
  return <ExamRunnerPage profile={profile} examId={examId ?? ''} />;
}

function ExamResultsRoute({ profile }: { profile: StudentProfile }) {
  const { attemptId } = useParams<{ attemptId: string }>();
  return <ExamResultsPage profile={profile} attemptId={attemptId ?? ''} />;
}

function LocationValidator() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <LocationValidator />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
