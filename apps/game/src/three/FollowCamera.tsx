import type { ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Group } from 'three';
import { VehicleState } from '../sim/vehicle.js';
import { toVector3 } from './utils.js';

interface FollowCameraProps {
  getVehicle: () => VehicleState;
}

export function FollowCamera({ getVehicle }: FollowCameraProps): ReactElement {
  const cam = useRef<Group>(null);

  useFrame((state) => {
    if (!cam.current) return;
    const vehicle = getVehicle();
    const forward = { x: Math.sin(vehicle.heading), z: Math.cos(vehicle.heading) };
    const targetPos = toVector3(
      { x: vehicle.position.x - forward.x * 9, z: vehicle.position.z - forward.z * 9 },
      3.5,
    );
    const lookAt = toVector3(vehicle.position, 0.8);
    cam.current.position.lerp(targetPos, 0.08);
    state.camera.position.copy(cam.current.position);
    state.camera.lookAt(lookAt);
  });

  return <group ref={cam} />;
}
