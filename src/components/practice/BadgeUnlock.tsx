import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BadgeArtwork } from '@/components/practice/BadgeArtwork';
import type { Badge } from '@/lib/achievements';

interface BadgeUnlockProps {
  badge: Badge;
  onClose: () => void;
  onViewAchievements: () => void;
  onContinue: () => void;
}

/**
 * Signature badge unlock reveal — a short, premium collectible moment.
 * Stages: silhouette → shine sweep → full reveal → text → actions.
 * Honors prefers-reduced-motion via CSS (animations become no-ops).
 */
export function BadgeUnlock({ badge, onClose, onViewAchievements, onContinue }: BadgeUnlockProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState<'closed' | 'reveal' | 'actions'>('reveal');

  useEffect(() => {
    closeBtnRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const t = window.setTimeout(() => setStage('actions'), 1400);
    return () => window.clearTimeout(t);
  }, []);

  const earnedDate = badge.earnedAt
    ? new Date(badge.earnedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div
      className="celebration-overlay fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`New badge unlocked: ${badge.name}`}
    >
      <div className="badge-unlock-card relative w-full max-w-sm overflow-hidden rounded-3xl border border-accent/20 bg-raised shadow-2xl">
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="Close badge reveal"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>

        <div className="relative flex flex-col items-center p-6 pt-12 sm:p-8 sm:pt-14">
          {/* Stage A/B/C — badge artwork with shine sweep */}
          <div className="relative">
            <div className="badge-unlock-silhouette relative">
              <BadgeArtwork slug={badge.slug} earned size={120} />
              {/* Shine sweep overlay */}
              <div className="badge-unlock-shine pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent" />
              </div>
            </div>
          </div>

          {/* Stage D — title and description */}
          <div className="badge-unlock-text mt-5 text-center">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-accent-strong">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Badge unlocked
            </p>
            <h2 className="mt-2 font-display text-xl font-bold text-ink sm:text-2xl">
              {badge.name}
            </h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
              {badge.description}
            </p>
            {earnedDate && (
              <p className="mt-2 text-xs text-ink-faint">Earned {earnedDate}</p>
            )}
          </div>

          {/* Stage E — actions */}
          {stage === 'actions' && (
            <div className="badge-unlock-actions mt-6 flex w-full flex-col gap-2.5">
              <Button onClick={onViewAchievements} className="w-full">
                View achievements
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="secondary" onClick={onContinue} className="w-full">
                Continue learning
              </Button>
            </div>
          )}
        </div>

        {/* Screen reader announcement */}
        <span className="sr-only" role="status" aria-live="polite">
          New badge unlocked: {badge.name}. {badge.description}.
          {earnedDate ? ` Earned ${earnedDate}.` : ''}
        </span>
      </div>
    </div>
  );
}
