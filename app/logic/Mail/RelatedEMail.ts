import type { EMail } from "./EMail";
import type { Folder } from "./Folder";
import type { MailAccount } from "./MailAccount";
import type { PersonUID } from "../Abstract/PersonUID";
import { appGlobal } from "../app";
// #if [!WEBMAIL]
import { getDatabase } from "./SQL/SQLDatabase";
import { SQLEMail } from "./SQL/SQLEMail";
import { unicodeSearchVariants } from "./SQL/SQLSearchEMail";
import sql, { type Query } from "../../../lib/rs-sqlite";
// #endif

const kCandidateLimit = 800;
const kResultLimit = kCandidateLimit;
const kIndexedTextLength = 6000;
/** Сколько текста исходного письма разбираем на признаки: подпись и цитаты бывают глубоко. */
const kSourceTextLength = 12000;
/** Сколько текста каждого письма просматривает SQL: полный текст в разы медленнее, а признаки обычно в начале. */
const kScanTextLength = 6000;
/** По одному признаку показываем только самые свежие письма. */
const kPerFeatureLimit = 60;
/** Признак, который встречается чаще, — общий (своя компания, крупный домен), а не связь. */
const kCommonFeatureLimit = 300;
/** Тема без других признаков связывает, только если она редкая. */
const kSpecificTopicLimit = 40;
const kMinimumSpecificTopicTokens = 3;
/** Ограничение числа LIKE-шаблонов: каждый добавляет время на полный проход по почте. */
const kMaxTextFeatures = 12;
/** Домен с таким числом разных адресов — своя организация или головная компания, а не клиент. */
const kInternalDomainMinAddresses = 100;
const kInternalDomainCacheMS = 30 * 60 * 1000;
const kMinimumDuplicateBodyLength = 24;
const kMinimumTopicSubjectLength = 8;
const kMinimumSimilarSubjectTokens = 2;
const kSimilarTopicThreshold = 0.6;
const kMinimumCompanyNameLength = 3;
const kMaxWrappedAuthorLineLength = 80;
const kTechnicalErrorCodePattern = /^(?:ora|err(?:or)?|http|sqlstate|smtp|imap|pop)[-_/]\d{3,}$/iu;
const kLabeledCustomerNumberPattern = /(?<![\p{L}\p{N}])(?:и?кн|клиент(?:а|у|ом|ский|ского|скому|ским)?(?:\s+номер(?:а|у|ом|е)?)?|номер(?:а|у|ом|е)?\s+клиента|client(?:\s+(?:number|id))?|customer(?:\s+(?:number|id))?)[\s:№#-]*(\d{6,14})(?!\d)/giu;
/** Клиентские номера DPD без подписи «КН»: 10 цифр, начинаются с 100. */
const kBareCustomerNumberPattern = /(?<![\p{L}\p{N}])(100\d{7})(?![\p{N}])/gu;
/** Номер обращения «20102026-10921»: дата ДДММГГГГ и порядковый номер. */
const kTicketNumberPattern = /(?<![\p{L}\p{N}])((\d{2})(\d{2})20\d{2}-\d{3,6})(?![\p{N}-])/gu;
const kParcelNumberPattern = /(?<![\p{L}\p{N}])((?:RU|BY|KZ|AM|KG|UZ)\d{9,12})(?![\p{N}])/giu;
const kLabeledOrderPattern = /(?<![\p{L}\p{N}])(?:заказ(?:а|у|ом|е|ы|ов|ам|ах)?|накладн(?:ая|ой|ую|ые|ых)|посылк(?:а|и|у|ой|е)|отправлени(?:е|я|ю|ем|и|й)|трек(?:[- ]?номер(?:а|у|ом|е)?)?|order|parcel|shipment|tracking(?:\s+number)?|waybill)(?:\s+(?:№|#|номер|number|no\.?))?\s*[:№#]?\s*((?:[A-Za-z]{1,4}-?)?\d[\d-]{5,19})(?![\p{L}\p{N}])/giu;
const kInnPattern = /(?<![\p{L}\p{N}])инн(?:\s*\/\s*кпп)?\s*[:№]?\s*(\d{10}|\d{12})(?!\d)/giu;
const kLegalForms = "ООО|ОАО|ЗАО|ПАО|НАО|АО|ТОО|ИП|ФГУП|ГУП|МУП|LLC|Ltd|JSC|GmbH";
const kQuotedCompanyPattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(${kLegalForms})\\s*[«"“„]\\s*([^«»"“”„\\n]{2,60}?)\\s*[»"”“]`,
  "gu",
);
const kPlainCompanyPattern = /(?<![\p{L}\p{N}])(ООО|ОАО|ЗАО|ПАО|НАО|АО|ТОО)[ \t]+(\p{Lu}[\p{L}\p{N}&-]*(?:[ \t]+\p{Lu}[\p{L}\p{N}&-]*)?)/gu;
const kSoleTraderPattern = /(?<![\p{L}\p{N}])ИП[ \t]+(\p{Lu}\p{Ll}{2,})/gu;
const kEmailAddressPattern = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** Строки заголовков в цитатах и пересылках: «From: …», «От: …». */
const kQuotedHeaderPattern = /^[\s>*]*(?:from|reply-to|sender|от|отправитель)\**\s*:\**\s*(.+)$/gimu;
/** Начало чужого текста в цитате: заголовок «From:» или «…, Иван <ivan@x.ru> пишет:». */
const kQuoteAuthorLinePattern = /^[\s>*]*(?:(?:from|sender|от|отправитель)\**\s*:\**\s*(.+)|(.*(?:wrote|пишет|написал\p{L}*|<[^<>\n]*@[^<>\n]*>)\s*:))\s*$/iu;
const kReplyPrefixPattern = /^(?:\s*(?:re|fw|fwd|aw|wg|sv|tr|ha|на|ответ|отв|пересылка|переслано)\s*(?:\[\d+\])?\s*:\s*)+/iu;
const kServiceLocalPartPattern = /^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|robot|daemon)(?:[+._-].*)?$/iu;

const kPublicMailDomains = new Set([
  "gmail.com", "googlemail.com", "mail.ru", "inbox.ru", "list.ru", "bk.ru",
  "internet.ru", "xmail.ru", "yandex.ru", "yandex.com", "yandex.by", "yandex.kz",
  "yandex.ua", "ya.ru", "narod.ru", "rambler.ru", "lenta.ru", "autorambler.ru",
  "myrambler.ru", "ro.ru", "qip.ru", "outlook.com", "hotmail.com", "live.com",
  "live.ru", "msn.com", "yahoo.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.de", "gmx.net", "web.de", "mail.com",
  "zoho.com", "ukr.net", "tut.by", "mail.kz",
]);

/** Нерегистрируемые домены: внутренняя сеть и заглушки. */
const kInternalTopLevelDomains = new Set([
  "invalid", "local", "localdomain", "lan", "corp", "internal", "intranet", "home",
]);

const kStopWords = new Set([
  "а", "без", "бы", "в", "вам", "вас", "ведь", "во", "вот", "вы",
  "да", "для", "до", "его", "ее", "если", "есть", "же", "за", "из",
  "или", "им", "их", "как", "когда", "кто", "мне", "мы", "на", "над",
  "нам", "нас", "не", "нет", "ни", "но", "о", "об", "один", "от", "по",
  "под", "при", "про", "с", "со", "так", "такой", "там", "те", "тем", "то",
  "только", "у", "уже", "что", "это", "я", "about", "after", "all", "and",
  "are", "can", "for", "from", "has", "have", "how", "in", "is", "it", "of",
  "on", "or", "that", "the", "this", "to", "was", "we", "with", "you",
]);

/** Слова, из которых состоят типовые темы поддержки: сами по себе они ни о чём не говорят. */
const kGenericTopicWords = new Set([
  "вопрос", "вопросы", "вопроса", "ошибка", "ошибки", "ошибкой", "ошибок",
  "проблема", "проблемы", "проблемой", "запрос", "запроса", "обращение",
  "обращения", "заявка", "заявки", "заявке", "просьба", "информация",
  "уточнение", "помощь", "срочно", "важно", "тест", "тестирование", "api", "апи",
  "интеграция", "интеграции", "интеграцией", "заказ", "заказы", "заказа",
  "заказов", "создание", "создании", "статус", "статусы", "статуса", "новый",
  "новая", "письмо", "ответ", "error", "errors", "problem",
  "issue", "question", "request", "help", "test", "order", "orders", "dpd", "дпд",
]);

export type RelatedMailReason =
  | "duplicate"
  | "same-thread"
  | "same-identifier"
  | "same-contact"
  | "same-company"
  | "same-domain"
  | "same-topic"
  | "similar-topic";

/** Признак, по которому письмо связано с открытым. Порядок — от сильного к слабому. */
export type RelatedMailFeatureKind =
  | "duplicate"
  | "thread"
  | "ticket"
  | "customer"
  | "order"
  | "inn"
  | "address"
  | "company"
  | "reference"
  | "domain"
  | "subject";

export interface RelatedMailFeature {
  kind: RelatedMailFeatureKind;
  /** Нормализованное значение для сравнения */
  value: string;
  /** Значение для показа */
  label: string;
}

const kFeatureWeights: Record<RelatedMailFeatureKind, number> = {
  duplicate: 100,
  thread: 95,
  ticket: 90,
  customer: 85,
  order: 80,
  inn: 78,
  address: 70,
  company: 60,
  reference: 55,
  domain: 35,
  subject: 15,
};

/** Признаки, которые ищутся по тексту письма (тема + начало текста). */
const kTextFeatureKinds = new Set<RelatedMailFeatureKind>([
  "ticket", "customer", "order", "inn", "company", "reference",
]);

/** Частые значения этих признаков отбрасываются: это своя компания или общий шаблон. */
const kDroppableCommonKinds = new Set<RelatedMailFeatureKind>([
  "company", "reference", "domain",
]);

export interface RelatedMailParticipant {
  emailAddress?: string | null;
  name?: string | null;
}

export interface RelatedMailText {
  messageID?: string | null;
  inReplyTo?: string | null;
  threadID?: string | null;
  references?: string[] | null;
  subject?: string | null;
  body?: string | null;
  contactEmail?: string | null;
  /** Адрес отправителя: чей текст в начале письма */
  authorEmail?: string | null;
  /** Отправитель, ответить-кому, получатели. Если не заданы, используется `contactEmail`. */
  participants?: RelatedMailParticipant[] | null;
  sentAt?: number | null;
}

/** Свои адреса и домены: по ним письма не связываются. */
export interface RelatedMailContext {
  ownAddresses?: Iterable<string>;
  internalDomains?: Iterable<string>;
}

export interface RelatedMailSignal {
  reason: RelatedMailReason;
  score: number;
  sharedIdentifiers: string[];
  /** Все общие признаки, от сильного к слабому */
  features: RelatedMailFeature[];
}

export interface RelatedMailMatch {
  email: EMail;
  reason: RelatedMailReason;
  score: number;
  sharedIdentifiers: string[];
  features?: RelatedMailFeature[];
}

export type RelatedMailGroupKind = "identifier" | "conversation" | "contact" | "topic";

export interface RelatedMailGroup {
  key: string;
  kind: RelatedMailGroupKind;
  /** Признак группы, если письма найдены по признакам */
  feature?: RelatedMailFeatureKind;
  label: string;
  matches: RelatedMailMatch[];
}

/**
 * Группирует найденные письма по самому сильному общему признаку.
 * Письмо попадает ровно в одну группу; остальные признаки видны на нём пометками.
 */
export function groupRelatedMailMatches(matches: RelatedMailMatch[]): RelatedMailGroup[] {
  const groups = new Map<string, RelatedMailGroup>();
  for (const match of matches) {
    const primary = match.features?.[0];
    let group: RelatedMailGroup;
    if (primary) {
      const key = `${primary.kind}:${primary.value}`;
      group = groups.get(key) ?? {
        key,
        kind: groupKindForFeature(primary.kind),
        feature: primary.kind,
        label: primary.label,
        matches: [],
      };
      groups.set(key, group);
      group.matches.push(match);
      continue;
    }
    const subject = compactRelatedSubject(match.email.subject);
    const identifier = match.sharedIdentifiers[0];
    const threadID = match.email.threadID;
    let kind: RelatedMailGroupKind;
    let label: string;
    let key: string;
    if (identifier) {
      kind = "identifier";
      label = identifier;
      key = `identifier:${identifier}`;
    } else if (match.reason == "same-thread" && threadID) {
      kind = "conversation";
      label = subject;
      key = `conversation:${threadID}`;
    } else {
      kind = "topic";
      label = subject;
      key = `topic:${normalizeRelatedSubject(subject) || "no-subject"}`;
    }
    group = groups.get(key) ?? { key, kind, label, matches: [] };
    groups.set(key, group);
    group.matches.push(match);
  }
  return [...groups.values()];
}

function groupKindForFeature(kind: RelatedMailFeatureKind): RelatedMailGroupKind {
  switch (kind) {
    case "duplicate":
    case "thread":
      return "conversation";
    case "address":
    case "company":
    case "domain":
      return "contact";
    case "subject":
      return "topic";
    default:
      return "identifier";
  }
}

/** Removes reply/forward prefixes while preserving the actual subject. */
export function normalizeRelatedSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .normalize("NFKC")
    .replace(/^(?:(?:re|fw|fwd|aw|ответ|пересылка)\s*:\s*)+/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

/**
 * Суть темы для сравнения: без RE:/FW:/На:, номеров обращений, КН и накладных.
 * «RE: ошибка 500. КН 1001011949 Обращение: 20102026-10921\1» → «ошибка 500».
 */
export function relatedSubjectTopic(subject: string | null | undefined): string {
  return (subject ?? "")
    .normalize("NFKC")
    .replace(/\[(?:external|ext|внешн\p{L}*)\]/giu, " ")
    .replace(kReplyPrefixPattern, "")
    .replace(/(?<![\p{L}\p{N}])обращени[еяюи]\s*[:№#]?\s*/giu, " ")
    .replace(/\d{8}-\d{3,6}(?:\\\d+)?/gu, " ")
    .replace(/(?<![\p{L}\p{N}])и?кн[\s:№#-]*\d{6,14}/giu, " ")
    .replace(/(?<![\p{L}\p{N}])(?:RU|BY|KZ)\d{9,12}/giu, " ")
    .replace(/\s+/gu, " ")
    .replace(/[\s.,;:!?-]+$/u, "")
    .trim()
    .toLocaleLowerCase();
}

/** Тема достаточно конкретна, чтобы связывать письма без других признаков. */
export function isSpecificRelatedTopic(topic: string): boolean {
  let count = 0;
  for (const token of relatedTextTokens(topic)) {
    if (!kGenericTopicWords.has(token) && !/^\d+$/u.test(token)) {
      count++;
    }
  }
  return count >= kMinimumSpecificTopicTokens;
}

function compactRelatedSubject(subject: string | null | undefined): string {
  return (subject ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Extracts conservative request/order/case identifiers.
 * Bare numbers are intentionally ignored to avoid grouping unrelated dates,
 * invoice totals, and phone numbers.
 */
export function extractRelatedIdentifiers(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  const patterns = [
    /#[\p{L}\p{N}][\p{L}\p{N}_/-]{2,39}/gu,
    /(?<![\p{L}\p{N}])[\p{L}]{1,8}[-_/][\p{N}]{3,12}(?![\p{L}\p{N}])/giu,
    /(?<![\p{L}\p{N}])[\p{L}]{2,8}[\p{N}]{4,12}(?![\p{L}\p{N}])/giu,
  ];
  const identifiers = new Set<string>();
  for (const match of text.matchAll(kLabeledCustomerNumberPattern)) {
    identifiers.add(match[1].toLocaleLowerCase());
  }
  for (const pattern of patterns) {
    for (const match of text.match(pattern) ?? []) {
      const identifier = match.toLocaleLowerCase();
      if (kTechnicalErrorCodePattern.test(identifier.replace(/^#/u, ""))) {
        continue;
      }
      identifiers.add(identifier);
    }
  }
  return [...identifiers];
}

/**
 * Признаки клиента и обращения из одного письма: номер обращения, ИКН, заказы,
 * ИНН, компания, внешние адреса и домен. Свои и служебные адреса не учитываются.
 */
export function extractRelatedFeatures(
  text: RelatedMailText,
  context: RelatedMailContext = {},
): RelatedMailFeature[] {
  const features = new Map<string, RelatedMailFeature>();
  const add = (kind: RelatedMailFeatureKind, value: string, label = value) => {
    const key = `${kind}:${value}`;
    if (value && !features.has(key)) {
      features.set(key, { kind, value, label });
    }
  };
  const content = `${text.subject ?? ""}\n${text.body ?? ""}`.normalize("NFKC");

  for (const match of content.matchAll(kTicketNumberPattern)) {
    const day = Number(match[2]);
    const month = Number(match[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      add("ticket", match[1]);
    }
  }
  for (const match of content.matchAll(kLabeledCustomerNumberPattern)) {
    add("customer", match[1]);
  }
  for (const match of content.matchAll(kBareCustomerNumberPattern)) {
    add("customer", match[1]);
  }
  for (const match of content.matchAll(kInnPattern)) {
    add("inn", match[1]);
  }
  const customerNumbers = new Set([...features.values()]
    .filter(feature => feature.kind == "customer" || feature.kind == "inn")
    .map(feature => feature.value));
  for (const match of content.matchAll(kParcelNumberPattern)) {
    add("order", match[1].toUpperCase());
  }
  for (const match of content.matchAll(kLabeledOrderPattern)) {
    const value = match[1].toUpperCase();
    if (value.replace(/\D/gu, "").length >= 6 && !customerNumbers.has(value)) {
      add("order", value);
    }
  }
  const own = relatedOwnContext(context);
  // Название компании — только из текста внешних участников: своя подпись связью не считается
  const externalContent = `${text.subject ?? ""}\n${externalAuthorText(text, own)}`.normalize("NFKC");
  for (const match of externalContent.matchAll(kQuotedCompanyPattern)) {
    addCompany(add, match[1], match[2], true);
  }
  for (const match of externalContent.matchAll(kPlainCompanyPattern)) {
    addCompany(add, match[1], match[2], false);
  }
  for (const match of externalContent.matchAll(kSoleTraderPattern)) {
    addCompany(add, "ИП", match[1], false);
  }

  const specificDigits = new Set([...features.values()]
    .filter(feature => feature.kind != "company")
    .map(feature => feature.value.replace(/\D/gu, "")));
  for (const identifier of extractRelatedIdentifiers(content)) {
    const digits = identifier.replace(/\D/gu, "");
    if (!specificDigits.has(digits) && ![...specificDigits].some(known => known && digits.endsWith(known))) {
      add("reference", identifier);
    }
  }

  const participants = text.participants?.length
    ? text.participants
    : text.contactEmail ? [{ emailAddress: text.contactEmail }] : [];
  const addresses = [
    ...participants.map(participant => participant.emailAddress),
    ...quotedHeaderAddresses(text.body),
  ];
  for (const rawAddress of addresses) {
    const address = normalizeRelatedAddress(rawAddress);
    if (!address || isInternalRelatedAddress(address, own)) {
      continue;
    }
    add("address", address);
    const domain = addressDomain(address);
    if (domain && !kPublicMailDomains.has(domain)) {
      add("domain", domain);
    }
  }
  return sortRelatedFeatures([...features.values()]);
}

function addCompany(
  add: (kind: RelatedMailFeatureKind, value: string, label?: string) => void,
  form: string,
  rawName: string,
  quoted: boolean,
) {
  const name = rawName.replace(/\s+/gu, " ").trim();
  if (name.replace(/[^\p{L}]/gu, "").length < kMinimumCompanyNameLength) {
    return;
  }
  add("company", name.toLocaleLowerCase(), quoted ? `${form} «${name}»` : `${form} ${name}`);
}

/**
 * Части текста, написанные не своими сотрудниками. Автор меняется на строках
 * «From: …» и «… <адрес> пишет:»; автор без адреса считается внешним.
 */
function externalAuthorText(text: RelatedMailText, own: RelatedOwnContext): string {
  const isInternalAuthor = (rawAddress: string | null | undefined) => {
    const address = normalizeRelatedAddress(rawAddress);
    return !!address && isInternalRelatedAddress(address, own);
  };
  // «21.10.2026 19:08, integrators пишет:» — адреса нет, узнаём своего по имени
  const internalNames = new Set<string>();
  const people = [
    ...(text.participants ?? []),
    ...[...own.ownAddresses].map(emailAddress => ({ emailAddress, name: null })),
  ];
  for (const person of people) {
    if (isInternalAuthor(person.emailAddress)) {
      const localPart = normalizeRelatedAddress(person.emailAddress).split("@")[0];
      for (const name of [localPart, person.name?.trim().toLocaleLowerCase()]) {
        if (name && name.length >= kMinimumCompanyNameLength) {
          internalNames.add(name);
        }
      }
    }
  }
  let internal = isInternalAuthor(text.authorEmail);
  const lines: string[] = [];
  const bodyLines = (text.body ?? "").split(/\r?\n/u);
  for (let index = 0; index < bodyLines.length; index++) {
    const line = bodyLines[index];
    let authorLine = line.match(kQuoteAuthorLinePattern);
    // Перенос строки внутри «…, "integrators" <integrators@smartds.ru\n> [integrators@smartds.ru]>:»
    const nextLine = bodyLines[index + 1]?.replace(/^[\s>]*/u, "") ?? "";
    if (!authorLine && nextLine.endsWith(":") && nextLine.length <= kMaxWrappedAuthorLineLength) {
      authorLine = `${line} ${nextLine}`.match(kQuoteAuthorLinePattern);
      if (authorLine) {
        index++;
      }
    }
    if (authorLine) {
      const header = authorLine[1] ?? authorLine[2];
      const address = header.match(kEmailAddressPattern)?.[0];
      const lowerHeader = header.toLocaleLowerCase();
      internal = address
        ? isInternalAuthor(address)
        : [...internalNames].some(name => lowerHeader.includes(name));
      continue;
    }
    if (!internal) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}

function quotedHeaderAddresses(body: string | null | undefined): string[] {
  const addresses: string[] = [];
  for (const line of (body ?? "").matchAll(kQuotedHeaderPattern)) {
    addresses.push(...(line[1].match(kEmailAddressPattern) ?? []));
  }
  return addresses;
}

interface RelatedOwnContext {
  ownAddresses: Set<string>;
  internalDomains: Set<string>;
  internalLabels: Set<string>;
}

function relatedOwnContext(context: RelatedMailContext): RelatedOwnContext {
  const ownAddresses = new Set<string>();
  const internalDomains = new Set<string>();
  for (const rawAddress of context.ownAddresses ?? []) {
    const address = normalizeRelatedAddress(rawAddress);
    if (!address) {
      continue;
    }
    ownAddresses.add(address);
    const domain = addressDomain(address);
    if (domain && !kPublicMailDomains.has(domain)) {
      internalDomains.add(domain);
    }
  }
  for (const rawDomain of context.internalDomains ?? []) {
    const domain = rawDomain.trim().toLocaleLowerCase();
    if (domain && !kPublicMailDomains.has(domain)) {
      internalDomains.add(domain);
    }
  }
  const internalLabels = new Set([...internalDomains].map(domainBrandLabel).filter(Boolean));
  return { ownAddresses, internalDomains, internalLabels };
}

function isInternalRelatedAddress(address: string, own: RelatedOwnContext): boolean {
  if (own.ownAddresses.has(address)) {
    return true;
  }
  const at = address.lastIndexOf("@");
  if (kServiceLocalPartPattern.test(address.slice(0, at))) {
    return true;
  }
  const domain = address.slice(at + 1);
  if (kPublicMailDomains.has(domain)) {
    return false;
  }
  const topLevel = domain.split(".").at(-1) ?? "";
  if (!domain.includes(".") || kInternalTopLevelDomains.has(topLevel)) {
    return true;
  }
  for (const internal of own.internalDomains) {
    if (domain == internal || domain.endsWith(`.${internal}`)) {
      return true;
    }
  }
  // dpd.ru — своя компания, значит dpd.by и tech.dpd.kz тоже
  return own.internalLabels.has(domainBrandLabel(domain));
}

function normalizeRelatedAddress(address: string | null | undefined): string {
  const normalized = (address ?? "").trim().toLocaleLowerCase();
  return /^[^@\s]+@[^@\s]+$/u.test(normalized) ? normalized : "";
}

function addressDomain(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

/** «tech.dpd.kz» → «dpd», «shop.example.co.uk» → «example» */
function domainBrandLabel(domain: string): string {
  const parts = domain.split(".");
  if (parts.length < 2) {
    return "";
  }
  const secondLevel = parts[parts.length - 2];
  if (parts.length >= 3 && ["com", "co", "org", "net", "gov", "edu", "ac", "msk", "spb"].includes(secondLevel)) {
    return parts[parts.length - 3];
  }
  return secondLevel;
}

function sortRelatedFeatures(features: RelatedMailFeature[]): RelatedMailFeature[] {
  return features.sort((left, right) => kFeatureWeights[right.kind] - kFeatureWeights[left.kind]);
}

/**
 * Общие признаки двух писем, от сильного к слабому.
 * Пусто, если связи нет: общая тема вроде «Вопрос по API» сама по себе связью не считается.
 */
export function relatedMailFeatureMatches(
  source: RelatedMailText,
  candidate: RelatedMailText,
  context: RelatedMailContext = {},
): RelatedMailFeature[] {
  const result: RelatedMailFeature[] = [];
  const candidateFeatures = new Set(extractRelatedFeatures(candidate, context)
    .map(feature => `${feature.kind}:${feature.value}`));
  for (const feature of extractRelatedFeatures(source, context)) {
    if (candidateFeatures.has(`${feature.kind}:${feature.value}`)) {
      result.push(feature);
    }
  }
  if (isRelatedDuplicate(source, candidate)) {
    result.push({ kind: "duplicate", value: "duplicate", label: compactRelatedSubject(source.subject) });
  }
  const threadValue = sharedThreadValue(source, candidate);
  if (threadValue) {
    result.push({ kind: "thread", value: threadValue, label: compactRelatedSubject(source.subject) });
  }
  const subjectFeature = similarSubjectFeature(source.subject, candidate.subject);
  if (subjectFeature) {
    if (!result.length && !isSpecificRelatedTopic(subjectFeature.value)) {
      return [];
    }
    result.push(subjectFeature);
  }
  return sortRelatedFeatures(result);
}

/** Pure classifier kept separate from storage and UI for deterministic tests. */
export function classifyRelatedMail(
  source: RelatedMailText,
  candidate: RelatedMailText,
  context: RelatedMailContext = {},
): RelatedMailSignal | null {
  const features = relatedMailFeatureMatches(source, candidate, context);
  if (!features.length) {
    return null;
  }
  const sameThread = !!source.threadID && source.threadID == candidate.threadID;
  const sameSubject = normalizeRelatedSubject(source.subject) == normalizeRelatedSubject(candidate.subject);
  return relatedSignal(features, sameThread, sameSubject);
}

function relatedSignal(
  features: RelatedMailFeature[],
  sameThread: boolean,
  sameSubject: boolean,
): RelatedMailSignal {
  return {
    reason: reasonForFeature(features[0].kind, sameThread, sameSubject),
    score: relatedScore(features),
    sharedIdentifiers: features
      .filter(feature => kTextFeatureKinds.has(feature.kind) && feature.kind != "company")
      .map(feature => feature.value),
    features,
  };
}

function reasonForFeature(
  kind: RelatedMailFeatureKind,
  sameThread: boolean,
  sameSubject: boolean,
): RelatedMailReason {
  switch (kind) {
    case "duplicate":
      return "duplicate";
    case "thread":
      return sameThread ? "same-thread" : "same-identifier";
    case "address":
      return "same-contact";
    case "company":
      return "same-company";
    case "domain":
      return "same-domain";
    case "subject":
      return sameSubject ? "same-topic" : "similar-topic";
    default:
      return "same-identifier";
  }
}

/** Сила связи 0…1: главный признак плюс небольшой бонус за каждый дополнительный. */
function relatedScore(features: RelatedMailFeature[]): number {
  const strongest = kFeatureWeights[features[0].kind] / 100;
  return Math.min(1, strongest + Math.min(0.09, (features.length - 1) * 0.03));
}

function isRelatedDuplicate(source: RelatedMailText, candidate: RelatedMailText): boolean {
  const sourceSubject = normalizeRelatedSubject(source.subject);
  const sourceBody = normalizeRelatedBody(source.body);
  return sourceSubject.length >= kMinimumTopicSubjectLength &&
    relatedTextTokens(sourceSubject).size >= kMinimumSimilarSubjectTokens &&
    sourceSubject == normalizeRelatedSubject(candidate.subject) &&
    sourceBody.length >= kMinimumDuplicateBodyLength &&
    sourceBody == normalizeRelatedBody(candidate.body);
}

function sharedThreadValue(source: RelatedMailText, candidate: RelatedMailText): string | null {
  if (source.threadID && source.threadID == candidate.threadID) {
    return source.threadID;
  }
  const candidateIDs = relatedMessageIDs(candidate);
  return [...relatedMessageIDs(source)].find(id => candidateIDs.has(id)) ?? null;
}

function similarSubjectFeature(
  sourceSubject: string | null | undefined,
  candidateSubject: string | null | undefined,
): RelatedMailFeature | null {
  const sourceTopic = relatedSubjectTopic(sourceSubject);
  const candidateTopic = relatedSubjectTopic(candidateSubject);
  if (!sourceTopic || !candidateTopic) {
    return null;
  }
  const sourceTokens = relatedTextTokens(sourceTopic);
  const candidateTokens = relatedTextTokens(candidateTopic);
  const similar = sourceTopic == candidateTopic ||
    (sharedTokenCount(sourceTokens, candidateTokens) >= kMinimumSimilarSubjectTokens &&
      jaccardSimilarity(sourceTokens, candidateTokens) >= kSimilarTopicThreshold);
  return similar
    ? { kind: "subject", value: sourceTopic, label: compactRelatedSubject(candidateSubject) }
    : null;
}

/**
 * Finds related messages without downloading any new message body.
 * @param onProgress Получает быстрые результаты (переписка, адреса) до полного поиска по тексту.
 */
export async function findRelatedEmails(
  message: EMail,
  limit = kResultLimit,
  onProgress?: (matches: RelatedMailMatch[]) => void,
): Promise<RelatedMailMatch[]> {
  const account = message.folder?.account;
  if (!account) {
    return [];
  }
  const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : kResultLimit;
  const maxResults = Math.max(1, Math.min(kResultLimit, requestedLimit));

  // #if [!WEBMAIL]
  if (account.dbID && message.dbID) {
    return (await findRelatedFromDatabase(message, account, maxResults, onProgress)).slice(0, maxResults);
  }
  // #endif

  return findRelatedFromLoadedMessages(message, maxResults);
}

/** Все ящики, включая общие: связанные письма ищутся по всем. */
function relatedAccounts(account: MailAccount): MailAccount[] {
  return [...new Set([account, ...(appGlobal.emailAccounts?.contents ?? [])])];
}

function ownAddressesOf(accounts: MailAccount[]): string[] {
  const addresses: string[] = [];
  for (const account of accounts) {
    if (account.emailAddress) {
      addresses.push(account.emailAddress);
    }
    for (const identity of account.identities ?? []) {
      if (identity.emailAddress) {
        addresses.push(identity.emailAddress);
      }
    }
  }
  return addresses;
}

function findRelatedFromLoadedMessages(message: EMail, limit: number): RelatedMailMatch[] {
  const accounts = message.folder?.account ? relatedAccounts(message.folder.account) : [];
  const context: RelatedMailContext = { ownAddresses: ownAddressesOf(accounts) };
  const source = textFromEmail(message);
  const matches: RelatedMailMatch[] = [];
  const seen = new Set<EMail>();
  candidateLoop:
  for (const account of accounts) {
    for (const folder of account.getAllFolders()) {
      for (const candidate of folder.messages) {
        if (candidate == message || seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);
        const signal = classifyRelatedMail(source, textFromEmail(candidate), context);
        if (signal) {
          matches.push({ email: candidate, ...signal });
        }
        if (seen.size >= kCandidateLimit) {
          break candidateLoop;
        }
      }
    }
  }
  return sortRelatedMatches(matches).slice(0, limit);
}

// #if [!WEBMAIL]
type RelatedMailRow = RelatedMailText & {
  id: number;
  folderID: number;
  pID?: string | number | null;
  parentMsgID?: string | null;
  dateSent?: number | null;
  dateReceived?: number | null;
  outgoing?: number | null;
  contactName?: string | null;
  isRead?: number | null;
  isStarred?: number | null;
  isReplied?: number | null;
  isForwarded?: number | null;
  isImportant?: number | null;
  isSpam?: number | null;
  isDraft?: number | null;
  downloadComplete?: number | null;
  json?: string | null;
};

type RelatedDatabase = Awaited<ReturnType<typeof getDatabase>>;

interface RelatedCandidateRow {
  id: number;
  dateSent: number;
}

interface RelatedCandidate {
  id: number;
  dateSent: number;
  features: Map<string, RelatedMailFeature>;
}

interface RelatedSearch {
  database: RelatedDatabase;
  source: RelatedMailText;
  sourceID: number | string;
  folderIDs: (number | string)[];
  folders: Map<string, Folder>;
  candidates: Map<number, RelatedCandidate>;
}

async function findRelatedFromDatabase(
  message: EMail,
  account: MailAccount,
  limit: number,
  onProgress?: (matches: RelatedMailMatch[]) => void,
): Promise<RelatedMailMatch[]> {
  const database = await getDatabase();
  const sourceRow = await database.get<RelatedMailRow>(sql`
    SELECT
      e.id as id, e.folderID as folderID,
      e.messageID as messageID, e.parentMsgID as parentMsgID,
      e.threadID as threadID, e.dateSent as dateSent,
      e.contactEmail as contactEmail, e.subject as subject,
      substr(e.plaintext, 1, ${kSourceTextLength}) as body
    FROM email e
      JOIN folder f ON f.id = e.folderID
    WHERE e.id = ${message.dbID} AND f.accountID = ${account.dbID}
    LIMIT 1
  `);
  if (!sourceRow) {
    return findRelatedFromLoadedMessages(message, limit);
  }

  const accounts = relatedAccounts(account);
  const folders = new Map<string, Folder>();
  for (const relatedAccount of accounts) {
    for (const folder of relatedAccount.getAllFolders()) {
      if (folder.dbID != null) {
        folders.set(String(folder.dbID), folder);
      }
    }
  }
  const source = textFromRow(sourceRow, message);
  const context: RelatedMailContext = {
    ownAddresses: ownAddressesOf(accounts),
    internalDomains: await internalDomainsFromDatabase(database),
  };
  const features = extractRelatedFeatures(source, context);
  const search: RelatedSearch = {
    database,
    source,
    sourceID: message.dbID!,
    folderIDs: [...folders.values()].map(folder => folder.dbID!),
    folders,
    candidates: new Map(),
  };

  await addThreadCandidates(search, message);
  for (const feature of features) {
    if (feature.kind == "address" || feature.kind == "domain") {
      await addParticipantCandidates(search, feature);
    }
  }
  if (onProgress && search.candidates.size) {
    onProgress(await buildRelatedMatches(search, limit));
  }
  await addTextCandidates(search, features.filter(feature => kTextFeatureKinds.has(feature.kind)));
  return await buildRelatedMatches(search, limit);
}

let cachedInternalDomains: { database: RelatedDatabase; domains: string[]; time: number } | null = null;
/** Уже найденные частые признаки (своя компания в подписи): повторно по ним не ищем. */
const commonFeatureKeys = new Set<string>();

/**
 * Домены своей организации по данным почты: от сотен разных адресов
 * (головная компания, коллеги) приходят письма, а у клиента их единицы.
 */
async function internalDomainsFromDatabase(database: RelatedDatabase): Promise<string[]> {
  if (cachedInternalDomains?.database == database &&
      Date.now() - cachedInternalDomains.time < kInternalDomainCacheMS) {
    return cachedInternalDomains.domains;
  }
  const rows = await database.all<{ domain: string }>(sql`
    SELECT lower(substr(emailAddress, instr(emailAddress, '@') + 1)) AS domain
    FROM emailPerson
    WHERE instr(ifnull(emailAddress, ''), '@') > 0
    GROUP BY domain
    HAVING count(DISTINCT lower(emailAddress)) >= ${kInternalDomainMinAddresses}
  `);
  const domains = rows.map(row => row.domain).filter(domain => !kPublicMailDomains.has(domain));
  cachedInternalDomains = { database, domains, time: Date.now() };
  return domains;
}

function addCandidateRows(
  search: RelatedSearch,
  rows: RelatedCandidateRow[],
  feature: RelatedMailFeature,
) {
  if (kDroppableCommonKinds.has(feature.kind) && rows.length > kCommonFeatureLimit) {
    commonFeatureKeys.add(`${feature.kind}:${feature.value}`);
    return;
  }
  for (const row of [...rows].sort((left, right) => right.dateSent - left.dateSent).slice(0, kPerFeatureLimit)) {
    let candidate = search.candidates.get(row.id);
    if (!candidate) {
      candidate = { id: row.id, dateSent: row.dateSent, features: new Map() };
      search.candidates.set(row.id, candidate);
    }
    candidate.features.set(`${feature.kind}:${feature.value}`, feature);
  }
}

async function addThreadCandidates(search: RelatedSearch, message: EMail) {
  const { source } = search;
  const clauses: Query[] = [];
  if (source.threadID) {
    clauses.push(sql`threadID = ${source.threadID}`);
  }
  const referenceIDs = [...relatedMessageIDs(source)];
  if (referenceIDs.length) {
    clauses.push(sql`messageID IN ${referenceIDs} OR parentMsgID IN ${referenceIDs}`);
  }
  const relation = combineOr(clauses);
  if (!relation) {
    return;
  }
  const rows = await search.database.all<RelatedCandidateRow>(sql`
    SELECT id, dateSent
    FROM email
    WHERE ($${relation})
      AND id != ${search.sourceID}
      AND folderID IN ${search.folderIDs}
    ORDER BY dateSent DESC
    LIMIT ${kPerFeatureLimit}
  `);
  addCandidateRows(search, rows, {
    kind: "thread",
    value: source.threadID ?? referenceIDs[0],
    label: compactRelatedSubject(message.subject ?? source.subject),
  });
}

async function addParticipantCandidates(search: RelatedSearch, feature: RelatedMailFeature) {
  const condition = feature.kind == "address"
    ? sql`lower(p.emailAddress) = ${feature.value}`
    : sql`lower(p.emailAddress) LIKE ${`%@${escapeLikePattern(feature.value)}`} ESCAPE '\\'`;
  const rows = await search.database.all<RelatedCandidateRow>(sql`
    SELECT DISTINCT e.id AS id, e.dateSent AS dateSent
    FROM emailPerson p
      JOIN emailPersonRel r ON r.emailPersonID = p.id
      JOIN email e ON e.id = r.emailID
    WHERE ($${condition})
      AND e.id != ${search.sourceID}
      AND e.folderID IN ${search.folderIDs}
    ORDER BY e.dateSent DESC
    LIMIT ${kCommonFeatureLimit + 1}
  `);
  addCandidateRows(search, rows, feature);
}

/**
 * Один проход по почте для всех признаков из текста: тема + начало текста.
 * Битовая маска показывает, какие признаки нашлись в письме.
 */
async function addTextCandidates(search: RelatedSearch, allFeatures: RelatedMailFeature[]) {
  const features = allFeatures
    .filter(feature => !commonFeatureKeys.has(`${feature.kind}:${feature.value}`))
    .slice(0, kMaxTextFeatures);
  const topic = relatedSubjectTopic(search.source.subject);
  const searchTopic = isSpecificRelatedTopic(topic);
  if (!features.length && !searchTopic) {
    return;
  }
  const conditions = features.map(textFeatureCondition);
  const topicBit = features.length;
  if (searchTopic) {
    conditions.push(combineOr(unicodeSearchVariants(topic)
      .map(variant => sql`s LIKE ${`%${escapeLikePattern(variant)}%`} ESCAPE '\\'`))!);
  }
  let mask = sql`0`;
  for (let bit = 0; bit < conditions.length; bit++) {
    mask = sql`$${mask} | (($${conditions[bit]}) << ${bit})`;
  }
  const rows = await search.database.all<RelatedCandidateRow & { mask: number; subject: string }>(sql`
    SELECT id, dateSent, subject, mask FROM (
      SELECT id, dateSent, s AS subject, $${mask} AS mask
      FROM (
        SELECT e.id AS id, e.dateSent AS dateSent, e.subject AS s,
          ifnull(substr(e.plaintext, 1, ${kScanTextLength}), '') AS t
        FROM email e
        WHERE e.id != ${search.sourceID}
          AND e.folderID IN ${search.folderIDs}
      )
    )
    WHERE mask != 0
  `);
  features.forEach((feature, index) => {
    addCandidateRows(search, rows.filter(row => row.mask & (1 << index)), feature);
  });
  if (searchTopic) {
    const topicRows = rows.filter(row => row.mask & (1 << topicBit));
    // Тема без других признаков связывает, только если она редкая
    const standaloneRows = topicRows.length <= kSpecificTopicLimit
      ? topicRows
      : topicRows.filter(row => search.candidates.has(row.id));
    for (const row of standaloneRows) {
      const subjectFeature = similarSubjectFeature(search.source.subject, row.subject);
      if (subjectFeature) {
        addCandidateRows(search, [row], subjectFeature);
      }
    }
  }
}

function textFeatureCondition(feature: RelatedMailFeature): Query {
  const terms = feature.kind == "company"
    ? companySearchTerms(feature)
    : [feature.value];
  return combineOr(terms.map(term => {
    const pattern = `%${escapeLikePattern(term)}%`;
    return sql`s LIKE ${pattern} ESCAPE '\\' OR t LIKE ${pattern} ESCAPE '\\'`;
  }))!;
}

/**
 * LIKE в SQLite не различает регистр только для латиницы, поэтому для кириллицы
 * ищем название как написано и ЗАГЛАВНЫМИ: так его пишут в реквизитах и подписях.
 * Каждый вариант — ещё один проход по тексту писем, поэтому вариантов только два.
 */
function companySearchTerms(feature: RelatedMailFeature): string[] {
  const term = feature.label.startsWith("ИП ") || !feature.label.includes("«")
    ? feature.label
    : feature.label.replace(/^\S+\s+«/u, "").replace(/»$/u, "");
  return [...new Set([term, term.toLocaleUpperCase()])];
}

async function buildRelatedMatches(search: RelatedSearch, limit: number): Promise<RelatedMailMatch[]> {
  const ranked = [...search.candidates.values()]
    .map(candidate => ({
      candidate,
      features: sortRelatedFeatures([...candidate.features.values()]),
    }))
    .sort((left, right) =>
      relatedScore(right.features) - relatedScore(left.features) ||
      right.candidate.dateSent - left.candidate.dateSent)
    .slice(0, limit);
  if (!ranked.length) {
    return [];
  }
  const rows = await search.database.all<RelatedMailRow>(sql`
    SELECT
      e.id as id, e.folderID as folderID, e.pID as pID,
      e.messageID as messageID, e.parentMsgID as parentMsgID,
      e.threadID as threadID, e.dateSent as dateSent,
      e.dateReceived as dateReceived, e.outgoing as outgoing,
      e.contactEmail as contactEmail, e.contactName as contactName,
      e.subject as subject, substr(e.plaintext, 1, ${kIndexedTextLength}) as body,
      e.isRead as isRead, e.isStarred as isStarred,
      e.isReplied as isReplied, e.isForwarded as isForwarded,
      e.isImportant as isImportant, e.isSpam as isSpam,
      e.isDraft as isDraft, e.downloadComplete as downloadComplete,
      e.json as json
    FROM email e
    WHERE e.id IN ${ranked.map(entry => entry.candidate.id)}
  `);
  const rowsByID = new Map(rows.map(row => [Number(row.id), row]));
  const loaded = new Map<Folder, Map<string, EMail>>();
  const matches: RelatedMailMatch[] = [];
  for (const { candidate, features } of ranked) {
    const row = rowsByID.get(candidate.id);
    const folder = row ? search.folders.get(String(row.folderID)) : null;
    if (!row || !folder) {
      continue;
    }
    const allFeatures = [...features];
    const has = (kind: RelatedMailFeatureKind) => allFeatures.some(feature => feature.kind == kind);
    const candidateText = textFromRow(row);
    if (!has("subject")) {
      const subjectFeature = similarSubjectFeature(search.source.subject, row.subject);
      if (subjectFeature) {
        allFeatures.push(subjectFeature);
      }
    }
    if (!has("thread")) {
      const threadValue = sharedThreadValue(search.source, candidateText);
      if (threadValue) {
        allFeatures.push({ kind: "thread", value: threadValue, label: compactRelatedSubject(search.source.subject) });
      }
    }
    if (isRelatedDuplicate(search.source, candidateText)) {
      allFeatures.push({ kind: "duplicate", value: "duplicate", label: compactRelatedSubject(search.source.subject) });
    }
    sortRelatedFeatures(allFeatures);
    const email = await relatedEmailForRow(folder, row, loaded);
    const sameThread = !!search.source.threadID && search.source.threadID == row.threadID;
    const sameSubject = normalizeRelatedSubject(search.source.subject) == normalizeRelatedSubject(row.subject);
    matches.push({ email, ...relatedSignal(allFeatures, sameThread, sameSubject) });
  }
  return sortRelatedMatches(matches);
}

async function relatedEmailForRow(
  folder: Folder,
  row: RelatedMailRow,
  loaded: Map<Folder, Map<string, EMail>>,
): Promise<EMail> {
  let byDBID = loaded.get(folder);
  if (!byDBID) {
    byDBID = new Map();
    for (const email of folder.messages) {
      if (email.dbID != null) {
        byDBID.set(String(email.dbID), email);
      }
    }
    loaded.set(folder, byDBID);
  }
  const existing = byDBID.get(String(row.id));
  if (existing) {
    return existing;
  }
  const email = folder.newEMail();
  await SQLEMail.readMainProperties(row.id, email, row);
  return email;
}

function combineOr(queries: Query[]): Query | null {
  let result: Query | null = null;
  for (const query of queries) {
    result = result ? sql`($${result}) OR ($${query})` : query;
  }
  return result;
}

function textFromRow(row: RelatedMailRow, fallback?: EMail): RelatedMailText {
  return {
    messageID: row.messageID ?? fallback?.messageID ?? null,
    inReplyTo: row.parentMsgID ?? fallback?.inReplyTo ?? null,
    threadID: row.threadID ?? fallback?.threadID ?? null,
    references: fallback?.references ?? null,
    subject: row.subject ?? fallback?.subject ?? "",
    body: row.body ?? fallback?.rawText ?? (fallback?.loadedBody ? fallback.text : ""),
    contactEmail: row.contactEmail ?? contactEmailFromMessage(fallback) ?? null,
    authorEmail: fallback?.from?.emailAddress ?? null,
    participants: fallback ? participantsFromEmail(fallback) : null,
    sentAt: typeof row.dateSent == "number" ? row.dateSent * 1000 : fallback?.sent?.getTime(),
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, character => `\\${character}`);
}
// #endif

function textFromEmail(email: EMail): RelatedMailText {
  return {
    messageID: email.messageID,
    inReplyTo: email.inReplyTo,
    threadID: email.threadID,
    references: email.references,
    subject: email.subject,
    body: email.rawText ?? (email.loadedBody ? email.text : ""),
    contactEmail: contactEmailFromMessage(email),
    authorEmail: email.from?.emailAddress ?? null,
    participants: participantsFromEmail(email),
    sentAt: email.sent?.getTime(),
  };
}

function participantsFromEmail(email: EMail): RelatedMailParticipant[] {
  const people: (PersonUID | null | undefined)[] = [
    email.from,
    email.replyTo,
    ...(email.to?.contents ?? []),
    ...(email.cc?.contents ?? []),
  ];
  const participants = people
    .filter((person): person is PersonUID => !!person?.emailAddress)
    .map(person => ({ emailAddress: person.emailAddress, name: person.name }));
  const contactEmail = contactEmailFromMessage(email);
  if (contactEmail) {
    participants.push({ emailAddress: contactEmail, name: null });
  }
  return participants;
}

function contactEmailFromMessage(email: EMail | null | undefined): string | null {
  const contact = email?.contact;
  if (!contact) {
    return null;
  }
  if ("emailAddress" in contact) {
    return contact.emailAddress ?? null;
  }
  if ("emailAddresses" in contact) {
    return contact.emailAddresses.first?.value ?? null;
  }
  return null;
}

function relatedMessageIDs(message: RelatedMailText): Set<string> {
  return new Set(uniqueStrings([
    message.messageID,
    message.inReplyTo,
    ...(message.references ?? []),
  ]));
}

function normalizeRelatedBody(body: string | null | undefined): string {
  const lines = (body ?? "").split(/\r?\n/u);
  const visibleLines: string[] = [];
  for (const line of lines) {
    if (/^\s*>/u.test(line)) {
      continue;
    }
    if (/^\s*--\s*$/u.test(line)) {
      break;
    }
    visibleLines.push(line);
  }
  return visibleLines
    .join(" ")
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/giu, " url ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function relatedTextTokens(text: string): Set<string> {
  const normalized = text
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLocaleLowerCase();
  return new Set(normalized.split(/\s+/u).filter(token =>
    token.length >= 3 && !kStopWords.has(token)));
}

function sharedTokenCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count++;
    }
  }
  return count;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) {
    return 0;
  }
  const intersection = sharedTokenCount(left, right);
  return intersection / (left.size + right.size - intersection);
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

function sortRelatedMatches(matches: RelatedMailMatch[]): RelatedMailMatch[] {
  return matches.sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (scoreDifference) {
      return scoreDifference;
    }
    return (right.email.listDisplayDate()?.getTime() ?? 0) -
      (left.email.listDisplayDate()?.getTime() ?? 0);
  });
}
