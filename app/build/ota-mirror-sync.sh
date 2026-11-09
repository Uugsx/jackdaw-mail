#!/usr/bin/env bash
# Зеркало обновлений на VPS (jackdaw-mail.pro/updates/): копирует из релиза GitHub
# DMG, setup.exe, latest*.yml и blockmap-файлы, затем удаляет старые версии.
# GitHub остаётся источником правды: клиент берёт контрольные суммы из манифеста GitHub.
# Использование: ota-mirror-sync.sh <tag> <owner/repo> [mac|win|all]
# Окружение: MIRROR_SSH_KEY_FILE, MIRROR_KNOWN_HOSTS_FILE, MIRROR_HOST, MIRROR_USER, GH_TOKEN
# MIRROR_MANIFESTS=0 — только установщики (пробный выпуск): latest*.yml в корне зеркала —
# манифесты основного канала, их меняет только продвижение (promote-desktop-jackdaw.yml).
set -euo pipefail

TAG="${1:?tag}"
REPO="${2:?owner/repo}"
# mac | win | all: зеркало платформы выкладывается сразу после её сборки, чтобы клиент
# не попадал в окно, когда манифест на GitHub уже есть, а файла на зеркале ещё нет
PLATFORM="${3:-all}"
KEEP="${MIRROR_KEEP_VERSIONS:-3}"
MANIFESTS="${MIRROR_MANIFESTS:-1}"

STAGE="$(mktemp -d)"
EMPTY="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$EMPTY"' EXIT

SSH="ssh -i $MIRROR_SSH_KEY_FILE -o UserKnownHostsFile=$MIRROR_KNOWN_HOSTS_FILE -o StrictHostKeyChecking=yes -o BatchMode=yes"
REMOTE="$MIRROR_USER@$MIRROR_HOST:"

case "$PLATFORM" in
  mac) PATTERNS=('*.dmg' '*.dmg.blockmap' 'latest-mac.yml') ;;
  win) PATTERNS=('*-setup.exe' '*-setup.exe.blockmap' 'latest.yml') ;;
  *) PATTERNS=('*.dmg' '*.dmg.blockmap' '*-setup.exe' '*-setup.exe.blockmap' 'latest.yml' 'latest-mac.yml') ;;
esac
for pattern in "${PATTERNS[@]}"; do
  if [ "$MANIFESTS" = 0 ] && [[ "$pattern" == *.yml ]]; then
    continue
  fi
  gh release download "$TAG" --repo "$REPO" --dir "$STAGE" --pattern "$pattern" || true
done

# Пустой или недокачанный файл не должен попасть в зеркало
for f in "$STAGE"/*; do
  [ -s "$f" ] || { echo "::error::Пустой файл $f"; exit 1; }
done
ls -la "$STAGE"

# Сначала установщики и blockmap, манифесты последними: клиент не увидит версию без файла
# rrsync на VPS держит эксклюзивную блокировку: параллельные mac/win ловят код 12 — повторяем с паузой.
rsync_retry() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8; do
    if rsync "$@"; then return 0; fi
    echo "rsync: попытка $attempt не удалась, повтор через $((attempt * 10)) с" >&2
    sleep $((attempt * 10))
  done
  return 1
}
# --size-only: в имени установщика есть версия, тот же размер — тот же файл (продвижение
# не перекачивает уже выложенный установщик); недокачанный файл меньше и отправится заново.
rsync_retry -rlt --no-perms --chmod=D755,F644 --partial --size-only --exclude='*.yml' -e "$SSH" "$STAGE/" "$REMOTE"
if [ "$MANIFESTS" != 0 ]; then
  rsync_retry -rlt --no-perms --chmod=D755,F644 -e "$SSH" --include='*.yml' --exclude='*' "$STAGE/" "$REMOTE"
fi

# Установщики, на которые ссылаются манифесты основного канала на зеркале, не удаляются,
# даже если после них вышло больше $KEEP пробных версий.
PROTECTED="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$EMPTY" "$PROTECTED"' EXIT
rsync_retry -r -e "$SSH" --include='latest*.yml' --exclude='*' "$REMOTE" "$PROTECTED/" || true
PROTECT_LIST=$(cat "$PROTECTED"/*.yml 2>/dev/null | sed -n -E 's/^ *(- url|path): *//p' | sort -u || true)

# Храним последние $KEEP версий каждого установщика
prune() {
  local suffix="$1"
  rsync_retry -e "$SSH" --list-only "$REMOTE" \
    | awk -v s="$suffix" '$NF ~ s"$" && $NF !~ /blockmap$/ { print $(NF-2) "T" $(NF-1), $NF }' \
    | sort -r | awk -v k="$KEEP" 'NR>k { print $2 }' \
    | while read -r old; do
        [ -n "$old" ] || continue
        if printf '%s\n' "$PROTECT_LIST" | grep -qxF "$old"; then
          echo "Оставляю $old: на него ссылается основной канал"
          continue
        fi
        echo "Удаляю старую версию $old"
        for victim in "$old" "$old.blockmap"; do
          rsync_retry -r --delete -e "$SSH" --include="$victim" --exclude='*' "$EMPTY/" "$REMOTE"
        done
      done
}
if [ "$PLATFORM" = all ]; then
  prune '\\.dmg'
  prune '-setup\\.exe'
fi
