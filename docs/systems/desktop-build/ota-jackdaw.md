# Jackdaw Mail desktop OTA (Over-The-Air updates)

Runbook for **automatic updates** of the Jackdaw Mail Electron desktop app via **GitHub Releases** (public repo `Uugsx/jackdaw-mail`).

**Read this file before changing OTA, CI publish, or updater UI.**

Related generic docs: [electron-builder.md](./electron-builder.md), [macos.md](./macos.md), [windows.md](./windows.md).

---

## Overview

| Piece | Role |
|-------|------|
| **CI** | `.github/workflows/publish-desktop-jackdaw.yml` — builds Mac and/or Windows, one prerelease (**пробный канал**) |
| **Каналы** | `.github/workflows/promote-desktop-jackdaw.yml` + `.github/scripts/ota-channel.sh` — пробный → основной (через 24 ч или вручную), остановка, откат. См. [«Каналы обновлений»](#каналы-обновлений-пробный-и-основной) |
| **Version** | `0.10.<run_number>` (обычный semver, без `-dev`) — суффикс из job `prepare` (`OTA_BUILD_SUFFIX` = `github.run_number`). Старые `0.9.x-dev.<UTC>` остаются совместимы: `0.10.N` > `0.9.x-dev.*` |
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
prepare  →  mac  ║  windows  →  carry-forward?  →  finalize  ┄┄ 24 ч ┄┄→  promote (latest)
  │            │       │                              │                    │
  │            └─ upload assets to ONE draft           │                    └─ основной канал
  │                                                    └─ draft → prerelease: пробный канал
  └─ tag + empty GitHub draft prerelease (required!)
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

- `latest.yml` → `0.10.NEW` (Windows users update)
- `latest-mac.yml` → still `0.10.OLD` (Mac users stay put)

**Push to `main` always builds both** — use manual dispatch for single-OS releases.

### Job `prepare` (ubuntu)

1. `OTA_BUILD_SUFFIX=$(date -u +%Y%m%d%H%M%S)`
2. Tag: `v0.10.${OTA_BUILD_SUFFIX}` on current commit
3. **Delete** existing release with that tag (if any)
4. **`gh release create --draft --prerelease`** — пустой черновик. Черновик не виден никому, даже
   пробному каналу, пока загружаются файлы: клиент не наткнётся на выпуск без `latest*.yml`.
   electron-builder загружает файлы в черновик с тем же тегом (черновик он принимает всегда).

**Why:** If Mac and Windows both call `electron-builder --publish always` without an existing release, they race and create **two releases with the same tag** — Mac-only (`.dmg`, `latest-mac.yml`) and Windows-only (`setup.exe`, `latest.yml`). Updaters then fail with “not configured” or 404.

### Jobs `mac` / `windows` (parallel)

- Both `needs: prepare` only — **parallel is OK** after `prepare` creates the shell release
- Both run `app/build/jackdaw-brand.sh` with the **same** `OTA_BUILD_SUFFIX`
- Publish scripts:
  - Mac: `desktop` → `yarn run build:publish:prerelease:mac` (`-c.mac.identity=-`, `-c.mac.notarize=false`; if `JACKDAW_MAC_SIGN_P12` is set, the `afterSign` hook re-signs the app with our own certificate — see «Подпись Mac своим сертификатом»)
  - Win: `desktop` → `yarn run build:publish:prerelease:win`

### Job `carry-forward` (ubuntu, platform-only dispatch only)

- Runs after a successful **mac-only** or **windows-only** job
- `app/build/ota-carry-forward.sh` — downloads the other platform’s OTA assets from the newest prior prerelease and uploads them to the current tag
- Prevents “Could not read update metadata” on the OS that was not rebuilt

### Job `finalize`

- Waits for **both** mac and windows (housekeeping only, ~10 s)
- Deletes duplicate releases with the same tag (keeps the one with **most assets**)
- Normalizes release title/notes
- Публикует черновик как **prerelease** (`draft=false, prerelease=true, make_latest=false`) —
  с этого момента выпуск в **пробном канале**. Основной канал (`latest`) не меняется.

Пробный клиент получает выпуск после `finalize` (обе платформы готовы); основной — только после
продвижения (`promote-desktop-jackdaw.yml`).

### Post-push GitHub history cleanup

After a successful push-triggered desktop publish, `.github/workflows/cleanup-github-history.yml`
keeps the main-channel release (`latest`), **two previous** main-channel releases (rollback
targets) and every release newer than `latest` (pilot, held, unfinished drafts). It removes older
releases, their release tags, and completed historical Actions runs. **Never** reduce this to «keep
only the newest release»: the newest one is a pilot, and `latest` would disappear. The cleanup deliberately waits for a
successful publish, so a failed build cannot delete the last working OTA release. In-progress
runs, the current publish run, and the cleanup run are preserved; tags that are not attached
to a release are not changed.

---

## Зеркало обновлений (jackdaw-mail.pro/updates)

GitHub CDN у части пользователей отдаёт 0,4–0,55 МБ/с, поэтому установщики дублируются на нашем VPS.

- **CI:** jobs `mirror-mac` и `mirror-win` сразу после сборки платформы, затем `mirror` после `finalize` (страховка и удаление старых версий), все `continue-on-error` → `app/build/ota-mirror-sync.sh` с `MIRROR_MANIFESTS=0`: выкладывает только DMG, `setup.exe` и blockmap пробного выпуска. **`latest*.yml` в корне зеркала — манифесты основного канала**: их выкладывает только `promote-desktop-jackdaw.yml` (job `mirror`) при продвижении или откате. Установщики идут с `--size-only` (уже выложенный файл не перекачивается); при удалении старых версий файлы, на которые ссылаются манифесты основного канала на зеркале, не удаляются. Выкладка через rsync на пользователя `jackdaw-updates` (ключ с `command="rrsync /opt/jackdaw-mail/updates",restrict`), оставляет 3 последние версии. Секреты `UPDATES_MIRROR_SSH_KEY`, `UPDATES_MIRROR_KNOWN_HOSTS`, переменные `UPDATES_MIRROR_HOST`, `UPDATES_MIRROR_USER`; не заданы — шаг пропускается.
- **VPS:** Caddy `handle_path /updates/*` → `file_server` из `/opt/jackdaw-mail/updates` (без сжатия, Range). Конфигурация VPS хранится в приватном `jackdaw-servers`.
- **Клиент:** `desktop/backend/updateMirror.ts`. macOS (`downloadMacDmgUpdate`) — DMG с зеркала, любая ошибка/обрыв 20 с без данных/неверная сумма → GitHub. Windows (`downloadWindowsUpdate`) — адреса файлов в провайдере electron-updater подменяются на зеркало, при ошибке или остановке прогресса 20 с — обычная загрузка с GitHub.
- **Доверие:** манифесты и sha512 клиент берёт только у GitHub; зеркало отдаёт байты, которые сверяются с этой суммой (`verifyMacDmgChecksum`, проверка electron-updater). Подмена файла на зеркале ведёт к откату на GitHub, а не к установке.
- `JACKDAW_UPDATE_MIRROR=off` отключает зеркало, другой https-адрес (или localhost) подменяет его для проверок.
- Параллельная публикация по-прежнему только после `prepare`; `mirror` не часть критического пути.

---

## Каналы обновлений: пробный и основной

Цель: новый выпуск сначала получает только приложение владельца; остальным он приходит после
24 ч без проблем. Если владелец заметил проблему — выпуск останавливается, не дойдя до других.

| Канал | Что на GitHub | Кто получает | Как клиент ищет |
|-------|---------------|--------------|-----------------|
| **пробный** | опубликованный prerelease новее `latest` | клиенты с «Получать пробные выпуски» | `allowPrerelease = true`: первый выпуск из `releases.atom` (черновиков там нет) |
| **основной** | выпуск, отмеченный `latest` | все остальные | `allowPrerelease = false`: `/releases/latest` |

`latest` меняет только `promote-desktop-jackdaw.yml` (логика — `.github/scripts/ota-channel.sh`,
сценарии проверяются `.github/scripts/test-ota-channel/run.sh` в `check-desktop.yml`).

### Клиент

- Настройки → О программе → **«Получать пробные выпуски»** (по умолчанию выключено). Переключатель
  виден в сборках с OTA-версией. После переключения сразу идёт новая проверка (если обновление не
  скачивается и не ждёт установки).
- Выбор хранится в `update-channel.json` в каталоге данных (`userData`, на Mac
  `~/Library/Application Support/Jackdaw/update-channel.json`): `{"channel": "pilot"}`. Файл, а не
  настройки интерфейса: первая проверка идёт из главного процесса до загрузки окна. Повреждённый
  файл — основной канал. Владельцу канал включается переключателем (или этим файлом).
- `desktop/backend/updateChannel.ts` (`shouldAllowPrerelease`), `backend.ts` (`applyUpdateChannel`
  перед каждой проверкой, `getUpdateChannel` / `setUpdateChannel` для окна), `About.svelte`.
- Старые `0.9.x-dev.*` по-прежнему с `allowPrerelease` (видят и пробные) — таких установок нет.
- Пробный клиент после продвижения: тот же выпуск теперь `latest`, пробный клиент уже на нём;
  следующий пробный выпуск он получит как обычно. Выключить канал на пробной версии — следующее
  обновление придёт, когда основной канал её догонит (понижения версии нет).

### Продвижение (`promote-desktop-jackdaw.yml`)

- **Автоматически, каждый час** (`schedule`, `auto`): самый новый пробный выпуск, которому ≥ 24 ч
  (переменная репозитория `PILOT_SOAK_HOURS`), с обоими манифестами, **новее последнего
  остановленного**. Выпуски не новее остановленного сами не продвигаются; более новый (исправление)
  продвинется после своей выдержки.
- **Вручную** (Actions → «Jackdaw Mail Promote Desktop Update» → Run workflow):
  - `promote` — сразу, без выдержки (срочное исправление). Без тега — самый новый пробный, если он не
    остановлен; с тегом — этот, даже остановленный. Версия ниже основного канала не принимается.
  - `hold` — остановить (метка `<!-- jackdaw:hold -->` в описании выпуска); без тега — самый новый
    пробный. `resume` — снять остановку.
  - `rollback` — см. ниже. `status` — что в каналах.
- После `promote`/`rollback` job `mirror` выкладывает на зеркало манифесты основного канала.

```bash
gh workflow run promote-desktop-jackdaw.yml -f action=hold
gh workflow run promote-desktop-jackdaw.yml -f action=promote -f tag=v0.10.N
bash .github/scripts/ota-channel.sh status   # локально, нужен gh с доступом к репозиторию
```

### Срочный откат

`rollback` (без тега — прошлый выпуск основного канала; очистка истории хранит два прошлых):

1. прошлый выпуск снова `latest` — новые обновления основного канала прекращаются сразу;
2. плохой выпуск становится остановленным prerelease (сам не вернётся);
3. зеркало получает манифесты прошлого выпуска.

Кто уже установил плохой выпуск, назад не откатится (electron-updater не понижает версию). Для них:
`git revert` → push в `main` → `promote` нового выпуска с тегом сразу после сборки.

---

## GitHub secrets

| Secret | Used for |
|--------|----------|
| `GITHUB_TOKEN` | CI publish (Actions `contents: write`) |
| `JACKDAW_MAC_SIGN_P12`, `JACKDAW_MAC_SIGN_P12_PASSWORD` | Свой сертификат подписи Mac (base64 p12 и пароль). Создаёт `desktop/scripts/mac-signing/create-self-signed-cert.sh` |
| `JACKDAW_GH_UPDATE_TOKEN` | **Не используется** с 2026-10-25: CI его в сборку не передаёт. Секрет можно удалить |

Токен GitHub в установщик не кладётся: всё, что лежит внутри DMG/EXE, может прочитать любой,
кто его скачал. Публичному репозиторию токен для OTA не нужен. `jackdaw-brand.sh` пишет пустой
`gh-update-token.txt` (предупреждение в логе CI — ожидаемо), и в сборку он не попадает.

---

## Подпись Mac своим сертификатом

Сертификат не от Apple: Gatekeeper при первой установке предупреждает так же, как с ad-hoc.
Зато требование подписи (designated requirement) одинаково во всех сборках:
`identifier "app.jackdaw.client" and certificate leaf = H"…"` вместо `cdhash H"…"`, который меняется каждой сборкой.
Связка ключей привязывает доступ к этому требованию, поэтому пароли и токены OAuth хранятся
в Связке (`safeStorage`) без запроса после каждого обновления.

- CI: шаг «Сертификат подписи Mac» импортирует p12 во временную связку и выставляет
  `JACKDAW_MAC_SIGN_IDENTITY` / `JACKDAW_MAC_SIGN_KEYCHAIN`; хук `desktop/build/sign-mac-own-certificate.cjs`
  (`afterSign`) переподписывает `.app` до DMG/zip/pkg. Без секрета — ad-hoc, как раньше.
- Приложение само проверяет свою подпись (`isMacCertificateSigned` в `backend.ts`): Связка ключей
  включается только при подписи сертификатом. Ad-hoc-сборки (в том числе локальные `--dir`) хранят пароли по-старому.
- Старые пароли перешифровываются при чтении (`isLegacyEncrypted`).
- **Сертификат не терять и не менять без нужды.** Новый сертификат или переход на Developer ID —
  другая подпись: каждый пользователь Mac один раз увидит запрос Связки ключей. Копия — `~/Documents/Jackdaw-signing/` у владельца.
- Уведомления на Electron ≥ 42 этот сертификат не чинит: UNNotification требует Team ID (Developer ID).

## Files inside a release build

Shipped in app `Resources/` (via electron-builder):

| File | Purpose |
|------|---------|
| `app-update.yml` | Generated by electron-builder — feed URL, owner, repo (`private: false` for public repo) |

Mac DMG перед установкой сверяется с `sha512` из `latest-mac.yml` (`verifyMacDmgChecksum` в
`backend.ts`); при расхождении файл удаляется, обновление не ставится.

Runtime resolution: `desktop/backend/backend.ts` → `appResourcePaths()`, `hasAppUpdateConfig()`, `resolveGhUpdateToken()` (токен — только из окружения при разработке или из старых установок).

Auth: `autoUpdater.addAuthHeader('token …')` — **do not use `setFeedURL()`** (breaks `app-update.yml` per electron-builder docs).

---

## Platform behaviour

### Windows

- **Check + download:** `electron-updater` (Squirrel / NSIS) — `latest.yml` on the release
- **Install:** `autoUpdater.quitAndInstall()` on quit or “Install update”
- **Metadata:** `latest.yml`, `jackdaw-mail-*-setup.exe`

### macOS (no Apple Developer signing on prerelease builds)

- **Check:** `electron-updater` (GitHub provider, `allowPrerelease` только для старых `-dev` клиентов)
- **Download:** Custom — **`.dmg`** from GitHub Releases API with progress (`downloadMacDmgUpdate`)
- **Install:** **Not** Squirrel/ShipIt (ad-hoc builds fail code signature validation)

  1. Spawn detached bash script
  2. **Quit** running app (`shutdownBackend`, `app.exit`)
  3. Script waits for PID, mounts DMG, `ditto` to `/Applications/Jackdaw Mail.app`, `open` new app.
     It also waits (≤ 30 s) for the SQLite utilityProcess: it can outlive the main process while it
     checkpoints the WAL of `mail.db`, and the new version would otherwise start with `SQLITE_BUSY`.
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

OTA-capable builds match: `^\d+\.\d+\.\d+$` (CI, e.g. `0.10.7`) or legacy `/-dev\.\d{14}$/`. Local builds (`0.10.0-dev`) are not OTA.

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
| Mac: update downloads and “installs”, but the version stays the same; the update is offered again | Mac job failed, `carry-forward` added the previous Mac assets, the rerun added the new ones: the release had two DMGs and the updater took the first (old) one | Updater picks the DMG whose name has the update version (`desktop/backend/updateAssets.ts`); `finalize` removes other-version assets of a platform that has a current-version installer |
| Mac: code signature / ShipIt error | Tried `quitAndInstall` on ad-hoc build | Use DMG install path (current code) |
| Mac: app didn’t restart after update | Install ran while app still open | Use `scheduleMacDmgInstallAndQuit` (quit first, then script) |
| `JPC: Could not connect to ws://localhost:5455` after OTA | UI loaded before backend | `await startupBackend()` before `loadFile`; retry JPC connect |
| `SQLITE_BUSY` / “Local data is busy” right after OTA, empty mail | Previous version’s SQLite process still closing `mail.db`, or a second connection switching the journal mode | busy_timeout 30 s in `SQLiteServer`, startup retries in `getStartObjects`, “Try again” banner; install script waits for the SQLite PID |
| Infinite “Checking…” on About tab | Remount / race on `checkForUpdate(true)` | Poll status; don’t force new check while `checking` |
| Windows: “Automatic updates are not configured” | Portable/dir build or an installer without `app-update.yml` | Install the latest `setup.exe` from GitHub Releases, or use **Download latest installer** on the About page |
| `422` / duplicate tag on publish | Tag missing before publish | `prepare` creates tag + release before mac/win |
| Основной канал не получает новый выпуск | Так и задумано: он в пробном канале 24 ч; или остановлен; или в нём нет манифеста одной платформы | `promote-desktop-jackdaw.yml` → `status`; срочно — `promote` |
| Пробный клиент не видит новый выпуск | `finalize` ещё не опубликовал черновик, или переключатель выключен (`update-channel.json`) | Дождаться `finalize`; проверить Настройки → О программе |
| `/releases/latest` 404, у всех ошибка обновления | Кто-то вручную снял `latest` или удалил выпуск основного канала | `promote` нужного тега (или `rollback`) |
| `422 already_exists` on publish although `prepare` created the release | GitHub sometimes returns `200` with an empty list for `GET /releases`; electron-builder then tries to create the release | The mac/windows publish steps retry up to 4 times; already uploaded files are overwritten |

---

## Do NOT

- Call `autoUpdater.setFeedURL()` — use bundled `app-update.yml` + `addAuthHeader`
- Inject token via `@rollup/plugin-replace` in backend bundle — breaks esbuild
- Run Mac and Windows publish **without** `prepare` creating the GitHub release first
- Mark a fresh build `latest` in `finalize` (bypasses the pilot channel) or clean history down to the newest release
- Upload `latest*.yml` to the mirror root from the publish workflow (they are main-channel manifests)
- Use `quitAndInstall` on Mac for ad-hoc (`identity=-`) builds
- Commit `desktop/build/gh-update-token.txt` or real tokens

---

### User-facing flow

- **Background check:** on app startup, then every **4 hours** (`desktop/src/main/index.ts`). The scheduled check retries even after a transient error or an earlier `unsupported`/`uptodate` result.
- **Banner:** when update is `available` / `downloading` / `downloaded` — opens Settings → About; on Windows the user clicks **Download update**, then **Install update** (no automatic Windows download or install)
- **Manual fallback:** Settings → About always offers a link to the latest GitHub Releases page, with the platform-specific installer available there.
- **Mac:** DMG download may run in background after check; install only after explicit **Install update**

Do not poll every few minutes — wastes GitHub API and user bandwidth. 4 h is a reasonable default for releases; increase to 12–24 h when releases become less frequent.

---

## Changing OTA safely

1. Read this doc and `electron-builder.yml`
2. Change backend + UI + CI together if behaviour crosses layers
3. Push to `main`, watch [Actions → Jackdaw Mail Publish Desktop Update](https://github.com/Uugsx/jackdaw-mail/actions)
4. Verify **one** release contains: `latest.yml`, `latest-mac.yml`, `setup.exe`, `*.dmg`, zips
5. Test Mac: Settings → About → check update → progress → quit → reinstall → new version
6. Test Windows: same; confirm OTA from previous CI `setup.exe` build

## Релизы без `-dev` (с 0.10)

- Версия CI: `0.10.<run_number>`; релиз в `prepare` создаётся черновиком prerelease, в `finalize` публикуется как prerelease (пробный канал), в `latest` его переводит `promote-desktop-jackdaw.yml`.
- Клиенты основного канала видят только latest; пробные и старые `-dev` клиенты (allowPrerelease) видят и prerelease.
