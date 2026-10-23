// @vitest-environment happy-dom
import { scheduleSendPresets } from "../../../../frontend/Mail/Scheduled/pickScheduleSendTime";
import { describe, expect, test } from "vitest";

function local(text: string): Date {
  return new Date(text);
}

describe("«Отправить позже»: быстрый выбор", () => {
  test("в пятницу: завтра 8:00 и 13:00, понедельник 8:00", () => {
    let presets = scheduleSendPresets(local("2026-10-23T17:40:00"));
    expect(presets.map(preset => [preset.key, preset.at])).toEqual([
      ["tomorrowMorning", local("2026-10-24T08:00:00")],
      ["tomorrowAfternoon", local("2026-10-24T13:00:00")],
      ["mondayMorning", local("2026-10-26T08:00:00")],
    ]);
  });

  test("в понедельник «понедельник утром» — следующий понедельник", () => {
    let presets = scheduleSendPresets(local("2026-10-26T07:00:00"));
    expect(presets.find(preset => preset.key == "mondayMorning")?.at).toEqual(local("2026-11-02T08:00:00"));
  });

  test("в воскресенье повтор «завтра утром» убран", () => {
    let presets = scheduleSendPresets(local("2026-10-25T20:00:00"));
    expect(presets.map(preset => preset.key)).toEqual(["tomorrowMorning", "tomorrowAfternoon"]);
  });

  test("через конец месяца", () => {
    let presets = scheduleSendPresets(local("2026-10-31T09:00:00"));
    expect(presets[0].at).toEqual(local("2026-11-01T08:00:00"));
  });
});
