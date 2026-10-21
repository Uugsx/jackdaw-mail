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
