/** Split compose HTML into the TipTap reply and the separately editable quote. */
export function splitComposeQuote(html: string | null | undefined): { editable: string; quote: string } {
  let body = html ?? "";
  // Режем по САМОМУ РАННЕМУ маркеру: строка «X написал:» может встретиться внутри
  // цитируемого письма, а пересылаемое письмо (после <hr> и заголовка пересылки)
  // само может содержать <blockquote>. Иначе подпись вставлялась внутрь цитаты.
  let markers = [
    body.search(/<p\b[^>]*\bclass=(["'])quote-header\1/i),
    body.search(/<blockquote\b/i),
    body.search(/<hr\b[^>]*>\s*<p\b[^>]*\bclass=(["'])forward-header\1/i),
  ].filter(index => index >= 0);
  if (markers.length) {
    let cut = Math.min(...markers);
    return {
      editable: body.slice(0, cut),
      quote: body.slice(cut),
    };
  }
  let hrMatch = body.match(/<hr\b[^>]*\s*\/?>[\s\S]*$/i);
  if (hrMatch?.index != null) {
    return {
      editable: body.slice(0, hrMatch.index),
      quote: body.slice(hrMatch.index),
    };
  }
  return { editable: body, quote: "" };
}

export function mergeComposeQuote(editable: string | null | undefined, quote: string): string {
  return (editable ?? "") + (quote ?? "");
}

export function hasComposeQuote(html: string | null | undefined): boolean {
  return !!splitComposeQuote(html).quote;
}

export function extractBlockquoteInner(quoteHtml: string): string | null {
  let match = quoteHtml.match(/<blockquote\b[^>]*>([\s\S]*)<\/blockquote>/i);
  return match ? match[1].trim() : null;
}

/** HTML shown in the editable quote block (reply body vs full forward quote). */
export function quoteDisplayBody(
  quoteHtml: string,
  sourceHtml: string | null | undefined,
  isReply: boolean,
): string {
  if (isReply && sourceHtml) {
    return sourceHtml;
  }
  let inner = extractBlockquoteInner(quoteHtml);
  if (inner != null) {
    return inner;
  }
  return quoteHtml;
}

/** Apply user edits from the quote editor back into the stored quote HTML. */
export function applyQuoteBodyEdit(
  composeQuoteHtml: string,
  editedBodyHtml: string,
  isReply: boolean,
): string {
  if (isReply && /<blockquote\b/i.test(composeQuoteHtml)) {
    return composeQuoteHtml.replace(
      /(<blockquote\b[^>]*>)([\s\S]*)(<\/blockquote>)/i,
      (_, open, _inner, close) => `${open}\n      ${editedBodyHtml}\n    ${close}`,
    );
  }
  if (/<blockquote\b/i.test(composeQuoteHtml)) {
    return composeQuoteHtml.replace(
      /(<blockquote\b[^>]*>)([\s\S]*)(<\/blockquote>)/i,
      (_, open, _inner, close) => `${open}\n      ${editedBodyHtml}\n    ${close}`,
    );
  }
  return editedBodyHtml;
}
