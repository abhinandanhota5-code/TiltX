import type { ReactElement } from 'react';
import { useRef } from 'react';
import { LiveControl } from '../lib/session.js';
import { useRafLoop } from './useRafLoop.js';

interface SteeringMeterProps {
  read: () => LiveControl;
  calibrated: boolean;
  steeringRange: number;
}

/**
 * Steering indicator driven by requestAnimationFrame with direct style
 * mutation — no React renders while the player is tilting.
 */
export function SteeringMeter({ read, calibrated, steeringRange }: SteeringMeterProps): ReactElement {
  const needleRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const smoothed = useRef(0);

  useRafLoop(read, (live, elapsed) => {
    // Extra display smoothing only — the network value stays untouched.
    const alpha = Math.min(1, elapsed / 90);
    smoothed.current += (live.steering - smoothed.current) * alpha;
    const value = Math.max(-1, Math.min(1, smoothed.current));

    const needle = needleRef.current;
    if (needle) {
      needle.style.transform = `translateX(${(value * 50).toFixed(2)}%) rotate(${(value * 26).toFixed(2)}deg)`;
    }
    const bar = barRef.current;
    if (bar) {
      bar.style.width = `${Math.abs(value * 50).toFixed(2)}%`;
      bar.style.left = value >= 0 ? '50%' : `${(50 - Math.abs(value * 50)).toFixed(2)}%`;
      bar.style.background = value >= 0 ? 'var(--accent)' : 'var(--accent-alt)';
    }
    const label = valueRef.current;
    if (label) {
      const direction = value < -0.03 ? 'left' : value > 0.03 ? 'right' : 'centre';
      label.textContent = calibrated ? `${Math.round(Math.abs(value) * 100)}% ${direction}` : 'not calibrated';
    }
  });

  return (
    <section className="meter" aria-label="Steering indicator">
      <div className="meter__head">
        <h2>Steering</h2>
        <span className="meter__value" ref={valueRef}>
          {calibrated ? '0% centre' : 'not calibrated'}
        </span>
      </div>
      <div className="steer" aria-hidden="true">
        <div className="steer__track">
          <div className="steer__bar" ref={barRef} />
          <div className="steer__needle" ref={needleRef} />
        </div>
        <div className="steer__scale">
          <span>L</span>
          <span>0</span>
          <span>R</span>
        </div>
      </div>
      <p className="hint">Full lock at ≈{steeringRange}° of tilt either side.</p>
    </section>
  );
}
