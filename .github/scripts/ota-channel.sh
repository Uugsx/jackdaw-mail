#!/usr/bin/env bash
# Каналы обновлений Jackdaw Mail на GitHub Releases.
#
#   пробный канал  — опубликованные prerelease-выпуски новее основного (их видят клиенты
#                    с «Получать пробные выпуски»: electron-updater с allowPrerelease);
#   основной канал — выпуск, отмеченный GitHub как latest (остальные клиенты: /releases/latest).
#
# Использование: ota-channel.sh <команда> [тег]
#   status            — что сейчас в каналах
#   auto              — продвинуть самый новый пробный выпуск, выдержанный PILOT_SOAK_HOURS (24 ч)
#                       и не остановленный; выпуски не новее остановленного не продвигаются
#   promote [тег]     — продвинуть сразу, без выдержки (срочное исправление); без тега — самый новый
#                       пробный, если он не остановлен; явный тег продвигается и остановленным
#   hold [тег]        — остановить автоматическое продвижение (по умолчанию самого нового пробного)
#   resume [тег]      — снять остановку (по умолчанию с самого нового остановленного)
#   rollback [тег]    — вернуть основной канал на прошлый выпуск (или на тег); текущий выпуск
#                       основного канала становится остановленным пробным
#
# Окружение: GH_TOKEN, REPO (по умолчанию Uugsx/jackdaw-mail), PILOT_SOAK_HOURS, GITHUB_OUTPUT.
# Продвинутый тег пишется в GITHUB_OUTPUT как promoted=<тег> (по нему CI обновляет зеркало).
set -euo pipefail

CMD="${1:-status}"
ARG_TAG="${2:-}"
REPO="${REPO:-Uugsx/jackdaw-mail}"
SOAK_HOURS="${PILOT_SOAK_HOURS:-24}"
HOLD_MARKER="<!-- jackdaw:hold -->"

die() { echo "::error::$*" >&2; exit 1; }

ver() { printf '%s' "${1#v}"; }

# a > b по номеру версии
version_gt() {
  [ "$(ver "$1")" != "$(ver "$2")" ] &&
    [ "$(printf '%s\n%s\n' "$(ver "$1")" "$(ver "$2")" | sort -V | tail -n 1)" = "$(ver "$1")" ]
}

now_epoch() { date -u +%s; }
iso_epoch() { date -u -d "$1" +%s 2>/dev/null || date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s; }

# Таблица выпусков: тег, draft, prerelease, есть оба манифеста, остановлен, published_at
load_releases() {
  RELEASES=$(gh api --paginate "repos/$REPO/releases?per_page=100" --jq '.[] | [
      .tag_name,
      (.draft | tostring),
      (.prerelease | tostring),
      (([.assets[].name] | (index("latest.yml") != null and index("latest-mac.yml") != null)) | tostring),
      (((.body // "") | contains("'"$HOLD_MARKER"'")) | tostring),
      (.published_at // "")
    ] | @tsv')
  STABLE=$(gh api "repos/$REPO/releases/latest" --jq .tag_name 2>/dev/null || true)
}

field() { # тег, номер поля (1..6)
  printf '%s\n' "$RELEASES" | awk -F'\t' -v t="$1" -v f="$2" '$1 == t { print $f; exit }'
}

# Пробные выпуски: опубликованные prerelease новее основного канала, по возрастанию версии
pilot_tags() {
  printf '%s\n' "$RELEASES" | awk -F'\t' '$2 == "false" && $3 == "true" { print $1 }' |
    while read -r tag; do
      [ -n "$tag" ] || continue
      if [ -z "$STABLE" ] || version_gt "$tag" "$STABLE"; then
        echo "$tag"
      fi
    done | sort -V
}

newest_held_pilot() {
  local held="" tag
  for tag in $(pilot_tags); do
    if [ "$(field "$tag" 5)" = true ]; then
      held="$tag"
    fi
  done
  printf '%s' "$held"
}

set_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1" >> "$GITHUB_OUTPUT"
  fi
}

release_id() {
  gh api "repos/$REPO/releases/tags/$1" --jq .id
}

check_latest_is() {
  local actual
  actual=$(gh api "repos/$REPO/releases/latest" --jq .tag_name)
  [ "$actual" = "$1" ] || die "Основной канал: ожидался $1, GitHub отвечает $actual"
}

status() {
  echo "Основной канал: ${STABLE:-нет}"
  local pilots now tag published hours state held
  pilots=$(pilot_tags)
  if [ -z "$pilots" ]; then
    echo "Пробный канал: выпусков новее основного нет"
    return
  fi
  now=$(now_epoch)
  held=$(newest_held_pilot)
  for tag in $pilots; do
    published=$(field "$tag" 6)
    hours=$(( (now - $(iso_epoch "$published")) / 3600 ))
    state="ждёт выдержки, осталось $(( SOAK_HOURS > hours ? SOAK_HOURS - hours : 0 )) ч"
    if [ "$(field "$tag" 4)" != true ]; then
      state="нет манифеста одной из платформ"
    fi
    if [ -n "$held" ] && ! version_gt "$tag" "$held"; then
      state="сам не продвинется: остановлен $held"
    fi
    if [ "$(field "$tag" 5)" = true ]; then
      state="остановлен"
    fi
    echo "Пробный: $tag — опубликован $published ($hours ч назад), $state"
  done
}

promote() {
  local tag="$1"
  [ -n "$tag" ] || die "Пробных выпусков нет"
  [ -n "$(field "$tag" 1)" ] || die "Выпуска $tag нет"
  [ "$(field "$tag" 2)" = false ] || die "$tag — черновик, сборка не закончена"
  [ "$(field "$tag" 4)" = true ] || die "В $tag нет latest.yml и latest-mac.yml"
  if [ -n "$STABLE" ] && ! version_gt "$tag" "$STABLE"; then
    die "$tag не новее основного канала ($STABLE); вернуть прошлую версию — rollback"
  fi
  gh api -X PATCH "repos/$REPO/releases/$(release_id "$tag")" \
    -F prerelease=false -f make_latest=true >/dev/null
  check_latest_is "$tag"
  echo "Продвинут в основной канал: $tag (был ${STABLE:-нет})"
  set_output "promoted=$tag"
}

auto() {
  local held now newest="" tag age
  held=$(newest_held_pilot)
  now=$(now_epoch)
  for tag in $(pilot_tags); do
    if [ -n "$held" ] && ! version_gt "$tag" "$held"; then
      continue
    fi
    [ "$(field "$tag" 4)" = true ] || continue
    age=$(( now - $(iso_epoch "$(field "$tag" 6)") ))
    if [ "$age" -ge $(( SOAK_HOURS * 3600 )) ]; then
      newest="$tag"
    fi
  done
  if [ -z "$newest" ]; then
    echo "Продвигать нечего${held:+ (остановлен $held)}"
    status
    return
  fi
  promote "$newest"
}

set_hold() { # тег, true|false
  local tag="$1" on="$2" id body
  id=$(release_id "$tag")
  body=$(gh api "repos/$REPO/releases/$id" --jq '.body // ""')
  body=${body//"$HOLD_MARKER"/}
  # хвостовые пустые строки после удаления метки
  body=$(printf '%s' "$body" | awk '{ lines[NR] = $0 } END { n = NR; while (n > 0 && lines[n] ~ /^[[:space:]]*$/) n--; for (i = 1; i <= n; i++) print lines[i] }')
  if [ "$on" = true ]; then
    body="$body"$'\n\n'"$HOLD_MARKER"
  fi
  gh api -X PATCH "repos/$REPO/releases/$id" -f body="$body" >/dev/null
}

default_pilot() {
  pilot_tags | tail -n 1
}

hold() {
  local tag="${1:-$(default_pilot)}"
  [ -n "$tag" ] || die "Пробных выпусков нет"
  [ "$(field "$tag" 3)" = true ] || die "$tag уже в основном канале; вернуть прошлую версию — rollback"
  set_hold "$tag" true
  echo "Остановлен: $tag (сам в основной канал не перейдёт)"
}

resume() {
  local tag="${1:-$(newest_held_pilot)}"
  [ -n "$tag" ] || die "Остановленных выпусков нет"
  set_hold "$tag" false
  echo "Остановка снята: $tag"
}

rollback() {
  local current="$STABLE" target="$1"
  [ -n "$current" ] || die "Основного канала нет"
  if [ -z "$target" ]; then
    target=$(printf '%s\n' "$RELEASES" |
      awk -F'\t' '$2 == "false" && $3 == "false" && $4 == "true" { print $1 }' |
      while read -r tag; do
        if [ -n "$tag" ] && version_gt "$current" "$tag"; then
          echo "$tag"
        fi
      done | sort -V | tail -n 1)
  fi
  [ -n "$target" ] || die "Прошлого выпуска основного канала нет"
  [ -n "$(field "$target" 1)" ] || die "Выпуска $target нет"
  [ "$(field "$target" 2)" = false ] || die "$target — черновик"
  [ "$(field "$target" 4)" = true ] || die "В $target нет обоих манифестов"
  version_gt "$current" "$target" || die "$target не старше $current"
  # Сначала новый latest, потом прежний — в пробные: без latest GitHub выбрал бы его сам
  gh api -X PATCH "repos/$REPO/releases/$(release_id "$target")" \
    -F prerelease=false -f make_latest=true >/dev/null
  gh api -X PATCH "repos/$REPO/releases/$(release_id "$current")" -F prerelease=true >/dev/null
  set_hold "$current" true
  check_latest_is "$target"
  echo "Основной канал возвращён на $target; $current остановлен."
  echo "Кто уже обновился до $current, назад не откатится: выпустите исправление и продвиньте его (promote)."
  set_output "promoted=$target"
}

load_releases
case "$CMD" in
  status) status ;;
  auto) auto ;;
  promote)
    TAG="$ARG_TAG"
    if [ -z "$TAG" ]; then
      TAG=$(default_pilot)
      if [ -n "$TAG" ] && [ "$TAG" = "$(newest_held_pilot)" ]; then
        die "Самый новый пробный $TAG остановлен: укажите тег явно"
      fi
    fi
    promote "$TAG" ;;
  hold) hold "$ARG_TAG" ;;
  resume) resume "$ARG_TAG" ;;
  rollback) rollback "$ARG_TAG" ;;
  *) die "Неизвестная команда: $CMD" ;;
esac
