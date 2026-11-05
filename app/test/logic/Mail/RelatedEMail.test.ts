import { beforeAll, expect, test } from "vitest";
import {
  classifyRelatedMail,
  extractRelatedIdentifiers,
  findRelatedEmails,
  groupRelatedMailMatches,
  normalizeRelatedSubject,
} from "../../../logic/Mail/RelatedEMail";
import { getDatabase } from "../../../logic/Mail/SQL/SQLDatabase";
import { SQLEMail } from "../../../logic/Mail/SQL/SQLEMail";
import { newTestEMail, setupTestFolder } from "./SQL/setup";
import type { EMail } from "../../../logic/Mail/EMail";
import type { Folder } from "../../../logic/Mail/Folder";
import sql from "../../../../lib/rs-sqlite";

let folder: Folder;
let sourceEmail: EMail;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
  folder.account.rootFolders.add(folder);
  let accountRow = await (await getDatabase()).get<{ id: number }>(
    sql`SELECT id FROM emailAccount LIMIT 1`,
  );
  folder.account.dbID = accountRow?.id ?? null;

  sourceEmail = newTestEMail(folder, "source@example.com");
  sourceEmail.subject = "Вопрос по заявке #ABC-12345";
  sourceEmail.text = "Нужна проверка статуса заявки и сроков ответа.";
  await SQLEMail.save(sourceEmail);

  let parallelEmail = newTestEMail(folder, "parallel@example.com");
  parallelEmail.subject = "Повтор по заявке #ABC-12345";
  parallelEmail.text = "Подскажите, пожалуйста, есть ли новости по заявке.";
  await SQLEMail.save(parallelEmail);
});

test("normalizes reply prefixes without changing the topic", () => {
  expect(normalizeRelatedSubject("Re: FW: Ошибка интеграции API")).toBe(
    "ошибка интеграции api",
  );
});

test("recognizes an exact duplicate without treating a bare number as an identifier", () => {
  const source = {
    subject: "Вопрос по интеграции",
    body: "Проверьте, пожалуйста, подключение к API и верните результат.",
  };
  expect(classifyRelatedMail(source, { ...source })).toMatchObject({
    reason: "duplicate",
    score: 1,
  });
  expect(extractRelatedIdentifiers("Срок ответа 30 минут, дата 15.09.2026")).toEqual([]);
});

test("does not treat a technical error code as a request identifier", () => {
  expect(extractRelatedIdentifiers("Ошибка обработки адреса: ORA-20201")).toEqual([]);
  expect(extractRelatedIdentifiers("Номер КН-1001058111")).toContain("кн-1001058111");
});

test("recognizes a labeled customer number across different subjects", () => {
  const signal = classifyRelatedMail(
    {
      subject: "Re: Syle, клиент 1010002318",
      body: "Заявка всё ещё не создаётся.",
    },
    {
      subject: "ORA-20799 при создании заказа",
      body: "Проверка клиента 1010002318 завершилась ошибкой.",
    },
  );
  expect(signal).toMatchObject({ reason: "same-identifier" });
  expect(signal?.sharedIdentifiers).toContain("1010002318");
});

test("links the same corporate domain only as the weakest client signal", () => {
  const signal = classifyRelatedMail(
    { subject: "Проблема с заказом", body: "Нужна проверка.", contactEmail: "hello@syle.ru" },
    { subject: "Уточнение по интеграции", body: "Есть новости?", contactEmail: "support@syle.ru" },
  );
  expect(signal).toMatchObject({ reason: "same-domain" });
  expect(signal!.score).toBeLessThan(0.5);
  expect(classifyRelatedMail(
    { subject: "Проблема с заказом", body: "Нужна проверка.", contactEmail: "hello@gmail.com" },
    { subject: "Уточнение по интеграции", body: "Есть новости?", contactEmail: "support@gmail.com" },
  )).toBeNull();
});

test("connects parallel messages by a request identifier", () => {
  const signal = classifyRelatedMail(
    { subject: "Вопрос по заявке #ABC-12345", body: "Нужна проверка." },
    { subject: "Повтор по заявке #ABC-12345", body: "Есть новости?" },
  );
  expect(signal).toMatchObject({ reason: "same-identifier" });
  expect(signal?.sharedIdentifiers).toContain("#abc-12345");
});

test("recognizes an existing mail conversation by thread or message reference", () => {
  expect(
    classifyRelatedMail(
      { threadID: "thread-1", subject: "Вопрос клиента" },
      { threadID: "thread-1", subject: "Re: Вопрос клиента" },
    ),
  ).toMatchObject({ reason: "same-thread" });
  expect(
    classifyRelatedMail(
      { messageID: "<source@example.test>", subject: "Вопрос клиента" },
      { inReplyTo: "<source@example.test>", subject: "Re: Вопрос клиента" },
    ),
  ).toMatchObject({ reason: "same-identifier" });
});

test("does not link messages only by a generic support subject", () => {
  expect(classifyRelatedMail(
    {
      subject: "Ошибка интеграции API",
      body: "Не удается получить ответ клиента при интеграции API.",
    },
    {
      subject: "RE: Ошибка интеграции API",
      body: "При интеграции API не приходит ответ от клиента.",
    },
  )).toBeNull();
});

test("finds a similar specific topic from shared meaningful words", () => {
  const signal = classifyRelatedMail(
    { subject: "Не закрываются заказы на пункты выдачи", body: "Проверьте, пожалуйста." },
    { subject: "RE: Не закрываются заказы на пункты выдачи", body: "Есть новости?" },
  );
  expect(signal).toMatchObject({ reason: "same-topic" });
  expect(signal!.features.map(feature => feature.kind)).toEqual(["subject"]);
});

test("does not connect unrelated messages with common boilerplate only", () => {
  expect(
    classifyRelatedMail(
      { subject: "График отпуска", body: "Нужен согласованный график." },
      { subject: "Пароль Wi-Fi", body: "Нужен доступ к сети." },
    ),
  ).toBeNull();
});

test("groups related messages by identifier and normalized topic", () => {
  const makeMatch = (subject: string, reason: "same-identifier" | "same-topic", sharedIdentifiers: string[] = []) => ({
    email: { subject, threadID: null } as EMail,
    reason,
    score: 0.8,
    sharedIdentifiers,
  });
  const groups = groupRelatedMailMatches([
    makeMatch("Re: Вопрос по заявке", "same-identifier", ["#abc-123"]),
    makeMatch("Вопрос по заявке", "same-identifier", ["#abc-123"]),
    makeMatch("RE: Вопрос по интеграции", "same-topic"),
    makeMatch("Вопрос по интеграции", "same-topic"),
  ]);

  expect(groups).toHaveLength(2);
  expect(groups[0]).toMatchObject({ kind: "identifier", label: "#abc-123" });
  expect(groups[0].matches).toHaveLength(2);
  expect(groups[1]).toMatchObject({ kind: "topic", label: "RE: Вопрос по интеграции" });
  expect(groups[1].matches).toHaveLength(2);
});

test("finds a related message through the local SQLite index", async () => {
  const rows = await (await getDatabase()).all<{ id: number; accountID: number; subject: string }>(sql`
    SELECT e.id, f.accountID, e.subject
    FROM email e JOIN folder f ON f.id = e.folderID
    ORDER BY e.id
  `);
  expect(rows).toHaveLength(2);
  expect(sourceEmail.dbID).toBeTruthy();
  expect(folder.account.dbID).toBeTruthy();

  const matches = await findRelatedEmails(sourceEmail);

  expect(matches).toHaveLength(1);
  expect(matches[0].reason).toBe("same-identifier");
  expect(matches[0].email.id).toBe("parallel@example.com");
  expect(matches[0].sharedIdentifiers).toContain("#abc-12345");
});
