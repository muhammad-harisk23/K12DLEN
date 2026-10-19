import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  document.body.textContent = 'App failed to start: root element missing.';
} else {
  const root = createRoot(rootElement);

  // Static fallback while the app module loads; any module-load failure
  // (missing env vars, network, bad import) lands here instead of a blank page.
  function renderFatal(title: string, detail: string) {
    const isDev = import.meta.env.DEV;
    root.render(
      <StrictMode>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#faf7f2',
            color: '#1f2937',
            fontFamily: 'system-ui, sans-serif',
            padding: '1.5rem',
          }}
        >
          <div
            style={{
              maxWidth: '24rem',
              background: '#ffffff',
              border: '1px solid #e6dfd3',
              borderRadius: '1rem',
              padding: '1.5rem',
              textAlign: 'center',
            }}
          >
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>{title}</h1>
            <p style={{ fontSize: '0.875rem', color: '#4b5563', lineHeight: 1.5, marginTop: '0.5rem' }}>
              {detail}
            </p>
            {isDev && fatalDetail && (
              <pre
                style={{
                  marginTop: '0.75rem',
                  maxHeight: '10rem',
                  overflow: 'auto',
                  textAlign: 'left',
                  fontSize: '0.75rem',
                  background: '#f1ece3',
                  borderRadius: '0.5rem',
                  padding: '0.5rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {fatalDetail}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: '1rem',
                padding: '0.625rem 1rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: '#0d9488',
                color: '#ffffff',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      </StrictMode>
    );
  }

  let fatalDetail = '';

  import('./App')
    .then(async ({ default: App }) => {
      const { supabaseInitError } = await import('./lib/supabase');
      if (supabaseInitError) {
        renderFatal('Setup problem', supabaseInitError);
        return;
      }
      root.render(
        <StrictMode>
          <App />
        </StrictMode>
      );
    })
    .catch((err) => {
      console.error('App failed to load', err);
      fatalDetail = `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}${err?.stack ? `\n${err.stack.split('\n').slice(1, 6).join('\n')}` : ''}`;
      renderFatal(
        'The app could not start',
        'A startup error prevented loading. Reloading usually fixes it — if it persists, check your connection.'
      );
    });
}
