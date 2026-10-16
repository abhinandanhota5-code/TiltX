import type { ReactElement } from 'react';
import { useRef } from 'react';
import { LiveControl } from '../lib/session.js';
import { useRafLoop } from './useRafLoop.js';

interface PedalMetersProps {
  read: () => LiveControl;
  calibrated: boolean;
}

/** Throttle/brake bars plus the boost cooldown ring, updated via rAF. */
export function PedalMeters({ read, calibrated }: PedalMetersProps): ReactElement {
  const throttleRef = useRef<HTMLDivElement>(null);
  const brakeRef = useRef<HTMLDivElement>(null);
  const throttleLabel = useRef<HTMLSpanElement>(null);
  const brakeLabel = useRef<HTMLSpanElement>(null);
  const boostRef = useRef<HTMLDivElement>(null);
  const boostLabel = useRef<HTMLSpanElement>(null);

  useRafLoop(read, (live) => {
    const throttle = calibrated ? live.throttle : 0;
    const brake = calibrated ? live.brake : 0;

    if (throttleRef.current) throttleRef.current.style.height = `${(throttle * 100).toFixed(1)}%`;
    if (brakeRef.current) brakeRef.current.style.height = `${(brake * 100).toFixed(1)}%`;
    if (throttleLabel.current) throttleLabel.current.textContent = `${Math.round(throttle * 100)}%`;
    if (brakeLabel.current) brakeLabel.current.textContent = `${Math.round(brake * 100)}%`;

    const boost = boostRef.current;
    if (boost) {
      const ready = live.boostCooldownMs <= 0;
      boost.style.opacity = ready ? '1' : '0.45';
      boost.dataset['state'] = live.boostActive ? 'active' : ready ? 'ready' : 'cooldown';
    }
    if (boostLabel.current) {
      boostLabel.current.textContent = live.boostActive
        ? 'BOOST!'
        : live.boostCooldownMs > 0
          ? `${(live.boostCooldownMs / 1000).toFixed(1)}s`
          : 'ready';
    }
  });

  return (
    <section className="pedals" aria-label="Throttle, brake and boost indicators">
      <div className="pedal">
        <div className="pedal__track">
          <div className="pedal__fill pedal__fill--throttle" ref={throttleRef} />
        </div>
        <div className="pedal__meta">
          <span className="pedal__name">Throttle</span>
          <span className="pedal__value" ref={throttleLabel}>
            0%
          </span>
        </div>
      </div>
      <div className="pedal">
        <div className="pedal__track">
          <div className="pedal__fill pedal__fill--brake" ref={brakeRef} />
        </div>
        <div className="pedal__meta">
          <span className="pedal__name">Brake</span>
          <span className="pedal__value" ref={brakeLabel}>
            0%
          </span>
        </div>
      </div>
      <div className="boost" ref={boostRef} data-state="ready">
        <span className="boost__title">Boost</span>
        <span className="boost__value" ref={boostLabel}>
          ready
        </span>
        <span className="boost__hint">shake</span>
      </div>
    </section>
  );
}
