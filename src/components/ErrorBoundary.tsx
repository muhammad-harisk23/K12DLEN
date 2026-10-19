import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Capture name, message, JS stack, and React component stack for diagnosis.
    console.error('App render error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      const isDev = import.meta.env.DEV;
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface px-4">
          <div className="max-w-sm rounded-2xl border border-line bg-raised p-6 text-center shadow-sm">
            <h1 className="font-display text-lg font-bold text-ink">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              The app hit an unexpected error while loading. Reloading usually
              fixes it.
            </p>
            {isDev && (
              <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-sunken p-2 text-left text-xs text-ink-soft">
                {this.state.error.name}: {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 min-h-touch rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
