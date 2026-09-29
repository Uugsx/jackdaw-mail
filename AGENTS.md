# Instructions for AI agents (Cursor, etc.)

## Before changing desktop releases or auto-update

**Required reading:** [docs/systems/desktop-build/ota-jackdaw.md](docs/systems/desktop-build/ota-jackdaw.md)

Jackdaw Mail OTA is **not** stock electron-builder only. It includes:

- Private GitHub Releases + `JACKDAW_GH_UPDATE_TOKEN` (optional on public repo)
- CI job `prepare` that must create the release **before** parallel Mac/Windows publish
- **Mac:** DMG download + quit-then-install script (no Apple Developer signing on prerelease)
- **Windows:** standard `electron-updater` + `latest.yml`

Do **not** revert to parallel publish without the `prepare` release shell (causes duplicate releases and broken Windows OTA).

## Other build docs

- [docs/systems/desktop-build/overview.md](docs/systems/desktop-build/overview.md)
- [docs/systems/desktop-build/electron-builder.md](docs/systems/desktop-build/electron-builder.md)
- [docs/INSTALL.md](docs/INSTALL.md)

## Local desktop app verification

After frontend or desktop changes, rebuild the local macOS ARM64 application for manual verification. The expected artifact is:

`/Users/ng/Documents/antigravity/Jackdaw/desktop/dist/mac-arm64/Jackdaw Mail.app/`

Use the local directory build; do not report only `app/dist` as the application build. From `desktop/`, run `rtk npm run build`, then package the ARM64 app with `rtk npx electron-builder --mac --arm64 --dir --config`.

## Repo layout (desktop)

- `app/` — Svelte UI + shared logic (including Settings → About updater UI)
- `desktop/backend/backend.ts` — Electron main-side backend, JPC, OTA
- `desktop/src/main/index.ts` — window lifecycle, updater on startup
- `.github/workflows/publish-desktop-jackdaw.yml` — OTA CI

## Secrets (never commit)

- `JACKDAW_GH_UPDATE_TOKEN` — optional GitHub Actions secret; was baked into installers when repo was private

## Компьютерное зрение и UI-проверки

- Выполнять компьютерные проверки в фоне и не забирать фокус у пользователя.
- Не активировать, не разворачивать и не переключать окна поверх текущего приложения пользователя.
- Перед любым UI-действием убедиться, что оно не прервёт работу пользователя; если безопасный фоновый режим недоступен, остановиться и предупредить пользователя.
