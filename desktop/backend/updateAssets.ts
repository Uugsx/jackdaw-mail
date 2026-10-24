export type ReleaseAssetName = { name: string };

/**
 * DMG для обновления Mac на версию `version`.
 *
 * В релизе может оказаться несколько DMG: если сборка Mac упала и её
 * перезапустили, carry-forward успевает положить DMG прошлой версии.
 * Первый попавшийся DMG тогда ставил ту же старую версию, и приложение
 * бесконечно предлагало «обновиться». Поэтому берём DMG ровно этой версии.
 *
 * @returns подходящий файл, или `null`, если однозначно выбрать нельзя
 */
export function pickMacDmgAsset<T extends ReleaseAssetName>(assets: T[], version: string): T | null {
  let bareVersion = version.replace(/^v/, "");
  let dmgs = assets.filter(asset => asset.name.endsWith(".dmg") && /jackdaw/i.test(asset.name));
  let exact = dmgs.find(asset => asset.name.endsWith(`-${bareVersion}.dmg`));
  if (exact) {
    return exact;
  }
  // Имя без версии: подходит, только если DMG в релизе один
  return dmgs.length == 1 && !/\d+\.\d+\.\d+/.test(dmgs[0].name) ? dmgs[0] : null;
}

export type UpdateFileInfo = { url: string; sha512?: string };

/**
 * sha512 (base64) файла обновления из `latest-mac.yml`.
 * Сборка Mac без подписи Apple, поэтому DMG сверяется с манифестом,
 * прежде чем скрипт установки заменит приложение.
 *
 * @returns sha512 или `null`, если файла в манифесте нет
 */
export function expectedSha512ForAsset(files: UpdateFileInfo[] | null | undefined, assetName: string): string | null {
  let file = (files ?? []).find(each => {
    let name = each.url.split(/[\\/]/).pop() ?? "";
    return name.toLowerCase() == assetName.toLowerCase();
  });
  return file?.sha512 || null;
}

/** Совпадает ли sha512 (base64) содержимого с ожидаемым */
export function isSha512Match(actualBase64: string, expectedBase64: string | null): boolean {
  return !!expectedBase64 && actualBase64 == expectedBase64;
}
