#!/usr/bin/env bash
# Сценарии каналов обновлений (ota-channel.sh) на поддельном gh, без обращений к GitHub.
# Использование: bash .github/scripts/test-ota-channel/run.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${1:-$HERE/../ota-channel.sh}"
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
mkdir -p "$D/bin"
cp "$HERE/gh" "$D/bin/gh"
chmod +x "$D/bin/gh"
export PATH="$D/bin:$PATH" FAKE_STATE="$D/state.json"
FAIL=0
fixture() { # спецификация: тег:prerelease:часов_назад:hold[:draft][:nomanifest] ... ; latest=тег
  python3 - "$@" <<'EOF' > "$FAKE_STATE"
import json, sys, datetime
now = datetime.datetime.now(datetime.timezone.utc)
rel = []; latest = next((a[7:] for a in sys.argv[1:] if a.startswith("latest=")), None)
for i, spec in enumerate(sys.argv[1:]):
    if spec.startswith("latest="): continue
    t, pre, hours, hold, *rest = spec.split(":")
    assets = [] if "nomanifest" in rest else [{"name": "latest.yml"}, {"name": "latest-mac.yml"}]
    rel.append({"id": 100 + i, "tag_name": t, "draft": "draft" in rest, "prerelease": pre == "1",
      "assets": assets, "body": "Jackdaw Mail desktop." + ("\n\n<!-- jackdaw:hold -->" if hold == "1" else ""),
      "published_at": None if "draft" in rest else (now - datetime.timedelta(hours=float(hours))).strftime("%Y-%m-%dT%H:%M:%SZ"),
      "_latest": t == latest})
print(json.dumps(rel))
EOF
  rm -f "$FAKE_STATE.log"
}
latest_now() { jq -r '.[] | select(._latest) | .tag_name' "$FAKE_STATE"; }
expect() { # описание, ожидаемое, фактическое
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: ждали '$2', получили '$3'"; FAIL=1; fi
}
run() { GITHUB_OUTPUT="$D/out" bash "$SCRIPT" "$@" 2>&1; }

fixture v0.10.320:0:30:0 latest=v0.10.320
run auto >/dev/null; expect "нет пробных — основной не меняется" v0.10.320 "$(latest_now)"

fixture v0.10.320:0:30:0 v0.10.321:1:5:0 latest=v0.10.320
run auto >/dev/null; expect "пробный моложе 24 ч не продвигается" v0.10.320 "$(latest_now)"

fixture v0.10.320:0:50:0 v0.10.321:1:25:0 v0.10.322:1:2:0 latest=v0.10.320
run auto >/dev/null; expect "выдержанный продвигается, свежий нет" v0.10.321 "$(latest_now)"
expect "321 больше не prerelease" false "$(jq -r '.[] | select(.tag_name=="v0.10.321") | .prerelease' "$FAKE_STATE")"

fixture v0.10.320:0:50:0 v0.10.321:1:25:1 latest=v0.10.320
run auto >/dev/null; expect "остановленный не продвигается" v0.10.320 "$(latest_now)"

fixture v0.10.320:0:80:0 v0.10.321:1:50:0 v0.10.322:1:40:1 v0.10.323:1:30:0 latest=v0.10.320
run auto >/dev/null; expect "после остановленного продвигается более новый выдержанный" v0.10.323 "$(latest_now)"

fixture v0.10.320:0:80:0 v0.10.321:1:50:0 v0.10.322:1:40:1 v0.10.323:1:3:0 latest=v0.10.320
run auto >/dev/null; expect "старее остановленного не продвигается" v0.10.320 "$(latest_now)"

fixture v0.10.320:0:80:0 v0.10.321:1:30:0:nomanifest latest=v0.10.320
run auto >/dev/null; expect "без манифеста не продвигается" v0.10.320 "$(latest_now)"

fixture v0.10.320:0:80:0 v0.10.321:1:30:0:draft latest=v0.10.320
run auto >/dev/null; expect "черновик не продвигается" v0.10.320 "$(latest_now)"

fixture v0.10.320:0:80:0 v0.10.321:1:1:0 latest=v0.10.320
run promote >/dev/null; expect "срочное продвижение без выдержки" v0.10.321 "$(latest_now)"
expect "promoted в GITHUB_OUTPUT" "promoted=v0.10.321" "$(tail -n 1 "$D/out")"

fixture v0.10.320:0:80:0 v0.10.321:1:1:1 latest=v0.10.320
run promote >/dev/null; expect "promote без тега не берёт остановленный" v0.10.320 "$(latest_now)"
run promote v0.10.321 >/dev/null; expect "promote с тегом берёт и остановленный" v0.10.321 "$(latest_now)"

fixture v0.10.320:0:80:0 v0.10.321:0:5:0 latest=v0.10.321
run promote v0.10.320 >/dev/null; expect "promote не понижает версию" v0.10.321 "$(latest_now)"

fixture v0.10.320:0:80:0 v0.10.321:1:2:0 latest=v0.10.320
run hold >/dev/null
expect "hold ставит метку" true "$(jq -r '.[] | select(.tag_name=="v0.10.321") | .body | contains("jackdaw:hold")' "$FAKE_STATE")"
run resume >/dev/null
expect "resume снимает метку" "Jackdaw Mail desktop." "$(jq -r '.[] | select(.tag_name=="v0.10.321") | .body' "$FAKE_STATE")"
run hold v0.10.320 >/dev/null; expect "hold основного отказывает" "" "$(cat "$FAKE_STATE.log" 2>/dev/null | grep 'v0.10.320' || true)"

fixture v0.10.318:0:200:0 v0.10.319:0:100:0 v0.10.320:0:50:0 v0.10.321:1:2:0 latest=v0.10.320
run rollback >/dev/null; expect "rollback на прошлый" v0.10.319 "$(latest_now)"
expect "откатанный стал prerelease" true "$(jq -r '.[] | select(.tag_name=="v0.10.320") | .prerelease' "$FAKE_STATE")"
expect "откатанный остановлен" true "$(jq -r '.[] | select(.tag_name=="v0.10.320") | .body | contains("jackdaw:hold")' "$FAKE_STATE")"
run auto >/dev/null; expect "после rollback auto не возвращает плохой и старше его" v0.10.319 "$(latest_now)"

fixture v0.10.318:0:200:0 v0.10.319:0:100:0 v0.10.320:0:50:0 latest=v0.10.320
run rollback v0.10.318 >/dev/null; expect "rollback на тег" v0.10.318 "$(latest_now)"

fixture v0.10.320:0:50:0 latest=v0.10.320
run rollback >/dev/null; expect "rollback без прошлого отказывает" v0.10.320 "$(latest_now)"

fixture v0.10.319:0:100:0 v0.10.320:0:50:0 v0.10.321:1:30:0 v0.10.322:1:3:1 latest=v0.10.320
echo "--- status:"; run status
exit $FAIL
