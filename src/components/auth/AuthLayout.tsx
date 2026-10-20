import type { ReactNode } from 'react';
import { BookOpenText } from 'lucide-react';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col-reverse lg:flex-row">
      {/* Brand panel — always dark in both themes (fixed color, not --ink) */}
      <div className="relative flex flex-col justify-between overflow-hidden bg-[#0d0d0d] px-6 py-8 text-white sm:px-10 lg:w-2/5 lg:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-white/5 blur-3xl"
        />
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#0d0d0d]">
            <BookOpenText className="h-5 w-5" aria-hidden />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            K12Learn2Gether
          </span>
        </div>
        <div className="my-8 max-w-md lg:my-0">
          <p className="font-display text-2xl font-bold leading-snug sm:text-3xl">
            Watch the teachers you trust.
            <br />
            Study with friends.
            <br />
            Actually make progress.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            A calm, focused study workspace — built around your
            goals, your playlist, and honest progress.
          </p>
        </div>
        <p className="text-xs text-white/50">
          Study together, learn better.
        </p>
      </div>

      {/* Form panel — follows theme, always readable */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:py-14">
        <div className="w-full max-w-md animate-fade-up">
          <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
          <p className="mt-1.5 text-sm text-ink-soft">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
