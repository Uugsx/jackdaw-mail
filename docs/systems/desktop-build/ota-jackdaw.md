# Jackdaw Mail desktop OTA (Over-The-Air updates)

Runbook for **automatic updates** of the Jackdaw Mail Electron desktop app via **GitHub Releases** (public repo `Uugsx/jackdaw-mail`).

**Read this file before changing OTA, CI publish, or updater UI.**

Related generic docs: [electron-builder.md](./electron-builder.md), [macos.md](./macos.md), [windows.md](./windows.md).

---

## Overview

| Piece | Role |
|-------|------|
| **CI** | `.github/workflows/publish-desktop-jackdaw.yml` — builds Mac and/or Windows, one prerelease |
| **Version** | `0.9.41-dev.<UTC timestamp>` — suffix from job `prepare` (`OTA_BUILD_SUFFIX`) |
| **Updater backend** | `desktop/backend/backend.ts` — `electron-updater`, auth, platform-specific install |
| **Updater UI** | `app/frontend/Settings/About/Update.svelte`, `About.svelte` |
| **Main process** | `desktop/src/main/index.ts` — startup check, quit-for-update |
| **Builder config** | `desktop/electron-builder.yml` — `publish`, `extraResources`, Mac targets |
| **Branding / token** | `app/build/jackdaw-brand.sh` — version bump, `gh-update-token.txt` |

Push to `main` builds **both** platforms. Manual **workflow_dispatch** can choose `platform: mac | windows | both`.

Пользовательское имя продукта и GitHub-репозиторий — **Jackdaw Mail** / `jackdaw-mail`. При этом `app.jackdaw.client` и внутреннее имя каталога данных `Jackdaw` сохраняются намеренно: это удерживает существующие настройки, локальную почту и совместимость обновлений при переименовании.

---

## CI pipeline (do not break)

Перед `prepare` выполняется `checks` из `check-desktop.yml`: регрессионные тесты
файлов, OAuth и OWA, а также сборки frontend и desktop. При их ошибке релиз
и тег не создаются. Этот же workflow запускается для pull request.

```
prepare  →  mac  ║  windows  →  carry-forward?  →  finalize
  │            │       │
  │            └─ upload assets to ONE prerelease
  └─ tag + empty GitHub prerelease (required!)
```

### Platform-independent OTA (`latest.yml` vs `latest-mac.yml`)

`electron-updater` reads **separate manifests per OS**. Windows and macOS can ship at **different version numbers** without forcing empty updates on the other platform.

| Manifest | OS |
|----------|-----|
| `latest.yml` | Windows |
| `latest-mac.yml` | macOS |

**workflow_dispatch → platform:**

| Input | Builds | Other OS |
|-------|--------|----------|
| `both` (default) | Mac + Windows | — |
| `mac` | Mac only | Windows assets copied from previous release (`ota-carry-forward.sh`) |
| `windows` | Windows only | Mac assets copied from previous release |

Carry-forward copies the **previous** prerelease’s `latest*.yml` and installers for the skipped platform into the **new** release. The skipped OS keeps its old version in metadata → **no pointless update prompt**.

Example after a Windows-only fix:

- `latest.yml` → `0.9.41-dev.NEW` (Windows users update)
- `latest-mac.yml` → still `0.9.41-dev.OLD` (Mac users stay put)

**Push to `main` always builds both** — use manual dispatch for single-OS releases.

### Job `prepare` (ubuntu)

1. `OTA_BUILD_SUFFIX=$(date -u +%Y%m%d%H%M%S)`
2. Tag: `v0.9.41-dev.${OTA_BUILD_SUFFIX}` on current commit
3. **Delete** existing release with that tag (if any)
4. **`gh release create`** empty prerelease

**Why:** If Mac and Windows both call `electron-builder --publish always` without an existing release, they race and create **two releases with the same tag** — Mac-only (`.dmg`, `latest-mac.yml`) and Windows-only (`setup.exe`, `latest.yml`). Updaters then fail with “not configured” or 404.

### Jobs `mac` / `windows` (parallel)

- Both `needs: prepare` only — **parallel is OK** after `prepare` creates the shell release
- Both run `app/build/jackdaw-brand.sh` with the **same** `OTA_BUILD_SUFFIX`
- Publish scripts:
  - Mac: `desktop` → `yarn run build:publish:prerelease:mac` (ad-hoc sign: `-c.mac.identity=-`, `-c.mac.notarize=false`)
  - Win: `desktop` → `yarn run build:publish:prerelease:win`

### Job `carry-forward` (ubuntu, platform-only dispatch only)

- Runs after a successful **mac-only** or **windows-only** job
- `app/build/ota-carry-forward.sh` — downloads the other platform’s OTA assets from the newest prior prerelease and uploads them to the current tag
- Prevents “Could not read update metadata” on the OS that was not rebuilt

### Job `finalize`

- Waits for **both** mac and windows (housekeeping only, ~10 s)
- Deletes duplicate releases with the same tag (keeps the one with **most assets**)
- Normalizes release title/notes

**Users do not wait for finalize or carry-forward.** OTA works once **their** platform job finishes (carry-forward adds the other OS metadata within ~1 min for single-OS dispatches).

### Post-push GitHub history cleanup

After a successful push-triggered desktop publish, `.github/workflows/cleanup-github-history.yml`
keeps the newest non-empty GitHub Release and its tag. It removes older releases, their
release tags, and completed historical Actions runs. The cleanup deliberately waits for a
successful publish, so a failed build cannot delete the last working OTA release. In-progress
runs, the current publish run, and the cleanup run are preserved; tags that are not attached
to a release are not changed.

---

## GitHub secrets

| Secret | Used for |
|--------|----------|
| `GITHUB_TOKEN` | CI publish (Actions `contents: write`) |
| `JACKDAW_GH_UPDATE_TOKEN` | Optional fine-grained PAT (rate limits); not required for public-repo OTA |

CI **warns** if `gh-update-token.txt` is empty; public-repo OTA works without it.

---

## Files inside a release build

Shipped in app `Resources/` (via electron-builder):

| File | Purpose |
|------|---------|
| `app-update.yml` | Generated by electron-builder — feed URL, owner, repo (`private: false` for public repo) |
| `gh-update-token.txt` | Optional PAT for higher GitHub API rate limits (`extraResources` in `electron-builder.yml`) |

Runtime resolution: `desktop/backend/backend.ts` → `appResourcePaths()`, `hasAppUpdateConfig()`, `resolveGhUpdateToken()`.

Auth: `autoUpdater.addAuthHeader('token …')` — **do not use `setFeedURL()`** (breaks `app-update.yml` per electron-builder docs).

---

## Platform behaviour

### Windows

- **Check + download:** `electron-updater` (Squirrel / NSIS) — `latest.yml` on the release
- **Install:** `autoUpdater.quitAndInstall()` on quit or “Install update”
- **Metadata:** `latest.yml`, `jackdaw-mail-*-setup.exe`

### macOS (no Apple Developer signing on prerelease builds)

- **Check:** `electron-updater` (GitHub provider, `allowPrerelease` for `-dev` versions)
- **Download:** Custom — **`.dmg`** from GitHub Releases API with progress (`downloadMacDmgUpdate`)
- **Install:** **Not** Squirrel/ShipIt (ad-hoc builds fail code signature validation)

  1. Spawn detached bash script
  2. **Quit** running app (`shutdownBackend`, `app.exit`)
  3. Script waits for PID, mounts DMG, `ditto` to `/Applications/Jackdaw Mail.app`, `open` new app
- **Metadata on release:** `latest-mac.yml`, `.zip` (for metadata); user-facing install path is **DMG**

The optional `JACKDAW_GH_UPDATE_TOKEN` is used when available, but a `401` from GitHub
automatically retries public release and asset requests without the token. Redirects to
GitHub's CDN are also requested without forwarding the token.

If Apple Developer ID + notarization are added later, Mac could switch back to zip + `quitAndInstall` — until then, keep DMG path.

---

## Key code paths

| Function / area | File |
|-----------------|------|
| `configureAutoUpdater`, `checkForUpdate`, `getUpdateStatus` | `desktop/backend/backend.ts` |
| `downloadMacDmgUpdate`, `scheduleMacDmgInstallAndQuit` | `desktop/backend/backend.ts` |
| `startupBackend` (JPC must be ready before UI) | `desktop/backend/backend.ts`, `desktop/src/main/index.ts` |
| `Update.svelte` phases: checking / downloading / downloaded / unsupported | `app/frontend/Settings/About/Update.svelte` |
| `restoreMainWindow` (maximize/restore button) | `desktop/backend/backend.ts`, `WindowHeader.svelte` |

---

## User-facing version string

OTA-capable builds match: `/-dev\.\d{14}$/` (e.g. `0.9.38-dev.20260830220950`).

Dev/local builds without timestamp suffix show **“Automatic updates are not configured”** — expected.

---

## Manual publish

```bash
# workflow_dispatch → "Jackdaw Mail Publish Desktop Update"
# release_type: prerelease (default) or release
# platform: both (default) | mac | windows  — single-OS keeps other platform via carry-forward
```

Or push to `main` touching monitored paths.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Two GitHub releases, same version | Parallel publish without `prepare` release shell | Ensure `prepare` creates release first; run `finalize` dedupe |
| Windows: metadata error, latest release empty | CI `prepare` created release; build **cancelled** (`concurrency`) before upload | Delete empty release; CI now runs `cleanup-empty-release`; retry check after a successful Actions run |
| Mac: `unsupported` | Missing `app-update.yml` or token in `.app` | Reinstall from CI `.dmg` |
| Mac: code signature / ShipIt error | Tried `quitAndInstall` on ad-hoc build | Use DMG install path (current code) |
| Mac: app didn’t restart after update | Install ran while app still open | Use `scheduleMacDmgInstallAndQuit` (quit first, then script) |
| `JPC: Could not connect to ws://localhost:5455` after OTA | UI loaded before backend | `await startupBackend()` before `loadFile`; retry JPC connect |
| Infinite “Checking…” on About tab | Remount / race on `checkForUpdate(true)` | Poll status; don’t force new check while `checking` |
| Windows: “Automatic updates are not configured” | Portable/dir build or an installer without `app-update.yml` | Install the latest `setup.exe` from GitHub Releases, or use **Download latest installer** on the About page |
| `422` / duplicate tag on publish | Tag missing before publish | `prepare` creates tag + release before mac/win |

---

## Do NOT

- Call `autoUpdater.setFeedURL()` — use bundled `app-update.yml` + `addAuthHeader`
- Inject token via `@rollup/plugin-replace` in backend bundle — breaks esbuild
- Run Mac and Windows publish **without** `prepare` creating the GitHub release first
- Use `quitAndInstall` on Mac for ad-hoc (`identity=-`) builds
- Commit `desktop/build/gh-update-token.txt` or real tokens

---

### User-facing flow

- **Background check:** on app startup, then every **4 hours** (`desktop/src/main/index.ts`). The scheduled check retries even after a transient error or an earlier `unsupported`/`uptodate` result.
- **Banner:** when update is `available` / `downloading` / `downloaded` — opens Settings → About; on Windows the user clicks **Download update**, then **Install update** (no automatic Windows download or install)
- **Manual fallback:** Settings → About always offers a link to the latest GitHub Releases page, with the platform-specific installer available there.
- **Mac:** DMG download may run in background after check; install only after explicit **Install update**

Do not poll every few minutes — wastes GitHub API and user bandwidth. 4 h is a reasonable default for `-dev` prereleases; increase to 12–24 h when releases become less frequent.

---

## Changing OTA safely

1. Read this doc and `electron-builder.yml`
2. Change backend + UI + CI together if behaviour crosses layers
3. Push to `main`, watch [Actions → Jackdaw Mail Publish Desktop Update](https://github.com/Uugsx/jackdaw-mail/actions)
4. Verify **one** release contains: `latest.yml`, `latest-mac.yml`, `setup.exe`, `*.dmg`, zips
5. Test Mac: Settings → About → check update → progress → quit → reinstall → new version
6. Test Windows: same; confirm OTA from previous CI `setup.exe` build
