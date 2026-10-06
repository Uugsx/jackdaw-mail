import { normalizeMailLinkURL } from "../../../logic/Mail/SignatureHTML";

const EXTERNAL_LINK_PROTOCOL = /^(?:https?|mailto|tel):/i;

/** Возвращает безопасную ссылку, нажатую в отдельном окне композера. */
export function getComposeLinkURL(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }
  let link = target.closest<HTMLAnchorElement>("a[href]");
  let url = normalizeMailLinkURL(link?.getAttribute("href"));
  return EXTERNAL_LINK_PROTOCOL.test(url) ? url : null;
}
