/**
 * Makes `npm run android:init` idempotent.
 *
 * - Creates the Capacitor Android platform only when it is missing
 *   (`cap add android` exits fatally if the platform already exists).
 * - Ensures the cleartext flag stays on the app manifest. The APK talks to the
 *   backend over plain HTTP on a LAN IP; API 28+ blocks that by default, which
 *   would break pairing with `ERR_CLEARTEXT_NOT_PERMITTED`. Re-running
 *   `cap add android` regenerates the manifest, so we re-apply it every time.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const controllerDir = join(root, 'apps', 'controller');
const platformDir = join(controllerDir, 'android');
const manifestPath = join(platformDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const CLEARTEXT = 'android:usesCleartextTraffic="true"';

if (!existsSync(platformDir)) {
  console.log('Adding Capacitor Android platform…');
  const added = spawnSync('npx', ['cap', 'add', 'android'], {
    cwd: controllerDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (added.status !== 0) {
    process.exit(added.status ?? 1);
  }
} else {
  console.log('Android platform already present — skipping `cap add android`.');
}

if (existsSync(manifestPath)) {
  const xml = readFileSync(manifestPath, 'utf8');
  if (xml.includes(CLEARTEXT)) {
    console.log('Manifest already permits cleartext LAN HTTP.');
  } else {
    writeFileSync(
      manifestPath,
      xml.replace(/(<application\b[^>]*?\bandroid:allowBackup="true")/, `$1\n        ${CLEARTEXT}`),
      'utf8',
    );
    console.log('Manifest patched to allow cleartext LAN HTTP.');
  }
} else {
  console.error(`AndroidManifest.xml not found at ${manifestPath}`);
  process.exit(1);
}
