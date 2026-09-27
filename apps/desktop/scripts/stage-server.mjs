// Produces the production server tree that gets bundled into the packaged
// desktop app (see electron-builder.yml `extraResources`):
//
//   build-resources/server-node_modules/   prod deps incl. better-sqlite3 prebuilds
//   build-resources/server-package.json    the prod manifest
//
// The tree MUST be fully self-contained real files. The desktop app is installed
// under /opt (deb), a random AppImage mount, or C:\Program Files, so any symlink
// escaping the tree (e.g. pnpm's default .pnpm store links) becomes a dangling
// link and `require('winston')` fails at launch. We force pnpm's `hoisted`
// node-linker (a flat, npm-style node_modules with no symlinks) and then assert
// nothing symlinked slipped through.
//
// Run before `electron-builder`. Safe to re-run; it wipes its own staging dir.

import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const out = join(root, 'build-resources');
const staging = join(out, '.staging-server');
const dest = join(out, 'server-node_modules');

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const prodPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  type: pkg.type,
  dependencies: pkg.dependencies ?? {},
};

writeFileSync(join(staging, 'package.json'), `${JSON.stringify(prodPkg, null, 2)}\n`);
cpSync(join(root, 'pnpm-lock.yaml'), join(staging, 'pnpm-lock.yaml'));

// --config.node-linker=hoisted: flat node_modules, no symlinks — portable.
// --ignore-scripts: better-sqlite3 loads from its shipped N-API prebuilds, no
// compile step needed (and MSVC isn't available on the Windows CI runner).
execSync(
  'pnpm install --prod --ignore-workspace --ignore-scripts --no-frozen-lockfile ' +
    '--config.node-linker=hoisted --config.symlink=false --config.confirmModulesPurge=false',
  { cwd: staging, stdio: 'inherit' },
);

rmSync(dest, { recursive: true, force: true });
cpSync(join(staging, 'node_modules'), dest, { recursive: true, dereference: true });
cpSync(join(staging, 'package.json'), join(out, 'server-package.json'));

// `.bin/` holds CLI shims (relative symlinks) the in-process server never runs.
// Drop it so the tree is symlink-free and a little smaller.
rmSync(join(dest, '.bin'), { recursive: true, force: true });

// Guard: a single escaping symlink here means a broken install on the user's
// machine that only surfaces as "Cannot find module ..." at first launch.
const symlinks = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      symlinks.push(relative(dest, full));
    } else if (entry.isDirectory()) {
      walk(full);
    }
  }
};
walk(dest);
if (symlinks.length > 0) {
  console.error(
    `\nstage-server: ${symlinks.length} symlink(s) in server-node_modules — bundle is not portable:\n  ` +
      symlinks.slice(0, 20).join('\n  '),
  );
  process.exit(1);
}

console.log('\nstaged prod server deps -> build-resources/server-node_modules (no symlinks)');
