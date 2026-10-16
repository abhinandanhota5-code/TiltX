import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android shell for the motion controller.
 *
 * The app loads the built web bundle from `dist` and talks to the TiltX
 * backend over the LAN. Because the backend address depends on the laptop's
 * IP on the current network, it is entered at runtime in the app's
 * "Server settings" panel (persisted in localStorage) rather than baked in
 * here — see the README for the full pairing walkthrough.
 */
const config: CapacitorConfig = {
  appId: 'dev.tiltx.controller',
  appName: 'TiltX Controller',
  webDir: 'dist',
  android: {
    // The controller needs a plain-HTTP LAN address for the backend; the
    // App manifest sets usesCleartextTraffic for the same reason. Sensors come
    // from the WebView: @capacitor/motion v7 is a wrapper over devicemotion,
    // and `server.androidScheme: 'https'` gives us the secure context it needs.
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
