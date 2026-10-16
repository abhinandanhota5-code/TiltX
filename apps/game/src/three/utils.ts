import { Vector3 } from 'three';
import { Vec2 } from '../sim/track.js';

export function toVector3(v: Vec2, y = 0): Vector3 {
  return new Vector3(v.x, y, v.z);
}
