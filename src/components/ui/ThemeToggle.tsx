import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={`group relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-raised text-ink-soft transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <Sun
        className={`h-4 w-4 transition-all duration-300 ${isDark ? 'scale-0 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'}`}
        aria-hidden
      />
      <Moon
        className={`absolute h-4 w-4 transition-all duration-300 ${isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 rotate-90 opacity-0'}`}
        aria-hidden
      />
    </button>
  );
}
