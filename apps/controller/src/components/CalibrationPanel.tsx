import type { ReactElement } from 'react';
import { useState } from 'react';
import { ControllerSnapshot } from '../lib/session.js';
import { useSession } from '../sessionContext.js';

interface CalibrationPanelProps {
  snapshot: ControllerSnapshot;
}

export function CalibrationPanel({ snapshot }: CalibrationPanelProps): ReactElement {
  const session = useSession();
  const [showTuning, setShowTuning] = useState(false);

  const disabled = snapshot.sensorState !== 'ready';

  return (
    <section className="panel panel--calibration" aria-labelledby="calibration-heading">
      <div className="panel__head">
        <h2 id="calibration-heading">Calibration</h2>
        <span className={`badge badge--${snapshot.calibrated ? 'good' : 'warn'}`}>
          {snapshot.calibrated ? 'calibrated' : 'not calibrated'}
        </span>
      </div>

      <p className="hint">
        Hold the phone the way you will hold it while driving, then tap to capture the neutral
        position. Steering and pedals are measured relative to this pose.
      </p>

      {snapshot.calibrating ? (
        <div className="calibration-progress" role="status" aria-live="polite">
          <div
            className="calibration-progress__bar"
            style={{ width: `${Math.round(snapshot.calibrationProgress * 100)}%` }}
          />
          <span>{Math.round(snapshot.calibrationProgress * 100)}% — keep still</span>
        </div>
      ) : null}

      <div className="button-row">
        <button
          type="button"
          className="button button--primary button--large"
          onClick={() => (snapshot.calibrating ? session.cancelCalibration() : session.beginCalibration())}
          disabled={disabled && !snapshot.calibrating}
          aria-describedby={disabled ? 'calibration-disabled-reason' : undefined}
        >
          {snapshot.calibrating ? 'Cancel' : snapshot.calibrated ? 'Recalibrate' : 'Calibrate'}
        </button>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => session.resetCalibration()}
          disabled={!snapshot.calibrated}
        >
          Clear
        </button>
      </div>

      {disabled && !snapshot.calibrating ? (
        <p id="calibration-disabled-reason" className="hint hint--warn">
          Calibration needs live motion sensors. Enable them above first.
        </p>
      ) : null}

      {snapshot.calibrationMessage ? (
        <p className={`notice notice--${snapshot.calibrated ? 'good' : 'warn'}`} role="status">
          {snapshot.calibrationMessage}
        </p>
      ) : null}

      <button
        type="button"
        className="link-button"
        aria-expanded={showTuning}
        onClick={() => setShowTuning((value) => !value)}
      >
        {showTuning ? 'Hide fine tuning' : 'Fine tuning'}
      </button>

      {showTuning ? (
        <div className="tuning">
          <label className="slider">
            <span>
              Steering sensitivity <strong>{snapshot.sensitivity.toFixed(2)}×</strong>
            </span>
            <input
              type="range"
              min={0.4}
              max={2.5}
              step={0.05}
              value={snapshot.sensitivity}
              onChange={(event) => session.setSensitivity(Number(event.target.value))}
            />
          </label>
          <label className="slider">
            <span>
              Motion smoothing <strong>{Math.round(snapshot.smoothing * 100)}%</strong>
            </span>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={snapshot.smoothing}
              onChange={(event) => session.setSmoothing(Number(event.target.value))}
            />
          </label>
          <label className="slider">
            <span>
              Update rate <strong>{snapshot.inputHz} Hz</strong>
            </span>
            <input
              type="range"
              min={20}
              max={60}
              step={5}
              value={snapshot.inputHz}
              onChange={(event) => session.setInputHz(Number(event.target.value))}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={snapshot.invertPitch}
              onChange={(event) => session.setInvertPitch(event.target.checked)}
            />
            <span>Invert forward / backward tilt</span>
          </label>
        </div>
      ) : null}
    </section>
  );
}
