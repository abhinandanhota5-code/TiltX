import type { MotionSample } from '@tiltx/shared';

export type SensorState =
  | 'unknown'
  | 'permission-required'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'insecure-context';

/**
 * One raw device-motion reading, in the units the shared sensor pipeline
 * expects: acceleration m/s² (including gravity) and rotation rate deg/s.
 */
export interface MotionReading extends MotionSample {
  /** Rotation rate in deg/s, when the platform provides it. */
  gyro?: { x: number; y: number; z: number };
  /** Sensor-reported interval in ms, when available. */
  interval?: number;
}

export interface MotionSourceEvents {
  reading: (reading: MotionReading) => void;
  state: (state: SensorState, message: string) => void;
}

export interface MotionSource {
  readonly kind: 'web' | 'capacitor';
  currentState(): { state: SensorState; message: string };
  /** Must be called from a user gesture on iOS. Returns the resulting state. */
  requestPermission(): Promise<SensorState>;
  start(): Promise<void>;
  stop(): void;
}

export function readOrientationDeg(): number {
  const screenRef = (window as unknown as { screen?: { orientation?: { angle?: number } } }).screen;
  if (screenRef?.orientation && typeof screenRef.orientation.angle === 'number') {
    return screenRef.orientation.angle;
  }
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' && legacy >= 0 ? legacy : 0;
}

export function isSecureContext(): boolean {
  return typeof window !== 'undefined' && (window.isSecureContext ?? false);
}

/** Browser DeviceMotion implementation. */
export class DeviceMotionSource implements MotionSource {
  readonly kind = 'web' as const;
  private state: SensorState = 'unknown';
  private message = '';
  private handler: ((event: DeviceMotionEvent) => void) | null = null;
  private firstReading: Promise<boolean> | null = null;
  private resolveFirstReading: (() => void) | null = null;

  constructor(private readonly emit: MotionSourceEvents) {
    if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') {
      this.state = 'unavailable';
      this.message =
        'This browser does not expose motion sensors. Use an Android device, or scan from the TiltX Android app.';
    } else if (!isSecureContext()) {
      this.state = 'insecure-context';
      this.message =
        'Motion sensors need a secure context (HTTPS or localhost). See the README for the Chrome LAN-origin flag or use the TiltX Android app.';
    } else if (
      typeof (DeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission ===
      'function'
    ) {
      this.state = 'permission-required';
      this.message = 'Tap “Enable motion” to allow access to the movement sensors.';
    }
  }

  currentState(): { state: SensorState; message: string } {
    return { state: this.state, message: this.message };
  }

  private setState(state: SensorState, message: string): void {
    this.state = state;
    this.message = message;
    this.emit.state(state, message);
  }

  async requestPermission(): Promise<SensorState> {
    if (this.state === 'unavailable' || this.state === 'insecure-context') return this.state;

    const requestPermission = (
      DeviceMotionEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
    ).requestPermission;

    if (typeof requestPermission === 'function') {
      try {
        const result = await requestPermission();
        if (result !== 'granted') {
          this.setState(
            'denied',
            'Motion access was denied. Re-enable it in the browser settings and tap again.',
          );
          return this.state;
        }
      } catch {
        this.setState('denied', 'Motion permission could not be requested. Try reloading the page.');
        return this.state;
      }
    }
    await this.start();
    return this.state;
  }

  async start(): Promise<void> {
    if (this.handler) return;
    if (this.state === 'unavailable' || this.state === 'insecure-context') return;

    this.handler = (event: DeviceMotionEvent) => {
      const accel = event.accelerationIncludingGravity;
      if (!accel || accel.x === null || accel.y === null || accel.z === null) return;
      const rotation = event.rotationRate;
      const reading: MotionReading = {
        t: performance.now(),
        acceleration: { x: accel.x, y: accel.y, z: accel.z },
        orientation: readOrientationDeg(),
      };
      if (rotation && (rotation.alpha !== null || rotation.beta !== null || rotation.gamma !== null)) {
        reading.gyro = {
          x: rotation.alpha ?? 0,
          y: rotation.beta ?? 0,
          z: rotation.gamma ?? 0,
        };
      }
      if (typeof event.interval === 'number' && event.interval > 0) {
        reading.interval = event.interval * 1000;
      }
      this.resolveFirstReading?.();
      this.resolveFirstReading = null;
      this.emit.reading(reading);
    };

    this.firstReading = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      this.resolveFirstReading = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });

    window.addEventListener('devicemotion', this.handler, { passive: true });

    const sawReading = await this.firstReading;
    if (sawReading) {
      this.setState('ready', 'Motion sensors are streaming real data.');
    } else if (this.state !== 'denied') {
      this.setState(
        'unavailable',
        'No motion events arrived. This device or browser does not appear to have usable motion sensors.',
      );
    }
  }

  stop(): void {
    if (this.handler) {
      window.removeEventListener('devicemotion', this.handler);
      this.handler = null;
    }
    this.resolveFirstReading?.();
    this.resolveFirstReading = null;
  }
}

/**
 * Capacitor native sensors (@capacitor/motion). Used automatically inside the
 * packaged Android app, where the browser DeviceMotion API may be unavailable
 * or blocked by cleartext-origin restrictions.
 */
export class CapacitorMotionSource implements MotionSource {
  readonly kind = 'capacitor' as const;
  private state: SensorState = 'unknown';
  private message = '';
  private removeAccel: (() => void) | null = null;
  private started = false;

  constructor(private readonly emit: MotionSourceEvents) {
    this.state = 'permission-required';
    this.message = 'Tap “Enable motion” to read the phone’s sensors.';
  }

  currentState(): { state: SensorState; message: string } {
    return { state: this.state, message: this.message };
  }

  private setState(state: SensorState, message: string): void {
    this.state = state;
    this.message = message;
    this.emit.state(state, message);
  }

  async requestPermission(): Promise<SensorState> {
    await this.start();
    return this.state;
  }

  async start(): Promise<void> {
    if (this.started) return;
    try {
      const { Motion } = await import('@capacitor/motion');
      const listener = await Motion.addListener('accel', (event) => {
        const accel = event.accelerationIncludingGravity;
        if (!accel || accel.x === null || accel.y === null || accel.z === null) return;
        const rotation = event.rotationRate;
        const reading: MotionReading = {
          t: performance.now(),
          acceleration: { x: accel.x, y: accel.y, z: accel.z },
          orientation: readOrientationDeg(),
        };
        if (rotation && rotation.alpha !== null) {
          reading.gyro = {
            x: rotation.alpha ?? 0,
            y: rotation.beta ?? 0,
            z: rotation.gamma ?? 0,
          };
        }
        if (typeof event.interval === 'number' && event.interval > 0) {
          reading.interval = event.interval * 1000;
        }
        this.started = true;
        this.setState('ready', 'Native motion sensors are streaming real data.');
        this.emit.reading(reading);
      });
      this.removeAccel = () => void listener.remove();
      // Android delivers events quickly; if nothing arrives we surface it.
      setTimeout(() => {
        if (!this.started) {
          this.setState(
            'unavailable',
            'The native sensor stream did not start. Check that this device has motion sensors.',
          );
        }
      }, 2500);
    } catch (error) {
      this.setState(
        'unavailable',
        `Native motion sensors are unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  stop(): void {
    this.removeAccel?.();
    this.removeAccel = null;
    this.started = false;
  }
}

export interface MotionSourceFactoryOptions {
  /** Whether the Capacitor runtime reports a native platform. */
  isNativePlatform: boolean;
}

export function createMotionSource(
  emit: MotionSourceEvents,
  options: MotionSourceFactoryOptions,
): MotionSource {
  return options.isNativePlatform ? new CapacitorMotionSource(emit) : new DeviceMotionSource(emit);
}
