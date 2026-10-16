import type { ReactElement } from 'react';
import { useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { Track } from '../sim/track.js';
import { toVector3 } from './utils.js';

interface TrackMeshProps {
  track: Track;
}

export function TrackMesh({ track }: TrackMeshProps): ReactElement {
  const geometry = useMemo(() => {
    const width = track.halfWidth * 2;
    const points = track.points;
    const n = points.length;
    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (let i = 0; i < n; i++) {
      const p = points[i];
      const next = points[(i + 1) % n];
      const tangent = { x: next.x - p.x, z: next.z - p.z };
      const length = Math.hypot(tangent.x, tangent.z) || 1;
      const tan = { x: tangent.x / length, z: tangent.z / length };
      const normal = { x: -tan.z, z: tan.x };
      const left = toVector3({ x: p.x + normal.x * track.halfWidth, z: p.z + normal.z * track.halfWidth }, 0.02);
      const right = toVector3({ x: p.x - normal.x * track.halfWidth, z: p.z - normal.z * track.halfWidth }, 0.02);
      const offset = i * 2;
      vertices.push(left.x, left.y, left.z);
      vertices.push(right.x, right.y, right.z);
      normals.push(0, 1, 0);
      normals.push(0, 1, 0);
      uvs.push(i / n, 0);
      uvs.push(i / n, 1);
      if (i > 0) {
        const o = (i - 1) * 2;
        indices.push(o, o + 1, offset);
        indices.push(o + 1, offset + 1, offset);
      }
    }
    // close
    const oLast = (n - 1) * 2;
    indices.push(oLast, oLast + 1, 0);
    indices.push(oLast + 1, 1, 0);

    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geom.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    return geom;
  }, [track]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#1a1f2a" roughness={0.95} metalness={0} />
    </mesh>
  );
}
