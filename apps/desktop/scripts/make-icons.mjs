// Generates apps/desktop/build/icon.png (1024x1024) from the web logo.
//
// electron-builder needs a >=512px master PNG in buildResources/ to derive the
// macOS .icns and Windows .ico at package time. The repo logo
// (apps/web/public/logo.png) is only 128x128, so this upscales it. The result is
// a soft placeholder — replace apps/web/public/logo.png (or build/icon.png
// directly) with real >=1024px art when it exists.
//
// No-op when build/icon.png is already newer than the source logo, so it's cheap
// to call from CI and the desktop:package* scripts.

import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appDir, '..', '..');

const source = resolve(repoRoot, 'apps/web/public/logo.png');
const output = resolve(appDir, 'build/icon.png');
const SIZE = 1024;

function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

const outMtime = mtime(output);
const srcMtime = mtime(source);
if (srcMtime == null) {
  console.error(`make-icons: source logo not found at ${source}`);
  process.exit(1);
}
if (outMtime != null && outMtime >= srcMtime) {
  console.log(`make-icons: ${output} is up to date, skipping`);
  process.exit(0);
}

const image = await Jimp.read(source);
// Square source (the logo is 128x128); contain keeps aspect + transparent pad
// if that ever changes.
image.contain({ w: SIZE, h: SIZE });
await image.write(output);
console.log(`make-icons: wrote ${output} (${SIZE}x${SIZE})`);
