/**
 * Зеркало обновлений на нашем сервере. GitHub остаётся источником правды:
 * манифест (`latest*.yml`) с контрольными суммами клиент всегда берёт у GitHub,
 * а зеркало отдаёт только байты установщика, которые затем сверяются с этой суммой.
 */

export const kDefaultUpdateMirrorBase = "https://jackdaw-mail.pro/updates/";

/** Сколько зеркало может молчать, прежде чем перейти на GitHub. */
export const kMirrorStallTimeoutMs = 20_000;

/**
 * Базовый URL зеркала. `JACKDAW_UPDATE_MIRROR=off` отключает зеркало,
 * другое значение — подмена адреса (проверки и отладка). Только https или localhost.
 */
export function resolveUpdateMirrorBase(env: Record<string, string | undefined> = process.env): string | null {
  let raw = env.JACKDAW_UPDATE_MIRROR?.trim();
  if (raw?.toLowerCase() == "off") {
    return null;
  }
  let base = raw || kDefaultUpdateMirrorBase;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  let local = url.hostname == "localhost" || url.hostname == "127.0.0.1" || url.hostname == "[::1]";
  if (url.protocol != "https:" && !(local && url.protocol == "http:")) {
    return null;
  }
  return url.href.endsWith("/") ? url.href : url.href + "/";
}

/** URL файла обновления на зеркале; имя берётся из последнего сегмента исходного URL. */
export function mirrorUrlFor(fileName: string, base: string): string {
  let name = fileName.split(/[\\/]/).pop() ?? "";
  return new URL(encodeURIComponent(decodeURIComponent(name)), base).href;
}

type ResolvedFile = { url: URL; info: unknown };
type ProviderLike = { resolveFiles: (info: any) => ResolvedFile[] };

/**
 * Подменяет адреса файлов в провайдере electron-updater на зеркало.
 * Контрольные суммы (`info`) остаются из манифеста GitHub.
 *
 * @returns функция отката к GitHub
 */
export function applyMirrorToProvider(provider: ProviderLike, base: string): () => void {
  let original = provider.resolveFiles;
  provider.resolveFiles = function (this: unknown, info: unknown) {
    return original.call(provider, info).map(file => ({
      ...file,
      url: new URL(mirrorUrlFor(decodeURIComponent(file.url.pathname), base)),
    }));
  };
  return () => {
    provider.resolveFiles = original;
  };
}
