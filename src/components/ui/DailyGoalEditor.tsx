import { useState } from 'react';
import { Check, Target } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface DailyGoalEditorProps {
  questionsGoal: number;
  onSave: (goal: number) => Promise<void>;
  saving: boolean;
}

const PRESETS = [3, 5, 10, 15];

/**
 * Inline editor for the daily learning commitment. Keeps the UI compact
 * (no modal) and shows the current commitment clearly.
 */
export function DailyGoalEditor({ questionsGoal, onSave, saving }: DailyGoalEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(questionsGoal);

  async function handleSave() {
    if (draft < 1 || draft > 50) return;
    await onSave(draft);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-strong">
          <Target className="h-3.5 w-3.5" aria-hidden />
          {questionsGoal} / day
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft(questionsGoal);
            setEditing(true);
          }}
          className="text-xs font-medium text-accent hover:text-accent-strong"
        >
          Adjust
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-sunken/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Daily commitment
      </p>
      <p className="mt-1 text-xs text-ink-faint">
        How many practice questions will you answer each day? Pick a number you can keep.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setDraft(n)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              draft === n
                ? 'bg-accent text-white'
                : 'bg-raised text-ink-soft border border-line hover:border-accent/50'
            }`}
          >
            {n}
          </button>
        ))}
        <label className="flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1 text-sm">
          <input
            type="number"
            min={1}
            max={50}
            value={draft}
            onChange={(e) => setDraft(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className="w-12 bg-transparent text-center font-medium text-ink outline-none"
            aria-label="Custom daily goal"
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => void handleSave()} loading={saving}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          Save goal
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
