# `apps/desktop/build/` — electron-builder build resources

`electron-builder.yml` points `directories.buildResources` here.

## App icon

`icon.png` (1024×1024) is the master icon. electron-builder derives the macOS
`.icns` and Windows `.ico` from it at package time; Linux uses the PNG directly.

It's **generated** from `apps/web/public/logo.png` by
`apps/desktop/scripts/make-icons.mjs` (run via `pnpm desktop:icons`, and
automatically inside `pnpm desktop:package` / `:dir` and the release workflow).
The generator is a no-op when `icon.png` is already newer than the source logo.

The current `icon.png` is an **upscale of the 128×128 logo** — soft placeholder
art. To replace it: drop a real ≥1024×1024 image at `apps/web/public/logo.png`
(or overwrite `icon.png` directly) and re-run `pnpm desktop:icons`.

## macOS signing

`entitlements.mac.plist` holds the hardened-runtime entitlements for the
signed/notarized build. It's inert until signing is activated — see
`apps/desktop/features/packaging.md`.

## Tray icon

A tray template icon (`trayTemplate.png` / `@2x`) will also live here once
`features/tray.ts` is implemented.
