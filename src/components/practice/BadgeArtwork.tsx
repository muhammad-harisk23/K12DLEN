import type { Badge } from '@/lib/achievements';

interface BadgeArtworkProps {
  slug: Badge['slug'];
  earned: boolean;
  size?: number;
}

/**
 * Original SVG badge artwork for the three launch badges.
 * Each has a unique visual motif — no generic icon-in-circle.
 *
 * First Mission: an opening horizon / sunrise path — a milestone reached.
 * Practice Finisher: a structured checkmark within layered geometric tiles.
 * Personal Best: an upward rising form with ascending bars.
 */
export function BadgeArtwork({ slug, earned, size = 96 }: BadgeArtworkProps) {
  const palette = earned
    ? {
        primary: '#0d9488',
        strong: '#0f766e',
        soft: '#ccfbf1',
        ink: '#1f2937',
        inkSoft: '#4b5563',
        surface: '#ffffff',
        border: '#e6dfd3',
      }
    : {
        primary: '#d4cab8',
        strong: '#d4cab8',
        soft: '#f1ece3',
        ink: '#8b8478',
        inkSoft: '#a8a094',
        surface: '#f1ece3',
        border: '#e6dfd3',
      };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`${slug === 'first_mission' ? 'First Mission' : slug === 'practice_finisher' ? 'Practice Finisher' : 'Personal Best'} badge — ${earned ? 'earned' : 'locked'}`}
    >
      <defs>
        <linearGradient id={`badge-bg-${slug}-${earned}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.surface} />
          <stop offset="100%" stopColor={palette.soft} />
        </linearGradient>
        <linearGradient id={`badge-shine-${slug}-${earned}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={earned ? '#ffffff' : '#e6dfd3'} stopOpacity="0.6" />
          <stop offset="50%" stopColor={earned ? '#ccfbf1' : '#f1ece3'} stopOpacity="0.3" />
          <stop offset="100%" stopColor={earned ? '#0f766e' : '#d4cab8'} stopOpacity="0.1" />
        </linearGradient>
        {earned && (
          <linearGradient id={`badge-highlight-${slug}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        )}
      </defs>

      {/* Outer rounded square — the badge frame */}
      <rect x="6" y="6" width="108" height="108" rx="24" fill={`url(#badge-bg-${slug}-${earned})`} stroke={palette.border} strokeWidth="1.5" />

      {/* Inner elevated panel */}
      <rect x="14" y="14" width="92" height="92" rx="18" fill={palette.surface} opacity="0.7" />

      {/* Decorative top dots */}
      <circle cx="38" cy="26" r="2" fill={palette.primary} opacity={earned ? 0.5 : 0.3} />
      <circle cx="60" cy="26" r="2" fill={palette.primary} opacity={earned ? 0.7 : 0.3} />
      <circle cx="82" cy="26" r="2" fill={palette.primary} opacity={earned ? 0.5 : 0.3} />

      {slug === 'first_mission' && <FirstMissionMotif palette={palette} earned={earned} />}
      {slug === 'practice_finisher' && <PracticeFinisherMotif palette={palette} earned={earned} />}
      {slug === 'personal_best' && <PersonalBestMotif palette={palette} earned={earned} />}

      {/* Shine overlay for earned badges */}
      {earned && (
        <rect x="14" y="14" width="92" height="92" rx="18" fill={`url(#badge-highlight-${slug})`} opacity="0.5" />
      )}

      {/* Lock icon for locked badges */}
      {!earned && (
        <g transform="translate(48, 78)">
          <rect x="0" y="6" width="24" height="18" rx="4" fill={palette.ink} opacity="0.3" />
          <path d="M4 6 V4 a8 8 0 0 1 16 0 V6" stroke={palette.ink} strokeWidth="2.5" fill="none" opacity="0.3" strokeLinecap="round" />
          <circle cx="12" cy="15" r="2.5" fill={palette.surface} opacity="0.5" />
        </g>
      )}
    </svg>
  );
}

type Palette = {
  primary: string;
  strong: string;
  soft: string;
  ink: string;
  inkSoft: string;
  surface: string;
  border: string;
};

/** Opening horizon — a sun rising over a path, representing the first milestone reached. */
function FirstMissionMotif({ palette, earned }: { palette: Palette; earned: boolean }) {
  return (
    <g>
      {/* Horizon arc — the opening path */}
      <path d="M28 82 Q60 58 92 82" stroke={palette.primary} strokeWidth="3" fill="none" strokeLinecap="round" opacity={earned ? 0.4 : 0.25} />
      {/* Rising sun / milestone */}
      <circle cx="60" cy="62" r="14" fill={palette.soft} opacity="0.8" />
      <circle cx="60" cy="62" r="10" fill={palette.primary} opacity={earned ? 0.9 : 0.4} />
      {/* Radiating lines */}
      <g stroke={palette.primary} strokeWidth="2.5" strokeLinecap="round" opacity={earned ? 0.6 : 0.25}>
        <line x1="60" y1="42" x2="60" y2="36" />
        <line x1="42" y1="48" x2="38" y2="44" />
        <line x1="78" y1="48" x2="82" y2="44" />
      </g>
      {/* Ground line */}
      <line x1="24" y1="88" x2="96" y2="88" stroke={palette.border} strokeWidth="2" strokeLinecap="round" />
      {/* Milestone marker */}
      <circle cx="60" cy="88" r="3" fill={palette.strong} opacity={earned ? 1 : 0.4} />
    </g>
  );
}

/** Structured checkmark within layered geometric tiles — completing a full set. */
function PracticeFinisherMotif({ palette, earned }: { palette: Palette; earned: boolean }) {
  return (
    <g>
      {/* Background tiles — a structured grid suggesting a completed sequence */}
      <g opacity={earned ? 0.25 : 0.12}>
        <rect x="34" y="38" width="16" height="16" rx="3" fill={palette.primary} />
        <rect x="52" y="38" width="16" height="16" rx="3" fill={palette.primary} />
        <rect x="70" y="38" width="16" height="16" rx="3" fill={palette.primary} />
        <rect x="34" y="56" width="16" height="16" rx="3" fill={palette.primary} />
        <rect x="70" y="56" width="16" height="16" rx="3" fill={palette.primary} />
      </g>
      {/* Central checkmark tile */}
      <rect x="48" y="50" width="24" height="24" rx="5" fill={palette.soft} opacity="0.9" />
      <rect x="48" y="50" width="24" height="24" rx="5" fill="none" stroke={palette.primary} strokeWidth="1.5" opacity={earned ? 0.5 : 0.2} />
      {/* The checkmark */}
      <path
        d="M53 62 L58 67 L67 56"
        stroke={palette.strong}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={earned ? 1 : 0.35}
      />
      {/* Bottom completion bar */}
      <line x1="36" y1="86" x2="84" y2="86" stroke={palette.primary} strokeWidth="2.5" strokeLinecap="round" opacity={earned ? 0.5 : 0.2} />
    </g>
  );
}

/** Ascending bars with an upward arrow — a new personal best rising above the previous. */
function PersonalBestMotif({ palette, earned }: { palette: Palette; earned: boolean }) {
  return (
    <g>
      {/* Previous best bar — lower, muted */}
      <rect x="36" y="72" width="14" height="14" rx="2" fill={palette.primary} opacity={earned ? 0.3 : 0.15} />
      {/* New best bar — taller, prominent */}
      <rect x="56" y="52" width="14" height="34" rx="2" fill={palette.soft} opacity="0.8" />
      <rect x="56" y="52" width="14" height="34" rx="2" fill="none" stroke={palette.primary} strokeWidth="1.5" opacity={earned ? 0.6 : 0.2} />
      {/* Third bar — ascending further */}
      <rect x="76" y="40" width="14" height="46" rx="2" fill={palette.primary} opacity={earned ? 0.5 : 0.15} />
      {/* Upward trend line */}
      <path
        d="M32 84 L50 68 L68 56 L88 40"
        stroke={palette.strong}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={earned ? 0.8 : 0.25}
      />
      {/* Arrowhead at the peak */}
      <path
        d="M84 38 L88 40 L86 44"
        stroke={palette.strong}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={earned ? 0.9 : 0.25}
      />
      {/* Star at the peak for earned */}
      {earned && (
        <circle cx="88" cy="38" r="3" fill={palette.strong} opacity="0.9" />
      )}
    </g>
  );
}
