import type { ReactElement } from 'react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { GameSnapshot } from '../lib/types.js';

interface PairingOverlayProps {
  snapshot: GameSnapshot;
  onEndSession: () => void;
}

export function PairingOverlay({ snapshot, onEndSession }: PairingOverlayProps): ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot.pairingUrl) {
      setQrUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toCanvas(canvasRef.current, snapshot.pairingUrl, { width: 260, margin: 1.5 })
      .then(() => {
        if (!cancelled) setQrUrl(snapshot.pairingUrl);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'QR code failed');
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.pairingUrl]);

  if (snapshot.roomCode === null) return null;

  const showPairing = !snapshot.controllerConnected;
  if (!showPairing) return null;

  const expiresAt = snapshot.pairingExpiresAt;
  const expiresIn = expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 1000)) : null;

  return (
    <div className="overlay">
      <div className="overlay-card">
        <h1>Pair your phone to drive</h1>
        <p>Scan the QR code with the TiltX Controller app on your Android phone.</p>
        <div className="qr">
          <canvas ref={canvasRef} />
          {error ? <p className="error">{error}</p> : null}
        </div>
        <div className="pairing-details">
          <span className="label">Room code</span>
          <span className="mono big">{snapshot.pairingCode ?? snapshot.roomCode}</span>
          {expiresIn !== null ? <span className="note">Expires in {expiresIn}s</span> : null}
        </div>
        <ol className="instructions">
          <li>Connect your phone to the same Wi-Fi network as this laptop.</li>
          <li>Open the TiltX Controller app (or load <code>{snapshot.pairingUrl}</code>).</li>
          <li>Scan the QR code or enter the room code above.</li>
          <li>Calibrate, then press Start Driving on your phone.</li>
        </ol>
        {snapshot.errorMessage ? <p className="error">{snapshot.errorMessage}</p> : null}
        <button className="button" onClick={onEndSession}>
          End session
        </button>
      </div>
    </div>
  );
}
