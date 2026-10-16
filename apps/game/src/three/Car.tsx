import type { ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Group } from 'three';
import { VehicleState } from '../sim/vehicle.js';
import { toVector3 } from './utils.js';

interface CarProps {
  getVehicle: () => VehicleState;
}

export function Car({ getVehicle }: CarProps): ReactElement {
  const group = useRef<Group>(null);

  useFrame(() => {
    if (!group.current) return;
    const vehicle = getVehicle();
    group.current.position.copy(toVector3(vehicle.position, 0.55));
    group.current.rotation.y = vehicle.heading;
  });

  return (
    <group ref={group}>
      <mesh>
        <boxGeometry args={[1.2, 0.4, 2.2]} />
        <meshStandardMaterial color="#60a5fa" metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.4, -0.3]}>
        <boxGeometry args={[1.0, 0.3, 0.8]} />
        <meshStandardMaterial color="#1f2937" metalness={0} roughness={0.9} />
      </mesh>
    </group>
  );
}
