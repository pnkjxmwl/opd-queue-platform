'use client';

import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { checkInByCode } from './actions';

/**
 * P6-WEB-02 · the camera half of the check-in desk.
 *
 * **The only client component in the console, and it earns it:** a camera cannot be
 * driven from the server. Everything it decodes is handed straight to the same
 * server action the manual field uses, so the camera is an INPUT METHOD and never a
 * second code path - it decides nothing, validates nothing, and does not know what a
 * check-in is.
 *
 * It is also allowed to be absent. docs/Phases.md warns that browser camera access
 * needs HTTPS or localhost, and reception's tablet on hospital Wi-Fi may have
 * neither; a desk machine may have no camera, and staff may decline the permission.
 * Every one of those ends with the manual field still on screen and an explanation -
 * never a broken page, because check-in must not depend on a camera.
 */

type State =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'submitting'; code: string }
  | { kind: 'unavailable'; why: string };

export function Scanner({ sessionId }: { sessionId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'starting' });

  // `useRef` rather than state: the decode callback fires many times a second and
  // must see the CURRENT value, not the one captured when the effect ran. Without
  // this a single QR in front of the lens submits the form dozens of times.
  const busy = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;

    // A secure context is the usual reason this is missing, and it is the failure
    // docs/Phases.md predicted. Say so plainly - "camera not working" would send
    // someone hunting for a hardware fault that is not there.
    if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
      setState({
        kind: 'unavailable',
        why: window.isSecureContext
          ? 'This browser does not expose a camera.'
          : 'The camera needs a secure connection. Open this console over HTTPS, or on localhost.',
      });
      return;
    }

    const scanner = new QrScanner(
      video,
      (result) => {
        if (busy.current) return;
        busy.current = true;
        setState({ kind: 'submitting', code: result.data });

        // Hand the payload to the server action VERBATIM. It is a signed opaque
        // reference; parsing, trimming or validating it here would be this client
        // forming an opinion about a credential it cannot verify.
        if (codeRef.current !== null && formRef.current !== null) {
          codeRef.current.value = result.data;
          formRef.current.requestSubmit();
        }
      },
      {
        // The action redirects, so the page re-renders and the scanner restarts
        // fresh. No de-duplication window is needed beyond `busy`.
        highlightScanRegion: true,
        highlightCodeOutline: true,
        preferredCamera: 'environment',
        maxScansPerSecond: 4,
      },
    );

    scanner
      .start()
      .then(() => setState({ kind: 'scanning' }))
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : '';
        setState({
          kind: 'unavailable',
          why:
            name === 'NotAllowedError'
              ? 'Camera permission was declined. Allow it in the browser’s address bar, or type the token below.'
              : name === 'NotFoundError'
                ? 'No camera on this device.'
                : 'The camera could not be started.',
        });
      });

    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, []);

  return (
    <div>
      <form action={checkInByCode} ref={formRef}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="checkInCode" ref={codeRef} />
      </form>

      <div className="relative mx-auto max-w-md overflow-hidden rounded-lg border border-line bg-ink">
        {/* Kept mounted even when unavailable: qr-scanner attaches to this element,
            and unmounting it on an error would make a later retry impossible. */}
        <video ref={videoRef} className="block w-full" muted playsInline />
        {state.kind !== 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center bg-canvas p-6 text-center text-body text-ink-muted">
            {state.kind === 'starting'
              ? 'Starting the camera…'
              : state.kind === 'submitting'
                ? 'Checking in…'
                : state.why}
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-body text-ink-muted" role="status">
        {state.kind === 'scanning'
          ? 'Point the camera at the patient’s token QR.'
          : state.kind === 'unavailable'
            ? 'Use the token number below instead — it works just as well.'
            : ' '}
      </p>
    </div>
  );
}
