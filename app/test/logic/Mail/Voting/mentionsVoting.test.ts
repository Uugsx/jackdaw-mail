// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import {
  base64ToBytes, buildVerbStream, bytesToBase64, kVerbStreamField, parseVerbStream, parseVotingHeader, parseVotingOptions,
  tallyVotes, voteOfReply, voteSubject, votingHeaderValue,
} from "../../../../logic/Mail/Voting/Voting";
import { ewsVotingProperties, ewsVotingRequest, parseExchangeVoting } from "../../../../logic/Mail/Voting/VotingExchange";
import { addEWSExtendedProperties } from "../../../../logic/Mail/SendLater/EWSDeferredSend";
import {
  addMentionedRecipient, htmlMentionsAccount, mentionHTML, mentionQueryBeforeCursor, mentionedAddresses,
} from "../../../../logic/Mail/Mentions/Mentions";
import { SearchEMail } from "../../../../logic/Mail/Store/SearchEMail";
import { QuickSearchEMail } from "../../../../logic/Mail/Store/QuickSearchEMail";
import { ArrayColl, MapColl } from "svelte-collections";
import { describe, expect, test } from "vitest";

describe("Голосование", () => {
  test("Варианты: без пустых, повторов и лишней длины", () => {
    expect(parseVotingOptions(" Да ;Нет;; да ")).toEqual(["Да", "Нет"]);
    expect(parseVotingOptions(Array.from({ length: 30 }, (_, i) => "v" + i)).length).toBe(20);
    expect(parseVotingOptions(["x".repeat(100)])[0].length).toBe(64);
  });

  test("Заголовок — только ASCII и читается обратно", () => {
    let value = votingHeaderValue(["Утвердить", "Отклонить; позже"]);
    expect(/^[\x20-\x7e]*$/.test(value)).toBe(true);
    expect(parseVotingHeader(value)).toEqual(["Утвердить", "Отклонить; позже"]);
    expect(parseVotingHeader("%E0%A4%A;Ok")).toEqual(["Ok"]);
  });

  test("PidLidVerbStream: формат и обратное чтение", () => {
    let stream = buildVerbStream(["Утвердить", "Reject"]);
    // Version 0x0102, Count 2
    expect([...stream.slice(0, 6)]).toEqual([0x02, 0x01, 2, 0, 0, 0]);
    // VerbType 4 = голосование
    expect([...stream.slice(6, 10)]).toEqual([4, 0, 0, 0]);
    expect(parseVerbStream(stream)).toEqual(["Утвердить", "Reject"]);
    expect(parseVerbStream(base64ToBytes(bytesToBase64(stream)))).toEqual(["Утвердить", "Reject"]);
    expect(parseVerbStream(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  test("Свойства Exchange при отправке и в нужном месте XML", () => {
    let mail: any = { headers: new MapColl<string, string>() };
    mail.headers.set("X-Jackdaw-Voting", votingHeaderValue(["Да", "Нет"]));
    let properties = ewsVotingProperties(mail);
    expect(properties.length).toBe(1);
    expect(properties[0].t$ExtendedFieldURI.PropertyId).toBe(0x8520);
    expect(parseVerbStream(base64ToBytes(properties[0].t$Value))).toEqual(["Да", "Нет"]);
    let message: any = { t$Subject: "s", t$Body: "b", t$ToRecipients: [] };
    addEWSExtendedProperties(message, properties);
    expect(Object.keys(message)).toEqual(["t$Subject", "t$Body", "t$ExtendedProperty", "t$ToRecipients"]);

    let reply: any = { headers: new MapColl<string, string>() };
    reply.headers.set("X-Jackdaw-Vote", encodeURIComponent("Да"));
    expect(ewsVotingProperties(reply)).toEqual([{ t$ExtendedFieldURI: expect.objectContaining({ PropertyId: 0x8524 }), t$Value: "Да" }]);
  });

  test("Ответ Exchange с вариантами", () => {
    let value = bytesToBase64(buildVerbStream(["Approve", "Reject"]));
    let response = [{ Items: { Message: { ExtendedProperty: [
      { ExtendedFieldURI: { ...kVerbStreamField, PropertyId: String(0x8520) }, Value: value },
    ] } } }];
    expect(parseExchangeVoting(response)).toEqual({ options: ["Approve", "Reject"], vote: null });
    expect(ewsVotingRequest("item-1").m$GetItem.m$ItemIds.t$ItemId).toEqual([{ Id: "item-1" }]);
  });

  test("Тема ответа и выбранный вариант", () => {
    expect(voteSubject("Утвердить", "Re: Бюджет")).toBe("Утвердить: Бюджет");
    expect(voteOfReply({ subject: "утвердить: Бюджет" }, ["Утвердить", "Отклонить"])).toBe("Утвердить");
    expect(voteOfReply({ subject: "Re: Бюджет", vote: "Отклонить" }, ["Утвердить", "Отклонить"])).toBe("Отклонить");
    expect(voteOfReply({ subject: "Бюджет" }, ["Утвердить"])).toBeNull();
  });

  test("Сводка: последний ответ человека", () => {
    let original = { messageID: "<m1@x>", subject: "Бюджет" };
    let person = (address: string) => ({ emailAddress: address, name: "" }) as any;
    let tally = tallyVotes(original, ["Утвердить", "Отклонить"], [
      { subject: "Утвердить: Бюджет", inReplyTo: "<m1@x>", from: person("a@x"), received: new Date(1), sent: null },
      { subject: "Отклонить: Бюджет", inReplyTo: "<m1@x>", from: person("a@x"), received: new Date(2), sent: null },
      { subject: "Утвердить: Бюджет", inReplyTo: null, from: person("b@x"), received: new Date(3), sent: null },
      { subject: "Утвердить: Другое", inReplyTo: null, from: person("c@x"), received: new Date(4), sent: null },
    ]);
    expect(tally).toEqual([
      { option: "Утвердить", voters: ["b@x"] },
      { option: "Отклонить", voters: ["a@x"] },
    ]);
  });
});

describe("Упоминания", () => {
  test("Запрос у курсора", () => {
    expect(mentionQueryBeforeCursor("Привет, @ива")).toEqual({ query: "ива", length: 4 });
    expect(mentionQueryBeforeCursor("@")).toEqual({ query: "", length: 1 });
    expect(mentionQueryBeforeCursor("пишите на ivan@example.com")).toBeNull();
    expect(mentionQueryBeforeCursor("@иван петров")).toBeNull();
  });

  test("Разметка и разбор, экранирование", () => {
    let html = mentionHTML({ name: "Иван <script>", emailAddress: "ivan@example.com" });
    expect(html).toContain('href="mailto:ivan@example.com"');
    expect(html).toContain("@Иван &lt;script&gt;");
    let body = `<p>${html} и <a href="mailto:petr@example.com">Пётр</a>, ` +
      `<a id="OWAAM123" href="mailto:Anna@Example.com">@Анна</a></p>`;
    expect(mentionedAddresses(body)).toEqual(["ivan@example.com", "anna@example.com"]);
    let me = { isMyEMailAddress: (address: string) => address == "anna@example.com" };
    expect(htmlMentionsAccount(body, me)).toBe(true);
    expect(htmlMentionsAccount("<p>@Анна</p>", me)).toBe(false);
  });

  test("Упомянутый попадает в «Кому» один раз", () => {
    let mail: any = { to: new ArrayColl<any>(), cc: new ArrayColl<any>([{ emailAddress: "Petr@x" }]), bcc: new ArrayColl<any>() };
    expect(addMentionedRecipient(mail, { emailAddress: "ivan@x" } as any)).toBe(true);
    expect(addMentionedRecipient(mail, { emailAddress: "IVAN@x" } as any)).toBe(false);
    expect(addMentionedRecipient(mail, { emailAddress: "petr@x" } as any)).toBe(false);
    expect(mail.to.length).toBe(1);
  });

  test("Фильтр «Упоминания меня» сохраняется", () => {
    let search = new SearchEMail();
    search.mentionsMe = true;
    let copy = search.clone();
    expect(copy.mentionsMe).toBe(true);
    let account = { isMyEMailAddress: (address: string) => address == "me@x" };
    let folder: any = { account };
    let email = (html: string, outgoing = false): any => ({ outgoing, folder, rawHTMLDangerous: html, isRead: true });
    expect(search.matches(email(`<a href="mailto:me@x">@Я</a>`))).toBe(true);
    expect(search.matches(email(`<a href="mailto:other@x">@Он</a>`))).toBe(false);
    expect(search.matches(email(`<a href="mailto:me@x">@Я</a>`, true))).toBe(false);
  });

  test("Быстрый фильтр списка «Упоминания меня»", async () => {
    let account = { isMyEMailAddress: (address: string) => address == "me@x" };
    let folder: any = { account };
    let email = (html: string): any => ({
      outgoing: false, folder, rawHTMLDangerous: html, isRead: true, isStarred: false,
      isReplied: false, isImportant: false, hasVisibleAttachments: false,
    });
    let mentioned = email(`<a href="mailto:me@x">@Я</a>`);
    folder.messages = new ArrayColl([mentioned, email("<p>Привет</p>")]);
    let search = new QuickSearchEMail();
    search.folder = folder;
    search.mentionsMe = true;
    expect(search.hasSearch()).toBe(true);
    expect((await search.startSearch()).contents).toEqual([mentioned]);
    search.reset();
    expect(search.mentionsMe).toBeNull();
  });
});
