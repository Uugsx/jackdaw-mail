import dns from "node:dns/promises";
import net from "node:net";

/**
 * Адреса самого компьютера и служебные адреса облака: запрос из письма туда
 * обратился бы к локальным сервисам пользователя (SSRF). Адреса локальной сети
 * не запрещаем — корпоративная почта ссылается на картинки во внутренней сети.
 */
export function isLocalOrLinkLocalAddress(address: string): boolean {
  let ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  let mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    ip = mapped[1];
  }
  if (net.isIPv4(ip)) {
    let [a, b] = ip.split(".").map(Number);
    return a == 127 || a == 0 || (a == 169 && b == 254);
  }
  if (net.isIPv6(ip)) {
    return ip == "::1" || ip == "::" || /^fe[89ab]/.test(ip);
  }
  return false;
}

/** Можно ли загружать по этому адресу: имя разрешается, и ни один из адресов не локальный */
export async function isPublicFetchHost(hostname: string): Promise<boolean> {
  let host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host == "localhost" || host.endsWith(".localhost")) {
    return false;
  }
  if (net.isIP(host)) {
    return !isLocalOrLinkLocalAddress(host);
  }
  try {
    let addresses = await dns.lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(each => !isLocalOrLinkLocalAddress(each.address));
  } catch {
    return false;
  }
}
