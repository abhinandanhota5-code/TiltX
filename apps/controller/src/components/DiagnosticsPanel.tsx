import type { ReactElement } from 'react';
import { useState } from 'react';
import { ControllerSnapshot } from '../lib/session.js';
import { formatMs } from '../lib/status.js';

interface DiagnosticsPanelProps {
  snapshot: ControllerSnapshot;
}

/**
 * Development diagnostics. Hidden by default; every number shown is measured,
 * never estimated — except the last server message age which is labelled.
 */
export function DiagnosticsPanel({ snapshot }: DiagnosticsPanelProps): ReactElement | null {
  const [open, setOpen] = useState(false);

  return (
    <section className="panel diagnostics">
      <div className="panel__head">
        <h2>Diagnostics</h2>
        <button
          type="button"
          className="link-button"
          aria-expanded={open}
          aria-controls="diagnostics-body"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open ? (
        <dl id="diagnostics-body" className="diag-grid">
          <div>
            <dt>Round-trip latency</dt>
            <dd>{formatMs(snapshot.rttMs)}</dd>
          </div>
          <div>
            <dt>Outgoing packets</dt>
            <dd>{snapshot.packetsSent}</dd>
          </div>
          <div>
            <dt>Measured send rate</dt>
            <dd>{snapshot.measuredHz} Hz</dd>
          </div>
          <div>
            <dt>Target send rate</dt>
            <dd>{snapshot.inputHz} Hz</dd>
          </div>
          <div>
            <dt>Sensor samples</dt>
            <dd>{snapshot.sampleCount}</dd>
          </div>
          <div>
            <dt>Socket id</dt>
            <dd className="mono">{snapshot.socketId ?? '—'}</dd>
          </div>
          <div>
            <dt>Reconnect attempts</dt>
            <dd>{snapshot.reconnectAttempts}</dd>
          </div>
          <div>
            <dt>Motion source</dt>
            <dd>{snapshot.nativeSource ? 'native (Capacitor)' : 'browser DeviceMotion'}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
