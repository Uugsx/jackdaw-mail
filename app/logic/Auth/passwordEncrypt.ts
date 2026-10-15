import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { encrypt, decrypt } from 'password-salt';
import { appGlobal } from "../app";
import { isMobile, webMail } from "../build";

/** Префикс значений, зашифрованных средствами ОС (Electron safeStorage). */
export const kSafePrefix = "safe:";

/** Устаревший формат: password-salt с общим ключом. Только для чтения старых данных и
 * для мобильной сборки / webmail, где нет safeStorage. */
const secret = 'anything'; // Lib adds a 32-byte salt, which acts as password
// 32^256 values should be sufficient against rainbow tables

/** Значение сохранено в устаревшем формате и его стоит перешифровать */
export function isLegacyEncrypted(encrypted: string | null | undefined): boolean {
  return !!encrypted && !encrypted.startsWith(kSafePrefix);
}

/** Шифрование ОС есть только в десктопной сборке, и не на каждой платформе */
export async function canEncryptWithOS(): Promise<boolean> {
  if (isMobile || webMail) {
    return false;
  }
  try {
    return !!(await appGlobal.remoteApp?.isSecretEncryptionAvailable());
  } catch (ex) {
    return false;
  }
}

/**
 * @returns расшифрованный пароль.
 *   Если значение в формате safeStorage и ОС отказала в расшифровке
 *   (например, пользователь запретил доступ к Keychain, или профиль ОС другой),
 *   возвращает null, чтобы аккаунт не терялся, а пароль был запрошен заново.
 */
export async function passwordDecrypt(encrypted: string | null | undefined): Promise<string | null> {
  if (encrypted != null && encrypted.startsWith(kSafePrefix)) {
    try {
      let plain = await appGlobal.remoteApp.decryptSecret(encrypted.substring(kSafePrefix.length));
      return sanitize.string(plain, null);
    } catch (ex) {
      console.error("Could not decrypt the saved password, it needs to be entered again", ex);
      return null;
    }
  }
  return encrypted != null ? sanitize.string(await decrypt(secret, encrypted) as string, null) : null;
}

export async function passwordEncrypt(password: string | null | undefined): Promise<string | null> {
  if (password == null) {
    return null;
  }
  if (await canEncryptWithOS()) {
    try {
      return kSafePrefix + await appGlobal.remoteApp.encryptSecret(password);
    } catch (ex) {
      // Лучше сохранить пароль по-старому, чем потерять его
      console.error("OS encryption of the password failed, using legacy format", ex);
    }
  }
  return await encrypt(secret, password);
}
