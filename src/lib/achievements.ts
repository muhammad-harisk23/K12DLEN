import { supabase } from '@/lib/supabase';

export interface Badge {
  slug: 'first_mission' | 'practice_finisher' | 'personal_best';
  name: string;
  description: string;
  earned: boolean;
  earnedAt: string | null;
  topicSlug?: string | null;
  bestScore?: number | null;
  bestTotal?: number | null;
}

export interface AchievementSummary {
  badges: Badge[];
  earnedCount: number;
}

function rpcError(scope: string): never {
  throw new Error(`${scope} failed. Please refresh and try again.`);
}

function parseBadge(raw: unknown): Badge | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const slug = r.slug;
  if (slug !== 'first_mission' && slug !== 'practice_finisher' && slug !== 'personal_best') return null;
  return {
    slug,
    name: typeof r.name === 'string' ? r.name : '',
    description: typeof r.description === 'string' ? r.description : '',
    earned: r.earned === true,
    earnedAt: typeof r.earnedAt === 'string' ? r.earnedAt : null,
    topicSlug: typeof r.topicSlug === 'string' ? r.topicSlug : null,
    bestScore: Number.isInteger(r.bestScore) ? (r.bestScore as number) : null,
    bestTotal: Number.isInteger(r.bestTotal) ? (r.bestTotal as number) : null,
  };
}

export function parseAchievementSummary(raw: unknown): AchievementSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.status !== 'ok') return { badges: [], earnedCount: 0 };
  const rawBadges = Array.isArray(r.badges) ? r.badges : [];
  const badges: Badge[] = [];
  for (const item of rawBadges) {
    const b = parseBadge(item);
    if (b) badges.push(b);
  }
  return {
    badges,
    earnedCount: badges.filter((b) => b.earned).length,
  };
}

export async function fetchAchievements(): Promise<AchievementSummary> {
  const { data, error } = await supabase.rpc('my_achievements_secure');
  if (error) rpcError('Loading your achievements');
  return parseAchievementSummary(data);
}
