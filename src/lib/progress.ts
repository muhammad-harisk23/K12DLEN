import { supabase } from '@/lib/supabase';
import { parsePracticeSummary } from '@/lib/practiceCore';
import type { PracticeSummary } from '@/lib/practiceCore';

function rpcError(scope: string): never {
  throw new Error(`${scope} failed. Please refresh and try again.`);
}

export interface DailyGoal {
  questionsGoal: number;
  timezone: string;
}

export interface DailyProgressDay {
  date: string;
  gradedAnswers: number;
  correctAnswers: number;
  missionsCompleted: number;
  goalMet: boolean;
}

export interface ProgressOverview {
  goal: DailyGoal;
  today: DailyProgressDay;
  last14: DailyProgressDay[];
  streak: number;
  practice: PracticeSummary;
}

function parseDay(raw: unknown): DailyProgressDay {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    date: typeof r.date === 'string' ? r.date : '',
    gradedAnswers: Number.isInteger(r.gradedAnswers) ? (r.gradedAnswers as number) : 0,
    correctAnswers: Number.isInteger(r.correctAnswers) ? (r.correctAnswers as number) : 0,
    missionsCompleted: Number.isInteger(r.missionsCompleted) ? (r.missionsCompleted as number) : 0,
    goalMet: r.goalMet === true,
  };
}

export function parseProgressOverview(raw: unknown): ProgressOverview | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.status !== 'ok') return null;
  const g = (r.goal ?? {}) as Record<string, unknown>;
  const goal: DailyGoal = {
    questionsGoal: Number.isInteger(g.questionsGoal) ? (g.questionsGoal as number) : 5,
    timezone: typeof g.timezone === 'string' ? g.timezone : 'Asia/Kolkata',
  };
  return {
    goal,
    today: parseDay(r.today),
    last14: Array.isArray(r.last14) ? (r.last14 as unknown[]).map(parseDay) : [],
    streak: Number.isInteger(r.streak) ? (r.streak as number) : 0,
    practice: parsePracticeSummary(r.practice),
  };
}

export async function fetchProgressOverview(): Promise<ProgressOverview> {
  const { data, error } = await supabase.rpc('progress_overview_secure');
  if (error) rpcError('Loading your progress');
  return parseProgressOverview(data) ?? rpcError('Loading your progress');
}

export async function saveDailyGoal(questionsGoal: number, timezone: string): Promise<DailyGoal> {
  const { data, error } = await supabase.rpc('upsert_my_daily_goal', {
    p_questions_goal: questionsGoal,
    p_timezone: timezone,
  });
  if (error) rpcError('Saving your daily goal');
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.status !== 'saved') rpcError('Saving your daily goal');
  return {
    questionsGoal: Number.isInteger(r.questionsGoal) ? (r.questionsGoal as number) : questionsGoal,
    timezone: typeof r.timezone === 'string' ? r.timezone : timezone,
  };
}
