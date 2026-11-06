#!/usr/bin/env bash
# Создаёт свой сертификат подписи кода для Mac-сборок Jackdaw Mail и кладёт его в секреты
# GitHub Actions (JACKDAW_MAC_SIGN_P12, JACKDAW_MAC_SIGN_P12_PASSWORD).
#
# Запускать один раз владельцу репозитория: bash desktop/scripts/mac-signing/create-self-signed-cert.sh
# Нужны openssl и gh (gh auth login с правом на секреты репозитория).
#
# Копия сертификата с ключом сохраняется в ~/Documents/Jackdaw-signing/. Её нужно хранить:
# новый сертификат — это другая подпись, и после такого обновления каждый пользователь Mac
# один раз увидит запрос Связки ключей. Секретный ключ никому не передавать и не коммитить.
set -euo pipefail

repo="${JACKDAW_REPO:-Uugsx/jackdaw-mail}"
out="$HOME/Documents/Jackdaw-signing"
name="Jackdaw Mail Self-Signed"

if [ -e "$out/jackdaw-mac-signing.p12" ]; then
  echo "Сертификат уже есть: $out/jackdaw-mac-signing.p12"
  echo "Чтобы загрузить его в GitHub заново, удалите строку проверки или загрузите вручную."
  exit 1
fi
command -v gh >/dev/null || { echo "Нужен gh: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Сначала: gh auth login"; exit 1; }

mkdir -p "$out"
chmod 700 "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat > "$work/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF

# 30 лет: сертификат не должен истечь, пока программа живёт
openssl req -x509 -newkey rsa:3072 -nodes -days 10950 -config "$work/cert.cnf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
openssl rand -hex 24 > "$out/p12-password.txt"
# -legacy: формат, который понимает `security import` на macOS
openssl pkcs12 -export -legacy -inkey "$work/key.pem" -in "$work/cert.pem" -name "$name" \
  -out "$out/jackdaw-mac-signing.p12" -passout "file:$out/p12-password.txt" 2>/dev/null
cp "$work/cert.pem" "$out/jackdaw-mac-signing-cert.pem"
chmod 600 "$out"/*

base64 < "$out/jackdaw-mac-signing.p12" | tr -d '\n' | gh secret set JACKDAW_MAC_SIGN_P12 -R "$repo"
tr -d '\n' < "$out/p12-password.txt" | gh secret set JACKDAW_MAC_SIGN_P12_PASSWORD -R "$repo"

echo "Готово. Секреты JACKDAW_MAC_SIGN_P12 и JACKDAW_MAC_SIGN_P12_PASSWORD загружены в $repo."
echo "Резервная копия: $out — сохраните её в надёжном месте (например, в менеджере паролей)."
