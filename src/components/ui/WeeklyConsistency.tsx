import type { DailyProgressDay } from '@/lib/progress';

interface WeeklyConsistencyProps {
  days: DailyProgressDay[];
  goal: number;
  streak: number;
}

/**
 * A 14-day activity strip. Each day is a column showing the day letter and
 * a vertical fill bar. Three visual states:
 *   - goal met (teal, full)
 *   - some activity (teal at partial height)
 *   - none (faint)
 */
export function WeeklyConsistency({ days, goal, streak }: WeeklyConsistencyProps) {
  return (
    <div>
      <div className="flex items-end justify-between gap-1.5" role="list" aria-label="Last 14 days of learning activity">
        {days.map((d) => {
          const ratio = goal > 0 ? Math.min(1, d.gradedAnswers / goal) : 0;
          const hasActivity = d.gradedAnswers > 0;
          const met = d.goalMet;
          const dayLetter = dayLetterFor(d.date);
          return (
            <div
              key={d.date}
              role="listitem"
              className="flex flex-1 flex-col items-center gap-1.5"
              title={`${d.date}: ${d.gradedAnswers} answered, ${d.correctAnswers} correct${met ? ' · goal met' : ''}`}
            >
              <div className="relative h-16 w-full overflow-hidden rounded-md bg-sunken">
                <div
                  className={`absolute bottom-0 left-0 right-0 rounded-md transition-all duration-500 ${
                    met ? 'bg-accent' : hasActivity ? 'bg-accent/50' : 'bg-transparent'
                  }`}
                  style={{ height: `${Math.round(ratio * 100)}%` }}
                />
              </div>
              <span className={`text-[10px] font-medium ${met || hasActivity ? 'text-accent-strong' : 'text-ink-faint'}`}>
                {dayLetter}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-ink-soft">Goal met days are highlighted in teal.</span>
        <span className="font-medium text-ink">
          {streak > 0 ? `${streak}-day streak` : 'No streak yet'}
        </span>
      </div>
    </div>
  );
}

function dayLetterFor(dateStr: string): string {
  if (!dateStr) return '·';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '·';
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()];
}
