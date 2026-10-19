import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { BookOpenText, FileText, LayoutDashboard, Library, LogOut, PencilLine } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
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

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
              <BookOpenText className="h-4.5 w-4.5" aria-hidden />
            </span>
            <span className="font-display text-base font-bold tracking-tight text-ink">
              K12Learn2Gether
            </span>
          </div>

          <nav className="flex items-center gap-1" aria-label="Main">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex min-h-touch items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-soft text-accent-strong'
                      : 'text-ink-soft hover:bg-sunken hover:text-ink'
                  }`
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
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
        </div>
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
