# Contributing to Koris Assistant

Thanks for taking the time to contribute!

## Getting started

1. Fork and clone the repo.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Copy the example settings and adjust as needed:
   ```bash
   cp koris.example.json koris.json
   ```
4. Build before running the agent:
   ```bash
   pnpm build
   pnpm app
   ```

See [`README.md`](./README.md) for all available scripts and [`AGENTS.md`](./AGENTS.md) for the architecture.

## Branching & commits

- Branch off `main` using `<type>/<short-description>`, e.g. `feat/wpp-send-messages`, `fix/gh-pages-permissions`, `refactor/menu-in-web`, `chore/koris-assistant`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `chore:`, etc.

## Before opening a pull request

Pull requests to `main` or `develop` run the `Lint` and `Tests` CI workflows, so make sure these pass locally first:

```bash
pnpm lint          # server type-check
pnpm lint:client   # web frontend type-check
pnpm test          # full Vitest suite
```

Update [`CHANGELOG.md`](./CHANGELOG.md) under `[Unreleased]` for user-facing changes, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Reporting bugs / requesting features

Open an issue on [GitHub Issues](https://github.com/guilhermesalviano/koris/issues). For security vulnerabilities, see [`SECURITY.md`](./SECURITY.md) instead.
