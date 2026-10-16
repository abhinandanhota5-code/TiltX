import type { ReactElement } from 'react';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { Track } from '../sim/track.js';
import { VehicleState } from '../sim/vehicle.js';
import { Car } from './Car.js';
import { FollowCamera } from './FollowCamera.js';
import { TrackMarkers } from './TrackMarkers.js';
import { TrackMesh } from './TrackMesh.js';

interface SceneProps {
  track: Track;
  getVehicle: () => VehicleState;
}

export function Scene({ track, getVehicle }: SceneProps): ReactElement {
  return (
    <Canvas dpr={[1, 2]} shadows>
      <Suspense fallback={null}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[6, 10, -8]} intensity={0.9} castShadow />
        <FollowCamera getVehicle={getVehicle} />
        <TrackMesh track={track} />
        <TrackMarkers track={track} />
        <Car getVehicle={getVehicle} />
        <gridHelper args={[400, 40, '#1a2233', '#141925']} position={[0, -0.01, 0]} />
      </Suspense>
    </Canvas>
  );
}
