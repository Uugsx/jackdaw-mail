import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appGlobal } from "../../../logic/app";
import { passwordEncrypt, passwordDecrypt, kSafePrefix, isLegacyEncrypted } from "../../../logic/Auth/passwordEncrypt";
import { getPassword, setPassword, deletePassword } from "../../../logic/Auth/passwordLocalStorage";

let originalRemoteApp: any;
let store: Map<string, string>;
let originalLocalStorage: PropertyDescriptor | undefined;
let storage: Storage;

/** Имитация safeStorage: «шифртекст» = reverse(base64) */
function fakeRemoteApp(overrides: any = {}) {
  return {
    isSecretEncryptionAvailable: vi.fn(() => true),
    encryptSecret: vi.fn((plain: string) => Buffer.from(plain).toString("base64").split("").reverse().join("")),
    decryptSecret: vi.fn((enc: string) => Buffer.from(enc.split("").reverse().join(""), "base64").toString()),
    ...overrides,
  };
}

beforeEach(() => {
  originalRemoteApp = appGlobal.remoteApp;
  store = new Map();
  storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  } as Storage;
  originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    delete (globalThis as any).localStorage;
  }
  appGlobal.remoteApp = originalRemoteApp;
  vi.restoreAllMocks();
});

/** Значение в старом формате, как его писала прежняя версия */
async function legacyValue(password: string): Promise<string> {
  appGlobal.remoteApp = undefined;
  let legacy = await passwordEncrypt(password);
  return legacy!;
}

test("новые значения шифруются через ОС и получают префикс", async () => {
  appGlobal.remoteApp = fakeRemoteApp();
  let encrypted = await passwordEncrypt("hunter2");
  expect(encrypted!.startsWith(kSafePrefix)).toBe(true);
  expect(encrypted).not.toContain("hunter2");
  expect(await passwordDecrypt(encrypted)).toBe("hunter2");
});

test("без шифрования ОС (webmail, mobile, macOS) остаётся старый формат", async () => {
  appGlobal.remoteApp = fakeRemoteApp({ isSecretEncryptionAvailable: () => false });
  let encrypted = await passwordEncrypt("hunter2");
  expect(isLegacyEncrypted(encrypted)).toBe(true);
  expect(await passwordDecrypt(encrypted)).toBe("hunter2");
});

test("null остаётся null", async () => {
  appGlobal.remoteApp = fakeRemoteApp();
  expect(await passwordEncrypt(null)).toBeNull();
  expect(await passwordDecrypt(null)).toBeNull();
});

test("ошибка encryptSecret не теряет пароль: запись в старом формате", async () => {
  appGlobal.remoteApp = fakeRemoteApp({ encryptSecret: () => { throw new Error("denied"); } });
  let encrypted = await passwordEncrypt("hunter2");
  expect(isLegacyEncrypted(encrypted)).toBe(true);
  expect(await passwordDecrypt(encrypted)).toBe("hunter2");
});

test("отказ расшифровки (Keychain) даёт null без падения", async () => {
  appGlobal.remoteApp = fakeRemoteApp({ decryptSecret: () => { throw new Error("Keychain denied"); } });
  expect(await passwordDecrypt(kSafePrefix + "AAAA")).toBeNull();
});

test("старое значение читается и прозрачно перешифровывается в localStorage", async () => {
  store.set("password.acc1", await legacyValue("old-pass"));
  appGlobal.remoteApp = fakeRemoteApp();

  expect(await getPassword("acc1")).toBe("old-pass");
  expect(store.get("password.acc1")!.startsWith(kSafePrefix)).toBe(true);
  expect(await getPassword("acc1")).toBe("old-pass"); // уже из нового формата
});

test("старое значение не трогается, если шифрования ОС нет", async () => {
  let legacy = await legacyValue("old-pass");
  store.set("password.acc1", legacy);
  appGlobal.remoteApp = fakeRemoteApp({ isSecretEncryptionAvailable: () => false });

  expect(await getPassword("acc1")).toBe("old-pass");
  expect(store.get("password.acc1")).toBe(legacy);
});

test("ошибка перешифровки не мешает прочитать старый пароль", async () => {
  let legacy = await legacyValue("old-pass");
  store.set("password.acc1", legacy);
  appGlobal.remoteApp = fakeRemoteApp();
  storage.setItem = () => { throw new Error("quota"); };

  expect(await getPassword("acc1")).toBe("old-pass");
  expect(store.get("password.acc1")).toBe(legacy);
});

test("отказ Keychain при чтении: null, значение в хранилище сохраняется", async () => {
  appGlobal.remoteApp = fakeRemoteApp();
  await setPassword("acc1", "pass");
  let saved = store.get("password.acc1");
  appGlobal.remoteApp = fakeRemoteApp({ decryptSecret: () => { throw new Error("denied"); } });

  expect(await getPassword("acc1")).toBeNull();
  expect(store.get("password.acc1")).toBe(saved);
});

test("setPassword с пустым значением удаляет запись", async () => {
  appGlobal.remoteApp = fakeRemoteApp();
  await setPassword("acc1", "pass");
  await setPassword("acc1", null);
  expect(store.has("password.acc1")).toBe(false);
  await deletePassword("acc1");
});
