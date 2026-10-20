import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { BookOpenText, FileText, LayoutDashboard, Library, LogOut, Menu, PencilLine, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import type { StudentProfile } from '@/types/curriculum';

interface AppShellProps {
  profile: StudentProfile;
  children: ReactNode;
}

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/practice', label: 'Practice', icon: PencilLine },
  { to: '/papers', label: 'Papers', icon: FileText },
  { to: '/library', label: 'Library', icon: Library },
];

export function AppShell({ profile, children }: AppShellProps) {
  const { signOut, user } = useAuth();
  void profile;
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-white">
              <BookOpenText className="h-4 w-4" aria-hidden />
            </span>
            <span className="font-display text-base font-bold tracking-tight text-ink">
              K12Learn2Gether
            </span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex min-h-touch items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-sunken text-ink'
                      : 'text-ink-soft hover:bg-sunken/60 hover:text-ink'
                  }`
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span>{label}</span>
              </NavLink>
            ))}
            <div className="mx-1 h-5 w-px bg-line" aria-hidden />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-touch items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
              title={`Sign out ${user?.email ?? ''}`}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="sr-only">Sign out</span>
            </button>
          </nav>

          {/* Mobile controls */}
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-raised text-ink-soft transition-colors hover:text-ink"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {mobileOpen && (
          <nav className="border-t border-line bg-surface md:hidden" aria-label="Mobile">
            <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
              <ul className="space-y-1">
                {navItems.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        `flex min-h-touch items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-sunken text-ink'
                            : 'text-ink-soft hover:bg-sunken/60 hover:text-ink'
                        }`
                      }
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {label}
                    </NavLink>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => { setMobileOpen(false); void signOut(); }}
                    className="flex min-h-touch w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    Sign out
                  </button>
                </li>
              </ul>
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-line py-6">
        <p className="text-center text-xs text-ink-faint">
          K12Learn2Gether — study together, learn better.
        </p>
      </footer>
    </div>
  );
}
