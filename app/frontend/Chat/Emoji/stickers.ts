import { gt } from "../../../l10n/l10n";

export interface StickerDefinition {
  id: string;
  emoji: string;
  title: string;
  keywords: string[];
  background: string;
}

export const kStickerDisplayWidth = 128;

export const stickerCatalog: readonly StickerDefinition[] = [
  { id: "thumbs-up", emoji: "👍", title: "Thumbs up", keywords: ["like", "ok", "yes", "лайк", "хорошо"], background: "#FDE68A" },
  { id: "heart", emoji: "❤️", title: "Heart", keywords: ["love", "сердце", "любовь"], background: "#FBCFE8" },
  { id: "laugh", emoji: "😂", title: "Laughing", keywords: ["laugh", "funny", "смех", "смешно"], background: "#FEF3C7" },
  { id: "party", emoji: "🎉", title: "Party", keywords: ["party", "celebrate", "праздник", "ура"], background: "#DDD6FE" },
  { id: "fire", emoji: "🔥", title: "Fire", keywords: ["fire", "hot", "огонь", "круто"], background: "#FED7AA" },
  { id: "clap", emoji: "👏", title: "Clap", keywords: ["clap", "bravo", "аплодисменты", "браво"], background: "#FECDD3" },
  { id: "thanks", emoji: "🙏", title: "Thanks", keywords: ["thanks", "please", "спасибо", "пожалуйста"], background: "#BAE6FD" },
  { id: "hug", emoji: "🤗", title: "Hug", keywords: ["hug", "объятие", "обнимаю"], background: "#FBCFE8" },
  { id: "cool", emoji: "😎", title: "Cool", keywords: ["cool", "класс", "круто"], background: "#BFDBFE" },
  { id: "hundred", emoji: "💯", title: "One hundred", keywords: ["100", "perfect", "идеально", "сто"], background: "#FECACA" },
  { id: "rocket", emoji: "🚀", title: "Rocket", keywords: ["rocket", "go", "ракета", "вперёд"], background: "#C7D2FE" },
  { id: "sparkles", emoji: "✨", title: "Sparkles", keywords: ["sparkle", "magic", "сияние", "магия"], background: "#E9D5FF" },
  { id: "wave", emoji: "👋", title: "Wave", keywords: ["hello", "bye", "привет", "пока"], background: "#A7F3D0" },
  { id: "thinking", emoji: "🤔", title: "Thinking", keywords: ["think", "hmm", "думаю", "хм"], background: "#E2E8F0" },
  { id: "eyes", emoji: "👀", title: "Eyes", keywords: ["look", "watch", "смотрю", "глаза"], background: "#CFFAFE" },
  { id: "coffee", emoji: "☕", title: "Coffee", keywords: ["coffee", "break", "кофе", "перерыв"], background: "#D6D3D1" },
];

/** Название стикера на языке интерфейса (`title` — английское, для поиска на любом языке) */
export function stickerTitle(sticker: StickerDefinition): string {
  switch (sticker.id) {
    case "thumbs-up": return gt`Thumbs up`;
    case "heart": return gt`Heart`;
    case "laugh": return gt`Laughing`;
    case "party": return gt`Party`;
    case "fire": return gt`Fire`;
    case "clap": return gt`Clap`;
    case "thanks": return gt`Thanks`;
    case "hug": return gt`Hug`;
    case "cool": return gt`Cool`;
    case "hundred": return gt`One hundred`;
    case "rocket": return gt`Rocket`;
    case "sparkles": return gt`Sparkles`;
    case "wave": return gt`Wave`;
    case "thinking": return gt`Thinking`;
    case "eyes": return gt`Eyes`;
    case "coffee": return gt`Coffee`;
    default: return sticker.title;
  }
}

export function filterStickers(searchTerm: string | null): StickerDefinition[] {
  let term = searchTerm?.trim().toLocaleLowerCase();
  if (!term) {
    return [...stickerCatalog];
  }
  return stickerCatalog.filter(sticker =>
    [sticker.title, stickerTitle(sticker), sticker.emoji, ...sticker.keywords]
      .some(value => value.toLocaleLowerCase().includes(term)));
}

/** Creates a self-contained SVG sticker, so no third-party image host is needed. */
export function createStickerFile(sticker: StickerDefinition): File {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect x="8" y="8" width="176" height="176" rx="48" fill="${sticker.background}"/>
  <text x="96" y="133" text-anchor="middle" font-size="106" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${escapeXML(sticker.emoji)}</text>
</svg>`;
  return new File([svg], `sticker-${sticker.id}.svg`, { type: "image/svg+xml" });
}

function escapeXML(value: string): string {
  return value.replace(/[<>&'\"]/g, character => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;",
  }[character]));
}
