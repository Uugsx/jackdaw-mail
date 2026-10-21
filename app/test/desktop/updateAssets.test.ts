import { describe, expect, test } from "vitest";
import { pickMacDmgAsset } from "../../../desktop/backend/updateAssets";

describe("DMG для обновления Mac", () => {
  test("в релизе после перезапуска сборки берёт DMG новой версии, а не прошлой", () => {
    // Порядок как в релизе v0.9.126-dev.20261021044530: старый DMG от carry-forward идёт первым
    let assets = [
      { name: "Jackdaw-Mail-0.9.126-dev.20261020135057-universal-mac.zip" },
      { name: "jackdaw-mail-0.9.126-dev.20261020135057.dmg" },
      { name: "jackdaw-mail-0.9.126-dev.20261020135057.dmg.blockmap" },
      { name: "jackdaw-mail-0.9.126-dev.20261021044530.dmg" },
      { name: "jackdaw-mail-0.9.126-dev.20261021044530-setup.exe" },
    ];
    expect(pickMacDmgAsset(assets, "0.9.126-dev.20261021044530")?.name)
      .toBe("jackdaw-mail-0.9.126-dev.20261021044530.dmg");
    expect(pickMacDmgAsset(assets, "v0.9.126-dev.20261021044530")?.name)
      .toBe("jackdaw-mail-0.9.126-dev.20261021044530.dmg");
  });

  test("не ставит DMG другой версии, если нужного нет", () => {
    let assets = [{ name: "jackdaw-mail-0.9.126-dev.20261020135057.dmg" }];
    expect(pickMacDmgAsset(assets, "0.9.126-dev.20261021044530")).toBeNull();
  });

  test("единственный DMG без версии в имени подходит", () => {
    expect(pickMacDmgAsset([{ name: "Jackdaw-Mail.dmg" }, { name: "latest-mac.yml" }], "1.0.0")?.name)
      .toBe("Jackdaw-Mail.dmg");
    expect(pickMacDmgAsset([{ name: "latest-mac.yml" }], "1.0.0")).toBeNull();
  });
});
