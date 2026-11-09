/** Заголовки MIME длиннее не бывают на практике; дальше — тело письма. */
export const kMaxHeaderBytes = 64 * 1024;

/** Message-ID без угловых скобок и в нижнем регистре; пустой — null. */
export function normalizeMessageID(id: string | null | undefined): string | null {
  let value = id?.trim().replace(/^<|>$/g, "").toLowerCase();
  return value || null;
}

/** Message-ID из заголовков MIME или null, если заголовка нет. */
export function mimeMessageID(mime: Uint8Array | string | null | undefined): string | null {
  if (!mime) {
    return null;
  }
  let head = typeof mime == "string"
    ? mime.slice(0, kMaxHeaderBytes)
    : new TextDecoder("latin1").decode(mime.subarray(0, kMaxHeaderBytes));
  let end = head.search(/\r?\n\r?\n/);
  if (end >= 0) {
    head = head.slice(0, end);
  }
  let match = /^Message-ID:[ \t]*(?:\r?\n[ \t]+)?(<[^>\r\n]*>|\S+)/im.exec(head);
  return normalizeMessageID(match?.[1]);
}
