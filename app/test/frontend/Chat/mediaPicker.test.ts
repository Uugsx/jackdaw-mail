// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from "vitest";
import { appGlobal } from "../../../logic/app";
import {
  downloadGIF,
  getGIFThumbnailURL,
  gifMediaURL,
  GIFSearchError,
  parseGIFResults,
  searchGIFs,
  toGIFSearchError,
} from "../../../frontend/Chat/Emoji/media";
import { createStickerFile, filterStickers, stickerCatalog } from "../../../frontend/Chat/Emoji/stickers";
import {
  insertImage,
  removeImageForAttachment,
  removeOrphanedInlineAttachments,
} from "../../../frontend/Shared/Editor/InsertImage";
import { ContentDisposition, type Attachment } from "../../../logic/Abstract/Attachment";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import ImageResize from "tiptap-extension-resize-image";
import { ArrayColl } from "svelte-collections";

afterEach(() => {
  appGlobal.remoteApp = undefined;
  vi.unstubAllGlobals();
});

describe("GIF media", () => {
  const cdn = "https://static.klipy.com/ii/abc";

  function serverGIF(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      title: `GIF ${id}`,
      url: `${cdn}/${id}-md.gif`,
      previewUrl: `${cdn}/${id}-sm.webp`,
      width: 320,
      height: 240,
      size: 1024,
      ...overrides,
    };
  }

  function fakeClient(reply: unknown | Error) {
    return {
      searchGIFs: vi.fn(async () => {
        if (reply instanceof Error) {
          throw reply;
        }
        return reply as { type: string; results: unknown[] };
      }),
    };
  }

  test("keeps only safe GIF results from the provider CDN", () => {
    let result = parseGIFResults({
      type: "gif-results",
      results: [
        serverGIF("valid", { title: " A\nGIF " }),
        serverGIF("http", { url: "http://static.klipy.com/ii/abc/http.gif" }),
        serverGIF("foreign", { url: "https://evil.example.test/foreign.gif" }),
        serverGIF("lookalike", { url: "https://static.klipy.com.evil.test/x.gif" }),
        serverGIF("login", { url: "https://user@static.klipy.com/x.gif" }),
        serverGIF("large", { size: 16 * 1024 * 1024 }),
        serverGIF("../bad-id"),
        serverGIF("valid"),
        null,
        "junk",
      ],
    });

    expect(result).toEqual([{
      id: "valid",
      title: "A GIF",
      url: `${cdn}/valid-md.gif`,
      thumbnail: `${cdn}/valid-sm.webp`,
      width: 320,
      height: 240,
      filesize: 1024,
    }]);
  });

  test("falls back to the GIF itself when the preview is missing or foreign", () => {
    let [gif] = parseGIFResults({ results: [serverGIF("no-preview", { previewUrl: "https://evil.example.test/p.webp" })] });
    expect(gif.thumbnail).toBe(gif.url);
    expect(getGIFThumbnailURL(gif)).toBe(gif.url);
    expect(parseGIFResults(null)).toEqual([]);
    expect(parseGIFResults({ results: "x" })).toEqual([]);
  });

  test("falls back from a failed catalog thumbnail to the source GIF", () => {
    let [gif] = parseGIFResults({ results: [serverGIF("gif-1")] });
    expect(getGIFThumbnailURL(gif)).toBe(gif.thumbnail);
    expect(getGIFThumbnailURL(gif, true)).toBe(gif.url);
  });

  test("searches through the Jackdaw server in the interface language", async () => {
    let client = fakeClient({ type: "gif-results", results: [serverGIF("1")] });
    let fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let result = await searchGIFs("  cats   and dogs ", { client, locale: "ru" });

    expect(result.map(gif => gif.id)).toEqual(["1"]);
    expect(client.searchGIFs).toHaveBeenCalledWith("cats and dogs", "ru", 1);
    // Ключ провайдера только на сервере: рендерер сам к провайдеру не ходит.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("an empty query asks for trending GIFs", async () => {
    let client = fakeClient({ type: "gif-results", results: [] });
    await searchGIFs(null, { client, locale: "en" });
    expect(client.searchGIFs).toHaveBeenCalledWith("", "en", 1);
  });

  test("maps server and connection errors to picker states", async () => {
    let cases: [string, string, boolean][] = [
      ["gifs_unavailable", "server-unconfigured", false],
      ["unknown_type", "server-outdated", false],
      ["gifs_no_license", "no-license", false],
      ["not_connected", "offline", true],
      ["rate_limited", "rate-limited", true],
      ["gifs_failed", "failed", true],
      ["service_unavailable", "failed", true],
    ];
    for (let [code, kind, retryable] of cases) {
      let error = Object.assign(new Error(code), { code });
      let rejection = await searchGIFs("x", { client: fakeClient(error), locale: "en" }).catch(ex => ex);
      expect(rejection).toBeInstanceOf(GIFSearchError);
      expect(rejection.kind).toBe(kind);
      expect(rejection.isRetryable).toBe(retryable);
    }
    expect(toGIFSearchError(new Error("boom")).kind).toBe("failed");
  });

  test("accepts only https media from the provider CDN", () => {
    expect(gifMediaURL(`${cdn}/a.gif`)).toBe(`${cdn}/a.gif`);
    expect(gifMediaURL("https://static2.klipy.com/a.gif")).toBe("https://static2.klipy.com/a.gif");
    expect(gifMediaURL("https://static.klipy.com:8443/a.gif")).toBeNull();
    expect(gifMediaURL("https://api.klipy.com/a.gif")).toBeNull();
    expect(gifMediaURL("javascript:alert(1)")).toBeNull();
    expect(gifMediaURL(42)).toBeNull();
  });

  test("downloads a selected GIF as an attachment file", async () => {
    let fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([71, 73, 70, 56]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    let [gif] = parseGIFResults({ results: [serverGIF("gif-42")] });
    let file = await downloadGIF(gif);

    expect(fetchMock).toHaveBeenCalledWith(`${cdn}/gif-42-md.gif`, expect.anything());
    expect(file.name).toBe("gif-gif-42.gif");
    expect(file.type).toBe("image/gif");
    expect(file.size).toBe(4);
  });

  test("refuses to download from outside the provider CDN or a non-GIF file", async () => {
    let fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
    let [gif] = parseGIFResults({ results: [serverGIF("gif-1")] });

    await expect(downloadGIF({ ...gif, url: "https://evil.example.test/x.gif" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(downloadGIF(gif)).rejects.toThrow("not a GIF");
  });
});

describe("sticker media", () => {
  test("filters the built-in catalog by Russian keywords", () => {
    expect(filterStickers("привет").map(sticker => sticker.id)).toEqual(["wave"]);
    expect(filterStickers(null)).toHaveLength(stickerCatalog.length);
  });

  test("creates a self-contained SVG attachment", async () => {
    let file = createStickerFile(stickerCatalog[0]);

    expect(file.name).toBe("sticker-thumbs-up.svg");
    expect(file.type).toBe("image/svg+xml");
    expect(await file.text()).toContain("<svg");
  });
});

describe("inline media lifecycle", () => {
  test("inserts media with a fixed resize container", async () => {
    let insertedImage: any;
    let chain = {
      focus: vi.fn(),
      insertContent: vi.fn(),
      setImage: vi.fn((image: any) => {
        insertedImage = image;
        return chain;
      }),
      run: vi.fn(() => true),
    };
    chain.focus.mockReturnValue(chain);
    let focus = vi.fn();
    let editor = { chain: () => chain, view: { dom: { focus } } } as unknown as Editor;
    let attachment = {
      fromFile: vi.fn(),
      disposition: ContentDisposition.unknown,
      related: false,
      dataURL: null,
    } as any;
    let message = {
      newAttachment: vi.fn(() => attachment),
      attachments: { add: vi.fn() },
    } as any;

    await insertImage(editor, new File(["sticker"], "sticker.svg", { type: "image/svg+xml" }), message, 128);

    expect(insertedImage).toEqual(expect.objectContaining({
      width: 128,
      containerStyle: "width: 128px; height: auto;",
      wrapperStyle: "display: block; margin: 0;",
    }));
    expect(chain.setImage).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(chain.insertContent).not.toHaveBeenCalled();
    expect(message.attachments.add).toHaveBeenCalledWith(attachment);
  });

  test("inserts into the resize-image node used by the editor schema", async () => {
    let root = document.createElement("div");
    document.body.append(root);
    let editor = new Editor({
      element: root,
      extensions: [
        StarterKit,
        ImageResize.configure({ allowBase64: true, inline: false }),
      ],
      content: "<p></p>",
    });
    let attachment = {
      fromFile: vi.fn(),
      disposition: ContentDisposition.unknown,
      related: false,
      dataURL: null,
    } as any;
    let message = {
      newAttachment: vi.fn(() => attachment),
      attachments: { add: vi.fn() },
    } as any;

    try {
      await insertImage(editor, new File(["sticker"], "sticker.svg", { type: "image/svg+xml" }), message, 128);

      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: "imageResize",
        attrs: {
          width: 128,
          containerStyle: "width: 128px; height: auto;",
          wrapperStyle: "display: block; margin: 0;",
        },
      });
    } finally {
      editor.destroy();
      root.remove();
    }
  });

  test("removes all matching image nodes with an attachment", () => {
    let dataURL = "data:image/svg+xml;base64,sticker";
    let imageNode = { type: { name: "imageResize" }, attrs: { src: dataURL }, nodeSize: 1 };
    let deletedRanges: Array<{ from: number; to: number }> = [];
    let transaction = {
      delete(from: number, to: number) {
        deletedRanges.push({ from, to });
        return this;
      },
    };
    let editor = {
      state: {
        doc: {
          descendants(callback: (node: any, position: number) => boolean) {
            callback(imageNode, 5);
            callback(imageNode, 9);
            return true;
          },
          nodeAt() {
            return imageNode;
          },
        },
        tr: transaction,
      },
      view: { dispatch: vi.fn() },
    } as unknown as Editor;
    let attachment = { dataURL, contentID: null } as unknown as Attachment;

    expect(removeImageForAttachment(editor, attachment)).toBe(true);
    expect(deletedRanges).toEqual([{ from: 9, to: 10 }, { from: 5, to: 6 }]);
    expect(editor.view.dispatch).toHaveBeenCalledWith(transaction);
  });

  test("removes inline attachments that are no longer referenced", () => {
    let keptURL = "data:image/gif;base64,kept";
    let removedURL = "data:image/svg+xml;base64,removed";
    let kept = {
      dataURL: keptURL,
      disposition: ContentDisposition.inline,
      related: true,
    } as unknown as Attachment;
    let removed = {
      dataURL: removedURL,
      disposition: ContentDisposition.inline,
      related: true,
    } as unknown as Attachment;
    let regular = {
      dataURL: removedURL,
      disposition: ContentDisposition.attachment,
      related: false,
    } as unknown as Attachment;
    let attachments = new ArrayColl([kept, removed, regular]);
    let editor = {
      state: {
        doc: {
          descendants(callback: (node: any, position: number) => boolean) {
            callback({ type: { name: "imageResize" }, attrs: { src: keptURL } }, 3);
            return true;
          },
        },
      },
    } as unknown as Editor;
    let message = { attachments } as any;

    removeOrphanedInlineAttachments(editor, message);

    expect(attachments.contents).toEqual([kept, regular]);
  });
});
