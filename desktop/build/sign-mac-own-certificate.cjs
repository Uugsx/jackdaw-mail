// Хук electron-builder afterSign: переподписывает .app своим сертификатом подписи кода
// до сборки DMG/zip/pkg. Сертификат не от Apple, поэтому Gatekeeper при первой установке
// всё равно предупреждает, но требование подписи (designated requirement) одинаково во всех
// сборках, и Связка ключей не спрашивает доступ после каждого обновления.
//
// Включается переменными окружения (их выставляет CI, см. publish-desktop-jackdaw.yml):
//   JACKDAW_MAC_SIGN_IDENTITY — имя сертификата в связке;
//   JACKDAW_MAC_SIGN_KEYCHAIN — путь к связке с сертификатом (необязательно).
// Без JACKDAW_MAC_SIGN_IDENTITY хук ничего не делает: остаётся ad-hoc-подпись, и приложение
// само не включает Связку ключей (backend.ts, isMacCertificateSigned).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function signWithOwnCertificate(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const identity = process.env.JACKDAW_MAC_SIGN_IDENTITY;
  if (!identity) {
    return;
  }
  // Промежуточные сборки x64/arm64 для universal: подписываем только итоговую
  if (/-temp$/.test(context.appOutDir)) {
    return;
  }
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const entitlements = path.join(__dirname, "entitlements.mac.plist");
  const args = ["--force", "--deep", "--options", "runtime", "--timestamp=none", "--entitlements", entitlements, "--sign", identity];
  const keychain = process.env.JACKDAW_MAC_SIGN_KEYCHAIN;
  if (keychain) {
    args.push("--keychain", keychain);
  }
  execFileSync("/usr/bin/codesign", [...args, appPath], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  const requirement = execFileSync("/usr/bin/codesign", ["-d", "-r-", appPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!/designated => .*certificate leaf/.test(requirement)) {
    throw new Error(`Подпись своим сертификатом не применилась: ${requirement}`);
  }
};
