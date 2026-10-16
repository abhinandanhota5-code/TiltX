import type { ReactElement } from 'react';
import { useCallback } from 'react';
import { useSession } from './sessionContext.js';
import { CalibrationPanel } from './components/CalibrationPanel.js';
import { DiagnosticsPanel } from './components/DiagnosticsPanel.js';
import { PairingPanel } from './components/PairingPanel.js';
import { PedalMeters } from './components/PedalMeters.js';
import { StatusPill } from './components/StatusPill.js';
import { SteeringMeter } from './components/SteeringMeter.js';
import { describeConnection, describeSensor, formatMs } from './lib/status.js';
import { useLiveControl, useSnapshot } from './hooks.js';

export function App(): ReactElement {
  const session = useSession();
  const snapshot = useSnapshot();
  const readLive = useLiveControl();

  const connection = describeConnection(snapshot);
  const sensor = describeSensor(snapshot);
  const read = useCallback(() => readLive(), [readLive]);

  const canStart = snapshot.paired && snapshot.calibrated && snapshot.sensorState === 'ready';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">TiltX</span>
          <span className="brand__tag">motion controller</span>
        </div>
        <div className="topbar__meta">
          <span className="chip mono" title="Room code">
            {snapshot.roomCode ?? 'no room'}
          </span>
          <StatusPill view={connection} live />
        </div>
      </header>

      <main className="content">
        {snapshot.errorMessage ? (
          <div className="alert" role="alert">
            <p>{snapshot.errorMessage}</p>
            <div className="button-row">
              {snapshot.roomCode ? (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void session.pairWithCode(snapshot.roomCode as string)}
                >
                  Reconnect
                </button>
              ) : null}
              <button type="button" className="button button--ghost" onClick={() => session.clearError()}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <p className="connection-detail" aria-live="polite">
          {connection.detail}
        </p>

        <div className="stat-row">
          <div className="stat">
            <span className="stat__label">Latency (RTT)</span>
            <span className="stat__value">{formatMs(snapshot.rttMs)}</span>
            <span className="stat__note">measured to the backend</span>
          </div>
          <div className="stat">
            <span className="stat__label">Send rate</span>
            <span className="stat__value">{snapshot.measuredHz} Hz</span>
            <span className="stat__note">target {snapshot.inputHz} Hz</span>
          </div>
          <div className="stat">
            <span className="stat__label">Sensors</span>
            <span className="stat__value">{snapshot.sampleCount}</span>
            <span className="stat__note">
              {snapshot.nativeSource ? 'native samples' : 'browser samples'}
            </span>
          </div>
        </div>

        <section className="panel" aria-labelledby="sensor-heading">
          <div className="panel__head">
            <h2 id="sensor-heading">Motion sensors</h2>
            <StatusPill view={sensor} />
          </div>
          <p className="hint">{sensor.detail}</p>
          <div className="button-row">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void session.enableMotion()}
              disabled={snapshot.sensorState === 'ready'}
            >
              {snapshot.sensorState === 'ready' ? 'Motion enabled' : 'Enable motion'}
            </button>
          </div>
        </section>

        {snapshot.needsPairing || !snapshot.paired ? <PairingPanel snapshot={snapshot} /> : null}

        <CalibrationPanel snapshot={snapshot} />

        <section className="panel">
          <div className="panel__head">
            <h2>Live input</h2>
            <span className="badge">{snapshot.streaming ? 'streaming' : 'idle'}</span>
          </div>
          <SteeringMeter read={read} calibrated={snapshot.calibrated} steeringRange={38} />
          <PedalMeters read={read} calibrated={snapshot.calibrated} />
          <p className="hint">
            Shake the phone deliberately to trigger boost. Ordinary handling never triggers it —
            the detector needs {14} m/s² sustained for 90 ms and then waits 2 s.
          </p>
        </section>

        <div className="drive-button">
          <button
            type="button"
            className={`button button--drive ${snapshot.streaming ? 'is-active' : ''}`}
            onClick={() => session.toggleStreaming()}
            disabled={!snapshot.streaming && !canStart}
            aria-pressed={snapshot.streaming}
          >
            {snapshot.streaming ? 'Stop driving' : 'Start driving'}
          </button>
          <span className="hint" aria-live="polite">
            {snapshot.streaming
              ? 'Motion is live — steer by tilting.'
              : canStart
                ? 'Ready. Press start to send motion input to the game.'
                : 'Connect, enable motion sensors and calibrate to start.'}
          </span>
        </div>

        <DiagnosticsPanel snapshot={snapshot} />

        <footer className="footer">
          <p>
            Keep this tab in the foreground while driving. Phone in landscape is supported —
            steering stays “left is left”.
          </p>
        </footer>
      </main>
    </div>
  );
}
