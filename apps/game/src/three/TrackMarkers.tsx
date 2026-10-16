import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { Track } from '../sim/track.js';
import { toVector3 } from './utils.js';

interface TrackMarkersProps {
  track: Track;
}

export function TrackMarkers({ track }: TrackMarkersProps): ReactElement {
  const start = useMemo(() => {
    const s = track.segments[0];
    if (!s) return null;
    const p = s.a;
    const mid = { x: p.x + s.normal.x * track.halfWidth, z: p.z + s.normal.z * track.halfWidth };
    return { p, mid, normal: s.normal };
  }, [track]);

  if (!start) return <></>;
  const lineP1 = toVector3({ x: start.p.x - start.normal.x * (track.halfWidth + 1), z: start.p.z - start.normal.z * (track.halfWidth + 1) }, 0.05);
  const lineP2 = toVector3({ x: start.p.x + start.normal.x * (track.halfWidth + 1), z: start.p.z + start.normal.z * (track.halfWidth + 1) }, 0.05);

  return (
    <group>
      <mesh position={toVector3(start.mid, 0.06)} rotation-y={Math.atan2(start.normal.x, start.normal.z)}>
        <planeGeometry args={[track.halfWidth * 2, 1.2]} />
        <meshBasicMaterial color="#34d399" transparent opacity={0.35} />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([lineP1.x, lineP1.y, lineP1.z, lineP2.x, lineP2.y, lineP2.z]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#fbbf24" linewidth={2} />
      </line>
    </group>
  );
}
