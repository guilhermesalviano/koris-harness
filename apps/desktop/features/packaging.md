# Packaging & installers — IMPLEMENTED (unsigned)

`electron-builder.yml` (repo root) + `apps/desktop/scripts/` produce installers, and
`.github/workflows/release-desktop.yml` attaches them to GitHub Releases.

## Local

```bash
pnpm desktop:package        # host-OS installers -> dist-desktop-out/
pnpm desktop:package:dir     # unpacked app only (fast sanity check)
```

`package-desktop.mjs` runs `electron-builder` with `cwd = apps/desktop/` (so it reads
`apps/desktop/package.json`, not the repo-root `"/koris"` package which electron-builder
rejects), injecting `-c.extraMetadata.version` from the repo-root `package.json` and
`-c.electronVersion` from the installed Electron.

## CI → GitHub Releases

`release-desktop.yml` triggers on a Release being **published** (or `workflow_dispatch`
with a tag). Matrix:

| runner | output |
| --- | --- |
| `ubuntu-latest` | `.AppImage`, `.deb` |
| `windows-latest` | `.exe` (NSIS) |
| `macos-14` | `.dmg` (arm64) |

Each job: `pnpm build` → `pnpm build:desktop` → `pnpm desktop:stage` →
`package-desktop.mjs --publish never` (version from the release tag via
`KORIS_RELEASE_VERSION`) → `gh release upload <tag> --clobber` attaches the installers to
the triggering release (auth via the default `GITHUB_TOKEN`).

Release flow: `pnpm release <bump>` → review → commit → `git tag vX.Y.Z` →
`git push --follow-tags` → publish the Release for that tag (GitHub UI or
`gh release create vX.Y.Z --generate-notes`).

## App icons — DONE (placeholder art)

`apps/desktop/build/icon.png` (1024×1024) is generated from `apps/web/public/logo.png` by
`apps/desktop/scripts/make-icons.mjs` (`pnpm desktop:icons`, also run inside
`desktop:package` / `:dir` and the release workflow). electron-builder derives the macOS
`.icns` and Windows `.ico` from it. The current image is an **upscale of the 128px logo** —
replace `apps/web/public/logo.png` with real ≥1024px art and re-run `pnpm desktop:icons`.

## Code signing / notarization — HOOKS IN PLACE, NOT ACTIVE

Builds are still unsigned (`mac.identity: null` forces electron-builder to skip signing).
Users get "unidentified developer" / SmartScreen warnings. Everything else is wired:
`electron-builder.yml` has the `mac` hardened-runtime / entitlements keys and
`apps/desktop/build/entitlements.mac.plist` exists; `release-desktop.yml` already forwards
the signing env vars (empty until the secrets are set).

To activate:

- **macOS:** add repo secrets `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, and for
  notarization `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; then in
  `electron-builder.yml` remove `mac.identity: null` and set `mac.notarize: true`.
- **Windows:** add repo secrets `CSC_LINK` / `CSC_KEY_PASSWORD` (or an Azure Trusted
  Signing / cloud HSM setup). electron-builder picks these up automatically — no yml change.

## Still TODO

### Auto-update
`features/auto-update.ts` is still a stub; once installers are signed, wire `electron-updater`
against the same GitHub Releases feed (`publish` block is already `provider: github`).
