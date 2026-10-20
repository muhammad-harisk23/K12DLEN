import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  BookOpenText,
  Brain,
  ClipboardList,
  Clock,
  Compass,
  FileText,
  GraduationCap,
  KeyRound,
  Layers,
  MessageSquareText,
  Moon,
  PlayCircle,
  Sun,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Users,
  X,
  Youtube,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';

/**
 * Reveal-on-scroll hook using IntersectionObserver.
 * Adds .is-visible to .reveal elements as they enter the viewport.
 */
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current ?? document.body;
    const els = Array.from(root.querySelectorAll<HTMLElement>('.reveal'));
    if (els.length === 0) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      els.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return ref;
}

export function LandingPage() {
  const { session } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const primaryHref = session ? '/dashboard' : '/signup';
  const primaryLabel = session ? 'Go to dashboard' : 'Start learning free';
  const scrollRef = useScrollReveal();

  return (
    <div ref={scrollRef} className="min-h-screen bg-surface text-ink">
      {/* ---- Nav ---- */}
      <header className="sticky top-0 z-30 border-b border-line/80 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-text shadow-sm">
              <BookOpenText className="h-4 w-4" aria-hidden />
            </span>
            <span className="font-display text-base font-bold tracking-tight text-ink">
              K12Learn2Gether
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-raised text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link
              to="/signin"
              className="hidden min-h-touch items-center rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink sm:flex"
            >
              Sign in
            </Link>
            <Link
              to={primaryHref}
              className="flex min-h-touch items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-text shadow-sm transition-all hover:bg-accent-strong hover:shadow-card"
            >
              {primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ===== HERO ===== */}
        <section className="relative overflow-hidden px-5 pt-16 pb-20 sm:px-8 sm:pt-24 sm:pb-32">
          {/* Subtle grid backdrop */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage:
                  'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
                backgroundSize: '56px 56px',
                maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
                WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
              }}
            />
          </div>

          <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            {/* Left — editorial copy */}
            <div className="max-w-xl">
              <span className="landing-hero-enter inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft/30 px-3 py-1 text-xs font-semibold text-accent-strong">
                <BookOpenText className="h-3.5 w-3.5" aria-hidden />
                One focused place to learn
              </span>

              <h1 className="landing-hero-delay-1 mt-6 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[3.5rem]">
                Studying shouldn't
                <br className="hidden sm:block" />{' '}
                take <span className="border-b-2 border-accent pb-0.5">six tabs.</span>
              </h1>

              <p className="landing-hero-delay-2 mt-5 max-w-md text-base leading-relaxed text-ink-soft sm:text-lg">
                Your favorite teachers. Your questions. Your people. One focused place —
                where YouTube lessons, shared academic AI, private study rooms, and honest
                practice finally live together.
              </p>

              <div className="landing-hero-delay-3 mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={primaryHref}
                  className="flex min-h-touch items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-accent-text shadow-card transition-all hover:bg-accent-strong hover:shadow-lifted sm:w-auto"
                >
                  {primaryLabel}
                  <ArrowRight className="h-5 w-5" aria-hidden />
                </Link>
                <Link
                  to="/signin"
                  className="flex min-h-touch items-center justify-center rounded-xl border border-line bg-raised px-6 py-3 text-base font-medium text-ink transition-colors hover:border-line-strong hover:bg-sunken sm:w-auto"
                >
                  I already have an account
                </Link>
              </div>

              <p className="landing-hero-delay-4 mt-6 text-xs text-ink-faint">
                Free to use. Your data stays private. No credit card.
              </p>
            </div>

            {/* Right — fragmented tabs converging into one workspace */}
            <div className="landing-hero-delay-3 relative mx-auto w-full max-w-md">
              <HeroComposition />
            </div>
          </div>
        </section>

        {/* ===== THE REAL PROBLEM — editorial sequence ===== */}
        <section className="border-t border-line px-5 py-20 sm:px-8 sm:py-28" aria-label="The real problem">
          <div className="mx-auto max-w-5xl">
            <div className="reveal max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                The real problem
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
                Studying online breaks your focus every few minutes.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-ink-soft">
                You never sit down intending to waste an hour. But each tab-switch pulls
                your attention somewhere else — and the lesson you came to learn gets lost
                in the noise.
              </p>
            </div>

            <ol className="mt-12 space-y-0">
              {PROBLEM_STEPS.map((step, i) => (
                <li
                  key={step.title}
                  className={`reveal reveal-delay-${Math.min(i, 3)} relative grid gap-4 border-line py-8 sm:grid-cols-[auto_1fr] sm:gap-8 ${
                    i !== PROBLEM_STEPS.length - 1 ? 'border-b' : ''
                  }`}
                >
                  <div className="flex items-center gap-4 sm:flex-col sm:items-start">
                    <span className="font-display text-3xl font-bold tabular-nums text-ink-faint/60">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <step.icon className="h-5 w-5 text-ink-faint" aria-hidden />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-semibold text-ink">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-soft sm:text-base">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ===== BEFORE / AFTER — signature comparison ===== */}
        <section className="px-5 py-20 sm:px-8 sm:py-28" aria-label="Before and after">
          <div className="mx-auto max-w-5xl">
            <div className="reveal mb-10 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                The transformation
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
                From scattered tabs to one focused mission.
              </h2>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
              {/* BEFORE */}
              <div className="reveal rounded-2xl border border-line bg-sunken/60 p-6 sm:p-7">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sunken text-ink-faint">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Today</p>
                </div>
                <p className="mt-3 font-display text-xl font-bold text-ink-soft">
                  Six tabs, no progress.
                </p>
                <div className="mt-5 space-y-2">
                  {BEFORE_ITEMS.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2.5 rounded-lg border border-line/60 bg-raised/60 px-3 py-2 text-sm text-ink-soft"
                    >
                      <span className="h-1.5 w-1.5 flex-none rounded-full bg-ink-faint/50" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              {/* Arrow */}
              <div className="flex items-center justify-center py-2 lg:py-0" aria-hidden>
                <span className="landing-arrow-pulse flex h-12 w-12 items-center justify-center rounded-full border border-accent/30 bg-accent-soft/40 text-accent-strong">
                  <ArrowRight className="h-5 w-5 rotate-90 lg:rotate-0" />
                </span>
              </div>

              {/* AFTER */}
              <div className="reveal reveal-delay-1 rounded-2xl border border-accent/25 bg-gradient-to-br from-accent-soft/25 to-raised p-6 shadow-card sm:p-7">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-text">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
                    With K12Learn2Gether
                  </p>
                </div>
                <p className="mt-3 font-display text-xl font-bold text-ink">
                  One mission, real progress.
                </p>
                <div className="mt-5 space-y-2">
                  {AFTER_ITEMS.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2.5 rounded-lg border border-accent/15 bg-raised px-3 py-2 text-sm text-ink"
                    >
                      <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== HOW IT WORKS — visual journey ===== */}
        <section className="border-t border-line px-5 py-20 sm:px-8 sm:py-28" aria-label="How K12Learn2Gether works">
          <div className="mx-auto max-w-5xl">
            <div className="reveal mb-12 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                How it works
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
                A single journey from lesson to proof.
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {WORKFLOW_STEPS.map((step, i) => (
                <div
                  key={step.title}
                  className={`reveal reveal-delay-${Math.min(i % 3, 3)} group relative overflow-hidden rounded-2xl border border-line bg-raised p-5 shadow-card transition-all hover:border-line-strong hover:shadow-lifted sm:p-6`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft/40 text-accent-strong transition-transform group-hover:scale-110">
                      <step.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="font-display text-4xl font-bold tabular-nums text-ink-faint/25">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 font-display text-base font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== WHAT'S COMING NEXT — roadmap ===== */}
        <section className="border-t border-line px-5 py-20 sm:px-8 sm:py-28" aria-label="What's coming next">
          <div className="mx-auto max-w-5xl">
            <div className="reveal mb-10 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
                What's coming next
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
                The foundation is here. More is on the way.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ink-soft sm:text-base">
                You can already upload a question paper today and review the extracted
                questions. The full examination experience is being refined carefully —
                not rushed out half-built.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {ROADMAP_ITEMS.map((item, i) => (
                <div
                  key={item.title}
                  className={`reveal reveal-delay-${Math.min(i % 2, 3)} flex items-start gap-3 rounded-xl border p-4 ${
                    item.status === 'available'
                      ? 'border-accent/20 bg-accent-soft/15'
                      : 'border-line bg-raised'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg ${
                      item.status === 'available'
                        ? 'bg-accent-soft text-accent-strong'
                        : 'bg-sunken text-ink-faint'
                    }`}
                  >
                    <item.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-sm font-semibold text-ink">{item.title}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          item.status === 'available'
                            ? 'bg-accent text-accent-text'
                            : 'bg-sunken text-ink-faint'
                        }`}
                      >
                        {item.status === 'available' ? 'Available' : 'In progress'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-soft">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== FREE CORE, FUTURE PREMIUM ===== */}
        <section className="border-t border-line px-5 py-20 sm:px-8 sm:py-24" aria-label="Free and future plans">
          <div className="mx-auto max-w-3xl">
            <div className="reveal rounded-2xl border border-line bg-raised p-6 shadow-sm sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <div className="flex-1">
                  <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">
                    Free to learn. Premium later, if you want it.
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                    Core learning — bringing your YouTube teachers, studying in rooms,
                    asking the shared AI, and practicing — stays free. No credit card.
                    No paywall on the basics.
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                    Later, optional premium tools may support heavier AI usage, deeper
                    practice modes, personalized revision, and richer analytics. Those
                    are still being built — not priced yet.
                  </p>
                </div>
                <div className="shrink-0 sm:w-px sm:self-stretch bg-line" aria-hidden />
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                    Free now
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-ink">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-accent-strong" aria-hidden />
                      Bring your own YouTube lessons
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-accent-strong" aria-hidden />
                      Private study rooms with shared AI
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-accent-strong" aria-hidden />
                      Topic practice and progress tracking
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-accent-strong" aria-hidden />
                      Earned achievements and badges
                    </li>
                  </ul>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    Coming later
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
                    <li>Unlimited AI with your own API key</li>
                    <li>Advanced exam and revision tools</li>
                    <li>Deeper analytics and competitions</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== FINAL CTA ===== */}
        <section className="border-t border-line px-5 py-24 sm:px-8 sm:py-32" aria-label="Begin">
          <div className="reveal mx-auto max-w-3xl text-center">
            <h2 className="font-display text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
              Start your learning journey.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-ink-soft">
              Bring your favorite YouTube teacher. Focus. Practice. Prove what you learned.
              All in one place.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={primaryHref}
                className="flex min-h-touch w-full items-center justify-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-base font-semibold text-accent-text shadow-card transition-all hover:bg-accent-strong hover:shadow-lifted sm:w-auto"
              >
                {primaryLabel}
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
              <Link
                to="/signin"
                className="flex min-h-touch w-full items-center justify-center rounded-xl border border-line bg-raised px-7 py-3.5 text-base font-medium text-ink transition-colors hover:border-line-strong hover:bg-sunken sm:w-auto"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ---- Footer ---- */}
      <footer className="border-t border-line py-10">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-text">
                <BookOpenText className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="font-display text-sm font-bold text-ink">K12Learn2Gether</span>
            </div>
            <div className="flex items-center gap-5 text-xs text-ink-faint">
              <Link to="/signin" className="transition-colors hover:text-ink">Sign in</Link>
              <Link to="/signup" className="transition-colors hover:text-ink">Create account</Link>
              <span>Study together, learn better.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ============ Hero composition: fragmented tabs → one workspace ============ */

function HeroComposition() {
  return (
    <div className="relative aspect-[4/5] w-full">
      {/* Scattered "tabs" on the left, converging toward the workspace card */}
      <FloatingTab
        className="hero-tab-converge landing-float-slow absolute left-0 top-[6%] w-[42%]"
        icon={Youtube}
        label="YouTube"
        rotate="-rotate-6"
        convergeX="40px"
        convergeY="30px"
      />
      <FloatingTab
        className="hero-tab-converge-2 landing-float-slower absolute left-[6%] top-[34%] w-[40%]"
        icon={Brain}
        label="AI chat"
        rotate="rotate-3"
        convergeX="35px"
        convergeY="10px"
      />
      <FloatingTab
        className="hero-tab-converge-3 landing-float-slow absolute left-[2%] top-[62%] w-[38%]"
        icon={Timer}
        label="Timer"
        rotate="-rotate-3"
        convergeX="40px"
        convergeY="-20px"
      />
      <FloatingTab
        className="hero-tab-converge-2 landing-float-slower absolute right-[2%] top-[12%] w-[40%]"
        icon={FileText}
        label="PDF"
        rotate="rotate-6"
        convergeX="-35px"
        convergeY="20px"
      />
      <FloatingTab
        className="hero-tab-converge-3 landing-float-slow absolute right-[4%] top-[44%] w-[42%]"
        icon={MessageSquareText}
        label="Notes"
        rotate="-rotate-2"
        convergeX="-30px"
        convergeY="0px"
      />

      {/* Convergence arrows — subtle dotted lines toward the center card */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="var(--accent)" opacity="0.3" />
          </pattern>
        </defs>
      </svg>

      {/* The focused workspace card — center, elevated */}
      <div className="absolute left-1/2 top-1/2 w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-accent/30 bg-raised p-4 shadow-lifted">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="font-display text-[11px] font-bold uppercase tracking-wide text-accent-strong">
              K12 Workspace
            </span>
          </div>
          <span className="flex h-5 w-5 items-center justify-center rounded bg-accent-soft/40 text-accent-strong">
            <BookOpenText className="h-3 w-3" />
          </span>
        </div>
        <div className="mt-3 space-y-1.5">
          <WorkspaceRow icon={PlayCircle} label="Lesson: Photosynthesis" active />
          <WorkspaceRow icon={Brain} label="Ask the AI tutor" />
          <WorkspaceRow icon={Users} label="Study room · 3 friends" />
          <WorkspaceRow icon={Target} label="5 questions to finish" />
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-accent-soft/30 px-2.5 py-1.5">
          <span className="text-[10px] font-medium text-accent-strong">Today's goal</span>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken">
            <div className="h-full w-3/5 rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

function FloatingTab({
  className = '',
  icon: Icon,
  label,
  rotate = '',
  convergeX = '0px',
  convergeY = '0px',
}: {
  className?: string;
  icon: typeof Youtube;
  label: string;
  rotate?: string;
  convergeX?: string;
  convergeY?: string;
}) {
  return (
    <div
      style={{
        ['--tab-rotate' as string]: rotate.replace('rotate', '').replace('-', '-').replace('rotate', '') || '0deg',
        ['--converge-x' as string]: convergeX,
        ['--converge-y' as string]: convergeY,
      }}
      className={`flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-2 shadow-card ${rotate} ${className}`}
    >
      <Icon className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
      <span className="truncate text-[11px] font-medium text-ink-soft">{label}</span>
    </div>
  );
}

function WorkspaceRow({
  icon: Icon,
  label,
  active = false,
}: {
  icon: typeof Brain;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
        active ? 'bg-accent-soft/30' : 'bg-sunken/40'
      }`}
    >
      <Icon
        className={`h-3 w-3 ${active ? 'text-accent-strong' : 'text-ink-faint'}`}
        aria-hidden
      />
      <span
        className={`text-[10px] font-medium ${active ? 'text-accent-strong' : 'text-ink-soft'}`}
      >
        {label}
      </span>
    </div>
  );
}

/* ============ Content ============ */

const PROBLEM_STEPS = [
  {
    icon: Youtube,
    title: 'You open YouTube for one lesson.',
    body: 'Forty minutes later you are three recommendations deep into something completely unrelated. The lesson you came for is still paused at 2:14.',
  },
  {
    icon: Layers,
    title: 'You jump between unfinished playlists.',
    body: 'Each video lives in a separate tab. You forget which one you were working through. Progress, if any, is in your head — nowhere else.',
  },
  {
    icon: MessageSquareText,
    title: 'You lose explanations in another AI tab.',
    body: 'You paste a question into a chat. The answer helps. Then the tab closes, the history scrolls away, and you can never find that explanation again.',
  },
  {
    icon: Clock,
    title: 'Your timer, your notes, your questions all live apart.',
    body: 'A timer on one site. Notes in a doc. Practice questions in a PDF. Nothing connects. Nothing remembers where you left off.',
  },
  {
    icon: Users,
    title: 'Group study loses its academic focus.',
    body: 'You try studying with friends, but the chat drifts. There is no shared lesson, no shared question, no shared direction.',
  },
  {
    icon: TrendingUp,
    title: 'You study without seeing meaningful progress.',
    body: 'Weeks pass. You cannot tell if you are getting better. No record. No streak. No honest evidence of what you actually learned.',
  },
];

const BEFORE_ITEMS = [
  'Unfinished YouTube playlists',
  'Distracting recommendations',
  'AI answers lost in chat history',
  'Separate timers, PDFs, and notes',
  'No clear next study action',
  'No evidence of progress',
];

const AFTER_ITEMS = [
  'One clear learning mission',
  'Saved YouTube lessons, focused',
  'Private shared study room',
  'Persistent academic AI explanations',
  'Real practice, honestly graded',
  'Goals, streaks, badges you earned',
];

const WORKFLOW_STEPS = [
  {
    icon: Youtube,
    title: 'Bring your teacher or playlist',
    body: 'Paste any YouTube lesson link. It becomes a focused study session — no sidebar, no rabbit holes, just the lesson.',
  },
  {
    icon: Compass,
    title: 'Study inside the focused workspace',
    body: 'Watch time is tracked. Your progress saves automatically. You always pick up exactly where you stopped.',
  },
  {
    icon: Users,
    title: 'Invite friends into a private room',
    body: 'Share a code. Everyone joins the same academic space — invite-only, no public feed, no unrestricted social chat.',
  },
  {
    icon: Brain,
    title: 'Ask the shared AI beside the video',
    body: 'Questions appear next to the playing lesson. Everyone sees the same explanations. Academic discussion, not noise.',
  },
  {
    icon: ClipboardList,
    title: 'Complete practice and prove learning',
    body: 'After the lesson, test yourself with real questions graded by the server. See mistakes with explanations. Retake honestly.',
  },
  {
    icon: Trophy,
    title: 'See goals, streaks, and achievements',
    body: 'Daily goals, study missions, weekly consistency, and beautiful achievement cards — built only from real, earned progress.',
  },
];

const ROADMAP_ITEMS = [
  {
    icon: FileText,
    title: 'Paper upload and question review',
    body: 'Upload your own question paper PDF and review the questions our AI extracts. Correct text, add answer keys, and confirm each question.',
    status: 'available' as const,
  },
  {
    icon: ClipboardList,
    title: 'Paper to Practice: real exam engine',
    body: 'Turn reviewed questions into genuine timed examinations with server-controlled deadlines, honest grading, and saved results.',
    status: 'in-progress' as const,
  },
  {
    icon: Layers,
    title: 'Animated Revision Vault and flashcards',
    body: 'Replay what you learned with spaced-repetition flashcards and a visual vault of your past lessons and notes.',
    status: 'in-progress' as const,
  },
  {
    icon: GraduationCap,
    title: 'Strict examination options',
    body: 'Timed, locked-down exam mode for practice that mirrors real test conditions — honestly enforced on the server.',
    status: 'in-progress' as const,
  },
  {
    icon: KeyRound,
    title: 'Bring Your Own API Key',
    body: 'Use your own AI provider key for unlimited academic questions, with transparent controls and private storage.',
    status: 'in-progress' as const,
  },
  {
    icon: TrendingUp,
    title: 'Deeper analytics and friendly competitions',
    body: 'See where your time goes, which topics need work, and join lightweight, opt-in challenges with your study group.',
    status: 'in-progress' as const,
  },
];
