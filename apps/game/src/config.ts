/** Build-time configuration for the game app. */

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_PAIRING_BASE_URL?: string;
}

function env(): ImportMetaEnv {
  return (import.meta as unknown as { env?: ImportMetaEnv }).env ?? {};
}

export interface GameConfig {
  /**
   * Absolute backend URL. Empty = connect to the page origin, which works
   * with the Vite dev proxy.
   */
  serverUrl: string;
  /**
   * Absolute base URL for the controller pairing link. Empty = derive from
   * the page origin (fine on localhost; set it to the LAN IP for phones).
   */
  pairingBaseUrl: string;
}

export function loadGameConfig(): GameConfig {
  const e = env();
  return {
    serverUrl: (e.VITE_SERVER_URL ?? '').trim(),
    pairingBaseUrl: (e.VITE_PAIRING_BASE_URL ?? '').trim(),
  };
}

/**
 * Optional explicit controller base URL (`VITE_PAIRING_BASE_URL`).
 *
 * The controller is a **separate app on its own port**, so the game's page
 * origin is never a valid pairing base. When this is empty the game sends no
 * base at all and the server fills in its auto-detected LAN address (see
 * `resolveControllerBaseUrl` in `@tiltx/shared`), which keeps the QR code
 * working after the laptop changes Wi-Fi.
 */
export function resolvePairingBase(config: GameConfig): string {
  return config.pairingBaseUrl.replace(/\/+$/, '');
}

export function pairingBaseIsLoopback(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
