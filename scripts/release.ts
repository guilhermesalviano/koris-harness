import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const PACKAGE_JSON_PATH = join(ROOT, 'package.json');
const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md');

type BumpType = 'patch' | 'minor' | 'major';

const EMPTY_UNRELEASED = `## [Unreleased]

### Added

### Changed

### Fixed

### Removed
`;

function usage(): never {
  console.error(`Usage: pnpm release <patch|minor|major> [--date YYYY-MM-DD]

Bumps package.json, moves [Unreleased] entries in CHANGELOG.md into a new version section, and resets [Unreleased].

Examples:
  pnpm release patch
  pnpm release minor --date 2026-09-01`);
  process.exit(1);
}

function parseArgs(argv: string[]): { bump: BumpType; date: string } {
  const bump = argv[0] as BumpType | undefined;
  if (!bump || !['patch', 'minor', 'major'].includes(bump)) {
    usage();
  }

  let date = new Date().toISOString().slice(0, 10);
  const dateFlagIndex = argv.indexOf('--date');
  if (dateFlagIndex !== -1) {
    const value = argv[dateFlagIndex + 1];
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      console.error('Invalid --date value. Expected YYYY-MM-DD.');
      process.exit(1);
    }
    date = value;
  }

  return { bump: bump as BumpType, date };
}

function bumpVersion(current: string, type: BumpType): string {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver in package.json: ${current}`);
  }

  const [major, minor, patch] = parts;
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function splitUnreleased(content: string): { before: string; unreleasedBody: string; after: string } {
  const marker = '## [Unreleased]';
  const start = content.indexOf(marker);
  if (start === -1) {
    throw new Error('CHANGELOG.md is missing a ## [Unreleased] section.');
  }

  const afterMarker = start + marker.length;
  const nextHeading = content.indexOf('\n## [', afterMarker);
  const unreleasedEnd = nextHeading === -1 ? content.length : nextHeading;
  const unreleasedBody = content.slice(afterMarker, unreleasedEnd).trim();

  const before = content.slice(0, start);
  const after = nextHeading === -1 ? '' : content.slice(nextHeading + 1);

  return { before, unreleasedBody, after };
}

function hasReleaseNotes(body: string): boolean {
  return body
    .split('\n')
    .some((line) => line.trim().startsWith('- '));
}

function buildReleasedSection(version: string, date: string, body: string): string {
  const notes = body.trim();
  const block = notes ? `${notes}\n\n` : '';
  return `## [${version}] - ${date}\n\n${block}`;
}

function main(): void {
  const { bump, date } = parseArgs(process.argv.slice(2));

  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as { version?: string };
  const currentVersion = packageJson.version;
  if (typeof currentVersion !== 'string') {
    throw new Error('package.json is missing a version field.');
  }

  const nextVersion = bumpVersion(currentVersion, bump);
  const changelog = readFileSync(CHANGELOG_PATH, 'utf-8');
  const { before, unreleasedBody, after } = splitUnreleased(changelog);

  if (!hasReleaseNotes(unreleasedBody)) {
    console.warn('[release] [Unreleased] has no bullet entries. The new version section will be empty.');
  }

  const releasedSection = buildReleasedSection(
    nextVersion,
    date,
    hasReleaseNotes(unreleasedBody) ? unreleasedBody : '',
  );
  const updatedChangelog = `${before}${EMPTY_UNRELEASED}\n\n${releasedSection}${after}`.replace(/\n{3,}/g, '\n\n');

  packageJson.version = nextVersion;
  writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
  writeFileSync(CHANGELOG_PATH, updatedChangelog.endsWith('\n') ? updatedChangelog : `${updatedChangelog}\n`, 'utf-8');

  console.log(`Released ${nextVersion} (${bump} bump from ${currentVersion}).`);
  console.log(`Updated ${PACKAGE_JSON_PATH}`);
  console.log(`Updated ${CHANGELOG_PATH}`);
  console.log('Review the changes, fill in any missing notes if needed, then commit and tag.');
}

main();
