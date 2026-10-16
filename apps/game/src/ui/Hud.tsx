import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { GameSnapshot } from '../lib/types.js';
import { RaceState } from '../sim/race.js';

interface HudProps {
  race: RaceState;
  snapshot: GameSnapshot;
}

function formatMs(ms: number): string {
  const total = Math.max(0, ms);
  const seconds = Math.floor(total / 1000);
  const frac = Math.floor((total % 1000) / 10);
  return `${seconds}.${frac.toString().padStart(2, '0')}`;
}

export function Hud({ race, snapshot }: HudProps): ReactElement {
  const speedKmh = useMemo(() => Math.round(race.vehicle.speed * 3.6), [race.vehicle.speed]);
  const currentLap = formatMs(race.currentLapMs);
  const lastLap = race.lastLapMs === null ? '—' : formatMs(race.lastLapMs);
  const bestLap = race.bestLapMs === null ? '—' : formatMs(race.bestLapMs);
  const rtt = snapshot.rttMs === null ? '—' : `${Math.round(snapshot.rttMs)} ms`;
  const inputHz = snapshot.inputHz;
  const status = snapshot.controllerConnected ? (snapshot.controllerReady ? 'ready' : snapshot.controllerCalibrated ? 'calibrated' : 'connected') : 'waiting';

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="card">
          <span className="label">Speed</span>
          <span className="value">{speedKmh}</span>
          <span className="unit">km/h</span>
        </div>
        <div className="card card--wide">
          <span className="label">Laps</span>
          <span className="big">{race.laps}</span>
          <span className="note">{race.started ? 'running' : 'awaiting crossing'}</span>
        </div>
        <div className="card">
          <span className="label">Room</span>
          <span className="mono">{snapshot.roomCode ?? '—'}</span>
          <span className="note">RTT {rtt}</span>
        </div>
      </div>
      <div className="hud-bottom">
        <div className="card">
          <span className="label">Current lap</span>
          <span className="small">{currentLap}</span>
        </div>
        <div className="card">
          <span className="label">Last lap</span>
          <span className="small">{lastLap}</span>
        </div>
        <div className="card">
          <span className="label">Best lap</span>
          <span className="small">{bestLap}</span>
        </div>
        <div className="card">
          <span className="label">Input</span>
          <span className="small">{inputHz} Hz</span>
        </div>
        <div className="card">
          <span className="label">Controller</span>
          <span className="small">{status}</span>
        </div>
      </div>
    </div>
  );
}
