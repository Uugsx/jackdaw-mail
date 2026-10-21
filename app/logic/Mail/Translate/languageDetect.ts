/**
 * Определение языка письма на устройстве, без сети и без моделей.
 *
 * Сначала — по письменности (кириллица, CJK, арабское письмо…), затем внутри
 * письменности — по самым частым служебным словам и характерным буквам.
 * Этого достаточно, чтобы предложить перевод: ошибиться между близкими
 * языками не страшно, пользователь может выбрать язык вручную.
 */

export interface DetectedLanguage {
  /** ISO 639-1, для китайского — `zh-Hans` / `zh-Hant` */
  language: string;
  /** 0…1 */
  confidence: number;
}

/** Меньше букв — язык не определяем: подпись или «OK» ничего не говорят */
const kMinLetters = 20;
const kMaxSampleChars = 6000;
const kMinConfidence = 0.5;

const kStopwords: Record<string, string> = {
  en: "the and to of a in is that for it you on with this be are as at have was not your we our will can if or by from please thanks regards any an all would should has been do there which they",
  de: "der die und das ist nicht zu den mit sie ich es ein eine auf für von dem sich des auch wir ihr bitte uns sind wird haben bei oder wie aber noch nach vielen dank gruß grüße",
  fr: "le la les de des et est un une pour que qui dans en pas vous nous sur au aux du avec ce cette sont merci bonjour cordialement ne il elle mais ou par plus votre vos",
  es: "el la los las de y que en es un una por para con no se del al lo como su sus más pero muy gracias saludos usted le nos este esta hola estimado",
  it: "il la di e che è un una per non in del della con sono si le gli da al ma come anche questo grazie saluti cordiali buongiorno vostro nostro alla",
  pt: "o a os as de e que do da em um uma para com não se é por mais dos das no na ao como mas obrigado obrigada você seu sua cumprimentos olá",
  nl: "de het een en van is dat niet te in op voor met zijn je ik we wij er maar ook om aan bij als dank groeten vriendelijke graag u uw",
  sv: "och att det som en är på för med inte jag av till den har de vi ett om men kan så tack hälsningar vänliga er ni",
  da: "og at det er en på til for med ikke jeg af den de har vi et om men kan så tak hilsen venlig jer i",
  nb: "og at det er en på til for med ikke jeg av den de har vi et om men kan så takk hilsen vennlig dere",
  fi: "ja on ei että se oli ole kun mutta niin kuin tai joka myös hän me te kiitos terveisin ystävällisin olen ovat tämä",
  pl: "i w na nie z się to jest że do o jak ale po co tak za od dla są dziękuję pozdrawiam proszę czy mi",
  cs: "a v na se je že to s z do o i jak ale pro jsem jsou by děkuji pozdravem prosím od tak už",
  sk: "a v na sa je že to s z do o i ako ale pre som sú by ďakujem pozdravom prosím od tak už",
  hu: "a az és hogy nem is egy van meg de el ez mint csak már köszönöm üdvözlettel kérem ön önök",
  ro: "și în de la nu că este o un cu pe pentru se mai dar sunt mulțumesc salutări vă vă rog",
  tr: "ve bir bu da de için ile ne çok ama gibi daha olan teşekkürler saygılarımla merhaba lütfen siz biz",
  hr: "i u je da se na za ne su od to sa kao ali hvala pozdrav lijepi molim vas",
  id: "dan yang di ini itu dengan untuk tidak dari ada akan pada juga kami anda terima kasih salam",
  vi: "và của là có không cho được này với những một các người đã chúng tôi bạn cảm ơn",
  ca: "el la els les de i que en és un una per amb no es del al com més però gràcies salutacions",
  et: "ja on ei et see oli kui aga ka nii mis või tänan lugupidamisega",
  lt: "ir yra ne kad su į iš ar bet kaip tai ačiū pagarbiai",
  lv: "un ir ne ka ar uz no vai bet kā tas paldies ar cieņu",
  sl: "in je da se na za ne so od to kot ali hvala lep pozdrav prosim",
  ru: "и в не что на я с он как это по но из у за вы к для от же так все мы бы был она его если или только уже спасибо здравствуйте уважением",
  uk: "і в не що на я з він як це по але із у за ви до для від же так все ми би був вона його якщо або тільки вже дякую добрий день повагою",
  bg: "и в не че на аз с той как това по но от за вие към да се е са ще като или само вече благодаря поздрави",
  sr: "и у не да на ја са он како то по али из за ви од је се су ће или само хвала поздрав",
  be: "і ў не што на я з ён як гэта па але з у за вы да для ад жа так усе мы дзякуй",
  mk: "и во не што на јас со тој како ова по но од за вие да се е се ќе или само благодарам",
};

/** Буквы, по которым язык узнаётся сразу */
const kLetterHints: [string, RegExp, number][] = [
  ["de", /[äöüß]/g, 1.5],
  ["es", /[ñ¿¡]/g, 3],
  ["fr", /[çœèêëîïû]/g, 1],
  ["pt", /[ãõ]/g, 3],
  ["pl", /[ąęłśźżćń]/g, 2],
  ["cs", /[řěů]/g, 3],
  ["sk", /[ľĺŕô]/g, 3],
  ["hu", /[őű]/g, 3],
  ["ro", /[șțăâ]/g, 2],
  ["tr", /[ğışİ]/g, 2],
  ["sv", /[å]/g, 0.5],
  ["da", /[øæ]/g, 1],
  ["nb", /[øæ]/g, 1],
  ["vi", /[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/g, 3],
  ["is", /[þð]/g, 3],
  ["lv", /[āēīūķļņģ]/g, 2],
  ["lt", /[ąčęėįšųūž]/g, 1],
  ["uk", /[іїєґ]/g, 3],
  ["be", /[ўі]/g, 2],
  ["sr", /[ђјљњћџ]/g, 3],
  ["mk", /[ѓќѕјљњџ]/g, 2],
  ["ru", /[ыэё]/g, 2],
];

const kStopwordSets = new Map<string, Set<string>>(
  Object.entries(kStopwords).map(([language, words]) => [language, new Set(words.split(" "))]));

const kCyrillicLanguages = ["ru", "uk", "bg", "sr", "be", "mk"];

type Script = "latin" | "cyrillic" | "greek" | "arabic" | "hebrew" | "devanagari" | "thai" |
  "hangul" | "kana" | "han" | "georgian" | "armenian" | "bengali" | "tamil" | "other";

const kScriptRegex: [Script, RegExp][] = [
  ["latin", /\p{Script=Latin}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["greek", /\p{Script=Greek}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["thai", /\p{Script=Thai}/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["han", /\p{Script=Han}/u],
  ["georgian", /\p{Script=Georgian}/u],
  ["armenian", /\p{Script=Armenian}/u],
  ["bengali", /\p{Script=Bengali}/u],
  ["tamil", /\p{Script=Tamil}/u],
];

const kSingleLanguageScripts: Partial<Record<Script, string>> = {
  greek: "el",
  hebrew: "he",
  devanagari: "hi",
  thai: "th",
  hangul: "ko",
  georgian: "ka",
  armenian: "hy",
  bengali: "bn",
  tamil: "ta",
};

/** Ссылки, адреса, числа и коды не говорят о языке */
function cleanSample(text: string): string {
  return text
    .slice(0, kMaxSampleChars * 2)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\S+@\S+\.\S+/g, " ")
    .replace(/[\d_]+/g, " ")
    .slice(0, kMaxSampleChars);
}

function scriptOf(char: string): Script | null {
  if (!/\p{L}/u.test(char)) {
    return null;
  }
  for (let [script, regex] of kScriptRegex) {
    if (regex.test(char)) {
      return script;
    }
  }
  return "other";
}

function countScripts(text: string): { counts: Map<Script, number>; letters: number } {
  let counts = new Map<Script, number>();
  let letters = 0;
  for (let char of text) {
    let script = scriptOf(char);
    if (!script) {
      continue;
    }
    letters++;
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  return { counts, letters };
}

function words(text: string): string[] {
  return text.toLowerCase().match(/\p{L}+(?:['’]\p{L}+)?/gu) ?? [];
}

/** Счёт по служебным словам и буквам; самый высокий — язык */
function scoreLanguages(text: string, candidates: string[]): { language: string; confidence: number } | null {
  let list = words(text);
  if (!list.length) {
    return null;
  }
  let lower = text.toLowerCase();
  let scores = new Map<string, number>(candidates.map(language => [language, 0]));
  for (let word of list) {
    for (let language of candidates) {
      if (kStopwordSets.get(language)?.has(word)) {
        scores.set(language, scores.get(language) + 1);
      }
    }
  }
  for (let [language, regex, weight] of kLetterHints) {
    if (!scores.has(language)) {
      continue;
    }
    let hits = lower.match(regex)?.length ?? 0;
    if (hits) {
      // Буквы — сильный признак, но не перевешивают весь текст
      scores.set(language, scores.get(language) + Math.min(hits, list.length / 2) * weight);
    }
  }
  let ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  let [best, second] = ranked;
  if (!best || best[1] <= 0) {
    return null;
  }
  // Доля служебных слов в обычном тексте — 25–50 %; меньше 5 % — подозрительно
  let coverage = Math.min(1, best[1] / Math.max(1, list.length * 0.25));
  let margin = second && second[1] > 0 ? (best[1] - second[1]) / best[1] : 1;
  let confidence = Math.min(1, coverage * (0.5 + margin / 2));
  return { language: best[0], confidence };
}

function detectArabicScript(text: string): string {
  let urdu = text.match(/[ٹڈڑںےھ]/g)?.length ?? 0;
  let persian = text.match(/[پچژگکی]/g)?.length ?? 0;
  let arabic = text.match(/[ةيك]/g)?.length ?? 0;
  if (urdu > 2 && urdu >= persian / 2) {
    return "ur";
  }
  return persian > arabic ? "fa" : "ar";
}

/** Иероглифы, которые пишут только в традиционном китайском */
const kTraditionalHan = /[們這個說時來會對開關點過國學東無應當經後發問還進現實與萬區]/g;
const kSimplifiedHan = /[们这个说时来会对开关点过国学东无应当经后发问还进现实与万区]/g;

function detectHan(text: string): string {
  let traditional = text.match(kTraditionalHan)?.length ?? 0;
  let simplified = text.match(kSimplifiedHan)?.length ?? 0;
  return traditional > simplified ? "zh-Hant" : "zh-Hans";
}

/**
 * @param text обычный текст письма, лучше без цитаты прошлых писем
 * @returns язык, или null, если текста мало или язык не ясен
 */
export function detectLanguage(text: string | null | undefined): DetectedLanguage | null {
  if (!text) {
    return null;
  }
  let sample = cleanSample(text);
  let { counts, letters } = countScripts(sample);
  if (letters < kMinLetters) {
    return null;
  }
  let [script, scriptLetters] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  let share = scriptLetters / letters;

  // Японский пишут иероглифами и каной вместе: кана — признак японского
  let kana = counts.get("kana") ?? 0;
  let han = counts.get("han") ?? 0;
  if ((script == "han" || script == "kana") && kana + han >= letters / 2) {
    let confidence = Math.min(1, (kana + han) / letters);
    return kana >= (kana + han) * 0.1
      ? { language: "ja", confidence }
      : { language: detectHan(sample), confidence };
  }
  if (share < kMinConfidence) {
    return null;
  }
  let single = kSingleLanguageScripts[script];
  if (single) {
    return { language: single, confidence: share };
  }
  if (script == "arabic") {
    return { language: detectArabicScript(sample), confidence: share };
  }
  let candidates = script == "cyrillic"
    ? kCyrillicLanguages
    : script == "latin"
      ? Object.keys(kStopwords).filter(language => !kCyrillicLanguages.includes(language))
      : null;
  if (!candidates) {
    return null;
  }
  let scored = scoreLanguages(sample, candidates);
  if (!scored) {
    return null;
  }
  let confidence = scored.confidence * share;
  return confidence >= kMinConfidence ? { language: scored.language, confidence } : null;
}
