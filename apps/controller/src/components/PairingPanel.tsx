import type { ReactElement } from 'react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ControllerSnapshot } from '../lib/session.js';
import { useSession } from '../sessionContext.js';

interface PairingPanelProps {
  snapshot: ControllerSnapshot;
}

/** Manual pairing fallback for when the QR code cannot be scanned. */
export function PairingPanel({ snapshot }: PairingPanelProps): ReactElement {
  const session = useSession();
  const [code, setCode] = useState('');
  const [url, setUrl] = useState(snapshot.serverUrl);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void session.pairWithCode(code);
  };

  return (
    <section className="panel" aria-labelledby="pairing-heading">
      <div className="panel__head">
        <h2 id="pairing-heading">Pair with the laptop</h2>
      </div>

      {snapshot.roomCode ? (
        <p className="hint">
          Linked to room <strong className="mono">{snapshot.roomCode}</strong>. Press Reconnect if the
          connection drops, or unpair to use a different room.
        </p>
      ) : (
        <p className="hint">
          Enter the six-character room code shown next to the QR code in the browser game.
        </p>
      )}

      {snapshot.roomCode ? (
        <div className="button-row">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void session.pairWithCode(snapshot.roomCode as string)}
          >
            Reconnect
          </button>
          <button type="button" className="button button--ghost" onClick={() => session.unpair()}>
            Unpair
          </button>
        </div>
      ) : (
        <form className="pair-form" onSubmit={submit}>
          <label className="field">
            <span>Room code</span>
            <input
              className="mono"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              placeholder="K7M2QX"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              aria-label="Room code"
            />
          </label>
          <button type="submit" className="button button--primary" disabled={code.trim().length < 6}>
            Join room
          </button>
        </form>
      )}

      <button
        type="button"
        className="link-button"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced((value) => !value)}
      >
        {showAdvanced ? 'Hide server settings' : 'Server settings'}
      </button>

      {showAdvanced ? (
        <form
          className="pair-form"
          onSubmit={(event) => {
            event.preventDefault();
            session.setServerUrl(url);
          }}
        >
          <label className="field">
            <span>Backend URL (leave empty to use this page’s origin)</span>
            <input
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="http://192.168.1.42:3001"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <button type="submit" className="button button--ghost">
            Apply &amp; reconnect
          </button>
          <p className="hint">
            Needed inside the Android app, where there is no dev proxy. It is stored only on this
            device.
          </p>
        </form>
      ) : null}
    </section>
  );
}
