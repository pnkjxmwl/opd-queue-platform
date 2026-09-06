'use client';

/**
 * The last resort: the root layout itself failed.
 *
 * Every other boundary renders *inside* that layout, so if the layout is what threw
 * there is nothing left to render into and the user gets a blank white page - the
 * one failure that looks identical to a crashed browser tab. This replaces it with a
 * sentence.
 *
 * It must ship its own `<html>` and `<body>`: the layout that normally provides them
 * is the thing that is broken. That also means none of the app's fonts or Tailwind
 * layers are guaranteed to be present, which is why the styling here is inline and
 * deliberately plain rather than using the design tokens every other screen does.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif',
          background: '#F7FAFC',
          color: '#0F172A',
        }}
      >
        <main style={{ maxWidth: '28rem', padding: '32px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '22px', letterSpacing: '-0.02em', margin: '0 0 8px' }}>The console could not start</h1>
          <p style={{ margin: '0 0 24px', color: '#64748B', fontSize: '15px', lineHeight: 1.6 }}>
            Something failed before the page could load. Reloading usually fixes it. If it does
            not, the system may be down — please tell your hospital administrator.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: '44px',
              padding: '0 20px',
              border: 0,
              borderRadius: '8px',
              background: '#0E7C7B',
              color: '#fff',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest !== undefined && (
            <p style={{ marginTop: '24px', fontSize: '12px', color: '#64748B' }}>
              Reference: <span style={{ fontFamily: 'monospace' }}>{error.digest}</span>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
