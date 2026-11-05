// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";

const openFileInternally = vi.fn(async (..._args: unknown[]) => {});

vi.mock("../../../frontend/Files/open", () => ({ openFileInternally }));
vi.mock("../../../frontend/Mail/open", () => ({ openEMailMessage: vi.fn() }));
vi.mock("../../../frontend/Calendar/open", () => ({ openEvent: vi.fn() }));
vi.mock("../../../logic/Chat/Jackdaw/chatLinks", async importOriginal => ({
  ...await importOriginal<typeof import("../../../logic/Chat/Jackdaw/chatLinks")>(),
  // Своей копии письма нет: так у получателя, которому письмо не приходило
  findLinkedEmail: vi.fn(async () => undefined),
}));

let LinkCard: any;
let Attachment: any;

beforeAll(async () => {
  LinkCard = (await import("../../../frontend/Chat/MessageView/LinkCard.svelte")).default;
  Attachment = (await import("../../../logic/Abstract/Attachment")).Attachment;
});

beforeEach(() => {
  let values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

let mounted: ReturnType<typeof mount>[] = [];

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  openFileInternally.mockClear();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const link = { type: "email" as const, messageID: "<old@example.com>", subject: "Счёт за октябрь", from: "Анна", date: Date.UTC(2026, 9, 20) };

async function clickCard(props: Record<string, unknown>): Promise<string> {
  let target = document.createElement("div");
  document.body.append(target);
  mounted.push(mount(LinkCard, { target, props }));
  await tick();
  target.querySelector("button")!.click();
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await tick();
  }
  return target.querySelector("[role=status]")?.textContent ?? "";
}

describe("карточка письма в чате", () => {
  test("входящее сообщение старой версии (только ссылка) объясняет, что делать", async () => {
    let status = await clickCard({ link, message: { outgoing: false, attachments: new ArrayColl() } });
    expect(status).toContain("older version of Jackdaw Mail");
    expect(openFileInternally).not.toHaveBeenCalled();
  });

  test("своё отправленное старое сообщение: письма больше нет в ящике", async () => {
    let status = await clickCard({ link, message: { outgoing: true, attachments: new ArrayColl() } });
    expect(status).toContain("not in your mailbox anymore");
  });

  test("письмо приложено файлом .eml — открывается в просмотрщике", async () => {
    let attachment = new Attachment();
    attachment.filename = "Счёт за октябрь.eml";
    attachment.mimeType = "message/rfc822";
    attachment.content = new File(["Subject: Счёт за октябрь\r\n\r\nТекст"], attachment.filename, { type: "message/rfc822" });
    let status = await clickCard({
      link: { ...link, eml: attachment.filename },
      message: { outgoing: false, attachments: new ArrayColl([attachment]) },
    });
    expect(status).toBe("");
    expect(openFileInternally).toHaveBeenCalledTimes(1);
    expect(openFileInternally.mock.calls[0][1]).toBe("message/rfc822");
  });
});
