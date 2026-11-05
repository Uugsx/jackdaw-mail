import { describe, expect, test } from "vitest";
import { applyMirrorToProvider, kDefaultUpdateMirrorBase, mirrorUrlFor, resolveUpdateMirrorBase } from "../../../desktop/backend/updateMirror";

describe("зеркало обновлений", () => {
  test("по умолчанию — наш сервер, off отключает", () => {
    expect(resolveUpdateMirrorBase({})).toBe(kDefaultUpdateMirrorBase);
    expect(resolveUpdateMirrorBase({ JACKDAW_UPDATE_MIRROR: "off" })).toBeNull();
  });

  test("подмена адреса: только https или localhost", () => {
    expect(resolveUpdateMirrorBase({ JACKDAW_UPDATE_MIRROR: "http://evil.example/u" })).toBeNull();
    expect(resolveUpdateMirrorBase({ JACKDAW_UPDATE_MIRROR: "not a url" })).toBeNull();
    expect(resolveUpdateMirrorBase({ JACKDAW_UPDATE_MIRROR: "http://127.0.0.1:9000/u" })).toBe("http://127.0.0.1:9000/u/");
  });

  test("имя файла берётся из последнего сегмента и кодируется", () => {
    expect(mirrorUrlFor("jackdaw-mail-1.0.0-dev.1.dmg", "https://m.test/updates/"))
      .toBe("https://m.test/updates/jackdaw-mail-1.0.0-dev.1.dmg");
    expect(mirrorUrlFor("a/b/Jackdaw Mail-setup.exe", "https://m.test/updates/"))
      .toBe("https://m.test/updates/Jackdaw%20Mail-setup.exe");
  });

  test("провайдер: адреса на зеркало, суммы прежние, откат возвращает GitHub", () => {
    let info = { sha512: "abc" };
    let provider = {
      resolveFiles: () => [{ url: new URL("https://github.com/Uugsx/jackdaw-mail/releases/download/v1/jackdaw-mail-1-setup.exe"), info }],
    };
    let restore = applyMirrorToProvider(provider, "https://m.test/updates/");
    let [file] = provider.resolveFiles();
    expect(file.url.href).toBe("https://m.test/updates/jackdaw-mail-1-setup.exe");
    expect(file.info).toBe(info);
    restore();
    expect(provider.resolveFiles()[0].url.hostname).toBe("github.com");
  });
});
