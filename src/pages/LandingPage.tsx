import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpenText,
  Brain,
  CalendarCheck,
  ClipboardList,
  Clock,
  FileQuestion,
  GraduationCap,
  Lightbulb,
  MessageSquareText,
  PlayCircle,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Users,
  XCircle,
  Youtube,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export function LandingPage() {
  const { session } = useAuth();
  const primaryHref = session ? '/dashboard' : '/signup';
  const primaryLabel = session ? 'Go to dashboard' : 'Start learning free';

  return (
    <div className="min-h-screen bg-surface">
      {/* ---- Nav bar ---- */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
              <BookOpenText className="h-4.5 w-4.5" aria-hidden />
            </span>
            <span className="font-display text-base font-bold tracking-tight text-ink">
              K12Learn2Gether
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/signin"
              className="flex min-h-touch items-center rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              to={primaryHref}
              className="flex min-h-touch items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-strong"
            >
              {primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ===== HERO ===== */}
        <section className="relative overflow-hidden px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24">
          {/* Decorative floating shapes */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="landing-float-slow absolute right-[8%] top-[20%] h-20 w-20 rounded-full bg-accent-soft/40" />
            <div className="landing-float-slower absolute left-[5%] top-[60%] h-14 w-14 rounded-full bg-accent-soft/30" />
            <div className="landing-float-slow absolute right-[15%] bottom-[10%] h-10 w-10 rounded-full bg-accent-soft/20" />
          </div>

          <div className="relative mx-auto max-w-3xl text-center">
            <span className="landing-hero-enter inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft/50 px-3 py-1 text-xs font-semibold text-accent-strong">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              One focused place to learn
            </span>

            <h1 className="landing-hero-delay-1 mt-5 font-display text-3xl font-bold leading-tight text-ink sm:text-5xl sm:leading-[1.1]">
              Studying shouldn't take six tabs.
            </h1>

            <p className="landing-hero-delay-2 mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
              Your favorite teachers. Your questions. Your people. One focused place.
            </p>

            <div className="landing-hero-delay-3 mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={primaryHref}
                className="flex min-h-touch w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong sm:w-auto"
              >
                {primaryLabel}
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
              <Link
                to="/signin"
                className="flex min-h-touch w-full items-center justify-center rounded-xl border border-line bg-raised px-6 py-3 text-base font-medium text-ink transition-colors hover:border-line-strong hover:bg-sunken sm:w-auto"
              >
                I already have an account
              </Link>
            </div>
          </div>
        </section>

        {/* ===== BEFORE / AFTER COMPOSITION ===== */}
        <section className="px-4 pb-20 sm:px-6 sm:pb-28" aria-label="The problem and the solution">
          <div className="mx-auto max-w-4xl">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              {/* BEFORE */}
              <div className="landing-before-card rounded-2xl border border-line bg-sunken/60 p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Today
                </p>
                <p className="mt-1 font-display text-lg font-bold text-ink-soft">
                  Scattered across tabs
                </p>
                <ul className="mt-4 space-y-2.5">
                  {[
                    { icon: Youtube, text: 'Unfinished YouTube playlists' },
                    { icon: Sparkles, text: 'Distracting recommendations' },
                    { icon: MessageSquareText, text: 'AI answers lost in chat history' },
                    { icon: FileQuestion, text: 'Separate PDFs and timers' },
                    { icon: Target, text: 'No clear next study action' },
                  ].map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-center gap-2.5 text-sm text-ink-soft">
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-raised">
                        <Icon className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
                      </span>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Arrow */}
              <div className="flex items-center justify-center py-2 sm:py-0" aria-hidden>
                <span className="landing-arrow-pulse flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
                  <ArrowRight className="h-5 w-5 sm:rotate-0 rotate-90" />
                </span>
              </div>

              {/* AFTER */}
              <div className="landing-after-card rounded-2xl border border-accent/30 bg-gradient-to-br from-accent-soft/40 to-raised p-5 shadow-sm sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
                  With K12Learn2Gether
                </p>
                <p className="mt-1 font-display text-lg font-bold text-ink">
                  One focused mission
                </p>
                <ul className="mt-4 space-y-2.5">
                  {[
                    { icon: Target, text: 'One clear learning mission' },
                    { icon: PlayCircle, text: 'Saved YouTube lessons, focused' },
                    { icon: Users, text: 'Private shared study room' },
                    { icon: Brain, text: 'Persistent academic AI explanations' },
                    { icon: TrendingUp, text: 'Real practice and visible progress' },
                  ].map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-center gap-2.5 text-sm text-ink">
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-accent-soft">
                        <Icon className="h-3.5 w-3.5 text-accent-strong" aria-hidden />
                      </span>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ===== CHAPTER A: The problem ===== */}
        <Chapter
          index="A"
          eyebrow="The problem"
          title="Studying online feels fragmented."
          body="You open a YouTube lesson, switch to a PDF, paste a question into an AI chat, set a timer on another site, and try to remember where you left off. Context gets lost. Focus breaks. The next study session starts from scratch."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { icon: Youtube, label: 'YouTube tab' },
              { icon: FileQuestion, label: 'PDF tab' },
              { icon: Brain, label: 'AI tab' },
              { icon: Timer, label: 'Timer tab' },
              { icon: MessageSquareText, label: 'Notes tab' },
              { icon: XCircle, label: 'Lost context' },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-2 rounded-xl border border-line bg-sunken/50 p-4 text-center"
              >
                <Icon className="h-5 w-5 text-ink-faint" aria-hidden />
                <span className="text-xs font-medium text-ink-soft">{label}</span>
              </div>
            ))}
          </div>
        </Chapter>

        {/* ===== CHAPTER B: Bring your teacher ===== */}
        <Chapter
          index="B"
          eyebrow="Bring your teacher"
          title="Learn from the YouTube teachers you already trust."
          body="Paste any YouTube lesson link and it becomes a focused study session — the video plays distraction-free, your watch time is tracked, and your progress saves automatically. No recommendations sidebar. No rabbit holes."
          alternate
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-red-50">
                <Youtube className="h-5 w-5 text-red-600" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Paste any lesson link</p>
                <p className="truncate text-xs text-ink-soft">youtube.com/watch…</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent-soft/30 p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-accent-soft">
                <PlayCircle className="h-5 w-5 text-accent-strong" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Focused player</p>
                <p className="text-xs text-ink-soft">No sidebar. No ads. Just the lesson.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-sunken">
                <Clock className="h-5 w-5 text-ink-soft" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Watch time tracked</p>
                <p className="text-xs text-ink-soft">Pick up exactly where you stopped.</p>
              </div>
            </div>
          </div>
        </Chapter>

        {/* ===== CHAPTER C: Study together ===== */}
        <Chapter
          index="C"
          eyebrow="Study together"
          title="Private rooms with shared academic AI."
          body="Create a private study room, invite your friends with a code, and ask questions to a shared academic AI tutor. Everyone sees the same explanations. No public feed, no unrestricted social chat — just focused academic discussion."
        >
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-raised p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-accent" aria-hidden />
                <p className="text-sm font-semibold text-ink">Private study room</p>
              </div>
              <p className="mt-1 text-xs text-ink-soft">Invite-only. No public discovery.</p>
            </div>
            <div className="rounded-xl border border-accent/20 bg-accent-soft/30 p-4">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-accent-strong" aria-hidden />
                <p className="text-sm font-semibold text-ink">Shared AI tutor</p>
              </div>
              <p className="mt-1 text-xs text-ink-soft">Everyone sees the same academic explanations.</p>
            </div>
            <div className="rounded-xl border border-line bg-sunken/50 p-4">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-ink-soft" aria-hidden />
                <p className="text-sm font-semibold text-ink-soft">Focused discussion</p>
              </div>
              <p className="mt-1 text-xs text-ink-faint">Academic questions only. No social noise.</p>
            </div>
          </div>
        </Chapter>

        {/* ===== CHAPTER D: Prove your learning ===== */}
        <Chapter
          index="D"
          eyebrow="Prove your learning"
          title="Real practice. Real mistakes. Real progress."
          body="After watching a lesson, test yourself with real practice questions graded by the server — not a self-scored quiz. See your mistakes with explanations, retake honestly when you're ready, and watch your accuracy improve over time."
          alternate
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-accent-soft">
                <ClipboardList className="h-5 w-5 text-accent-strong" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Server-graded practice</p>
                <p className="text-xs text-ink-soft">Your answers are checked objectively.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-amber-50">
                <Lightbulb className="h-5 w-5 text-amber-600" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Mistakes with explanations</p>
                <p className="text-xs text-ink-soft">Learn why an answer was wrong.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-sunken">
                <Timer className="h-5 w-5 text-ink-soft" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Honest retakes</p>
                <p className="text-xs text-ink-soft">Real timeouts. No gaming the score.</p>
              </div>
            </div>
          </div>
        </Chapter>

        {/* ===== CHAPTER E: Make effort visible ===== */}
        <Chapter
          index="E"
          eyebrow="Make effort visible"
          title="Goals, missions, consistency and achievements."
          body="Set a daily question goal. Complete study missions that connect lessons to practice. See your weekly consistency build day by day. And when you finish a mission, download a beautiful achievement card to share — no fake streaks, just real progress you earned."
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-raised p-4 text-center">
              <Target className="mx-auto h-5 w-5 text-accent" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-ink">Daily goals</p>
              <p className="text-xs text-ink-soft">Set your own pace.</p>
            </div>
            <div className="rounded-xl border border-line bg-raised p-4 text-center">
              <GraduationCap className="mx-auto h-5 w-5 text-accent" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-ink">Study missions</p>
              <p className="text-xs text-ink-soft">Lessons meet practice.</p>
            </div>
            <div className="rounded-xl border border-line bg-raised p-4 text-center">
              <CalendarCheck className="mx-auto h-5 w-5 text-accent" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-ink">Weekly consistency</p>
              <p className="text-xs text-ink-soft">Build the habit.</p>
            </div>
            <div className="rounded-xl border border-accent/20 bg-accent-soft/30 p-4 text-center">
              <Trophy className="mx-auto h-5 w-5 text-accent-strong" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-ink">Achievement cards</p>
              <p className="text-xs text-ink-soft">Share real progress.</p>
            </div>
          </div>
        </Chapter>

        {/* ===== CHAPTER F: CTA ===== */}
        <section className="px-4 py-20 sm:px-6 sm:py-28" aria-label="Start your learning journey">
          <div className="landing-chapter-reveal mx-auto max-w-2xl rounded-3xl border border-accent/20 bg-gradient-to-br from-accent-soft/50 via-raised to-raised p-8 text-center shadow-sm sm:p-12">
            <h2 className="font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
              Start your learning journey.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft sm:text-base">
              Bring your favorite YouTube teacher. Focus. Practice. Prove what you learned.
              All in one place.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={primaryHref}
                className="flex min-h-touch w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong sm:w-auto"
              >
                {primaryLabel}
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
              <Link
                to="/signin"
                className="flex min-h-touch w-full items-center justify-center rounded-xl border border-line bg-raised px-6 py-3 text-base font-medium text-ink transition-colors hover:border-line-strong hover:bg-sunken sm:w-auto"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-5 text-xs text-ink-faint">
              Free to use. No credit card. Your data stays private.
            </p>
          </div>
        </section>
      </main>

      {/* ---- Footer ---- */}
      <footer className="border-t border-line py-8">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
                <BookOpenText className="h-4 w-4" aria-hidden />
              </span>
              <span className="font-display text-sm font-bold text-ink">K12Learn2Gether</span>
            </div>
            <p className="text-xs text-ink-faint">Study together, learn better.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---- Reusable chapter component ----

interface ChapterProps {
  index: string;
  eyebrow: string;
  title: string;
  body: string;
  alternate?: boolean;
  children: React.ReactNode;
}

function Chapter({ index, eyebrow, title, body, alternate, children }: ChapterProps) {
  return (
    <section className="border-t border-line px-4 py-16 sm:px-6 sm:py-24" aria-label={eyebrow}>
      <div className="mx-auto max-w-4xl">
        <div className={`grid gap-8 sm:grid-cols-2 sm:items-center ${alternate ? 'sm:[&>*:first-child]:order-2' : ''}`}>
          {/* Text side */}
          <div className="landing-chapter-reveal">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-accent text-xs font-bold text-white">
                {index}
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
                {eyebrow}
              </p>
            </div>
            <h2 className="mt-4 font-display text-xl font-bold leading-tight text-ink sm:text-2xl">
              {title}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft sm:text-base">
              {body}
            </p>
          </div>
          {/* Visual side */}
          <div className="landing-chapter-reveal" style={{ animationDelay: '0.15s' }}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
