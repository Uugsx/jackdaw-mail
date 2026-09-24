// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from "vitest";
import { appGlobal } from "../../../logic/app";
import { downloadGIF, getGIFThumbnailURL, parseGIFResults, searchGIFs } from "../../../frontend/Chat/Emoji/media";
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
  test("keeps only safe GIF results", () => {
    let result = parseGIFResults({
      results: [
        {
          id: "valid",
          title: " A GIF ",
          url: "https://cdn.example.test/valid.gif",
          thumbnail: "https://cdn.example.test/valid-preview.gif",
          filetype: "gif",
          filesize: 1024,
        },
        {
          id: "http",
          url: "http://cdn.example.test/http.gif",
          thumbnail: "https://cdn.example.test/http-preview.gif",
          filetype: "gif",
        },
        {
          id: "png",
          url: "https://cdn.example.test/image.png",
          thumbnail: "https://cdn.example.test/image.png",
          filetype: "png",
        },
        {
          id: "large",
          url: "https://cdn.example.test/large.gif",
          thumbnail: "https://cdn.example.test/large-preview.gif",
          filetype: "gif",
          filesize: 16 * 1024 * 1024,
        },
      ],
    });

    expect(result).toEqual([expect.objectContaining({ id: "valid", title: "A GIF" })]);
  });

  test("searches the catalog with the GIF filter", async () => {
    let fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await searchGIFs("cats");

    expect(fetchMock).toHaveBeenCalledOnce();
    let requestURL = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestURL.searchParams.get("q")).toBe("cats");
    expect(requestURL.searchParams.get("extension")).toBe("gif");
  });

  test("keeps a GIF when the catalog has no usable thumbnail", () => {
    let [gif] = parseGIFResults({
      results: [{
        id: "source-only",
        title: "Source GIF",
        url: "https://cdn.example.test/source-only.gif",
        filetype: "gif",
      }],
    });

    expect(gif.thumbnail).toBe(gif.url);
    expect(getGIFThumbnailURL(gif)).toBe(gif.url);
  });

  test("falls back from a failed catalog thumbnail to the source GIF", () => {
    let gif = {
      id: "gif-1",
      title: "Hello",
      url: "https://cdn.example.test/hello.gif",
      thumbnail: "https://api.example.test/thumb/",
      creator: null,
      license: null,
      foreignLandingURL: null,
      filesize: null,
    };

    expect(getGIFThumbnailURL(gif)).toBe(gif.thumbnail);
    expect(getGIFThumbnailURL(gif, true)).toBe(gif.url);
  });

  test("does not route the catalog JSON through the desktop bridge", async () => {
    let fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [{
          id: "gif-1",
          title: "Hello",
          url: "https://cdn.example.test/hello.gif",
          thumbnail: "https://cdn.example.test/hello-preview.gif",
          filetype: "gif",
        }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    appGlobal.remoteApp = { kyCreate: vi.fn() } as any;

    let result = await searchGIFs("hello");

    expect(result).toHaveLength(1);
    expect(appGlobal.remoteApp.kyCreate).not.toHaveBeenCalled();
  });

  test("downloads a selected GIF as an attachment file", async () => {
    let fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([71, 73, 70, 56]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    let file = await downloadGIF({
      id: "gif/42",
      title: "A GIF",
      url: "https://cdn.example.test/gif.gif",
      thumbnail: "https://cdn.example.test/preview.gif",
      creator: null,
      license: null,
      foreignLandingURL: null,
      filesize: 4,
    });

    expect(file.name).toBe("gif-gif-42.gif");
    expect(file.type).toBe("image/gif");
    expect(file.size).toBe(4);
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
