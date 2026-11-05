import { beforeAll, expect, test } from "vitest";
import { newTestEMail, setupTestFolder } from "./SQL/setup";
import { appGlobal } from "../../../logic/app";
import {
  classifyRelatedMail,
  extractRelatedFeatures,
  findRelatedEmails,
  groupRelatedMailMatches,
  isSpecificRelatedTopic,
  relatedSubjectTopic,
  type RelatedMailContext,
  type RelatedMailFeature,
} from "../../../logic/Mail/RelatedEMail";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { Folder } from "../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { getDatabase } from "../../../logic/Mail/SQL/SQLDatabase";
import { SQLEMail } from "../../../logic/Mail/SQL/SQLEMail";
import { findOrCreatePersonUID } from "../../../logic/Abstract/PersonUID";
import type { EMail } from "../../../logic/Mail/EMail";
import sql from "../../../../lib/rs-sqlite";

// Обезличенные примеры: служба поддержки на support.example, головная компания — parent.example
const kContext: RelatedMailContext = {
  ownAddresses: ["integrators@support.example"],
  internalDomains: ["parent.example"],
};

function featureLabels(features: RelatedMailFeature[]): string[] {
  return features.map(feature => `${feature.kind}=${feature.label}`);
}

test("extracts client number, request number, order and tax ID", () => {
  const labels = featureLabels(extractRelatedFeatures({
    subject: "RE: ошибка 500. КН 1001011949 Обращение: 20102026-10921\\1",
    body: [
      "Заказ RU122736593 не обновляется, ИКН 1001064286.",
      "Номер заказа: 5590012345",
      "ИНН/КПП 7701234567/770101001",
      "Срок ответа 30 минут, дата 15.09.2026, телефон +7 (495) 123-45-67",
    ].join("\n"),
  }, kContext));
  expect(labels).toEqual(expect.arrayContaining([
    "ticket=20102026-10921",
    "customer=1001011949",
    "customer=1001064286",
    "order=RU122736593",
    "order=5590012345",
    "inn=7701234567",
  ]));
  expect(labels.filter(label => label.startsWith("reference="))).toEqual([]);
  expect(labels.some(label => label.includes("15.09.2026") || label.includes("495"))).toBe(false);
});

test("recognizes a bare DPD client number but not an unrelated long number", () => {
  const labels = featureLabels(extractRelatedFeatures({
    subject: "Статусы по 1001058111",
    body: "Сумма 2500123456 руб., дата 21102026",
  }));
  expect(labels).toContain("customer=1001058111");
  expect(labels.some(label => label.includes("2500123456"))).toBe(false);
  expect(labels.some(label => label.startsWith("ticket="))).toBe(false);
});

test("extracts the client company from external text only", () => {
  const labels = featureLabels(extractRelatedFeatures({
    authorEmail: "anna@romashka.test",
    subject: "Не приходят статусы",
    body: [
      "Добрый день!",
      "С уважением, Анна",
      "ООО «Ромашка Логистик»",
      "",
      "21.10.2026, 16:23, \"integrators\" <integrators@support.example",
      "> [integrators@support.example]>:",
      "> Проверим.",
      "> ООО «Служба Поддержки»",
      "",
      "> From: Пётр <petr@trofimova-shop.test>",
      "> ИП Трофимова, магазин",
    ].join("\n"),
  }, kContext));
  expect(labels).toContain("company=ООО «Ромашка Логистик»");
  expect(labels).toContain("company=ИП Трофимова");
  expect(labels.some(label => label.includes("Служба Поддержки"))).toBe(false);
});

test("keeps external participants and drops own, service and parent company addresses", () => {
  const features = extractRelatedFeatures({
    participants: [
      { emailAddress: "Mr.Client@gmail.com" },
      { emailAddress: "integrators@support.example" },
      { emailAddress: "colleague@support.example" },
      { emailAddress: "clients_orders_crm@parent.example" },
      { emailAddress: "manager@parent.by" },
      { emailAddress: "noreply@shop.test" },
      { emailAddress: "logist@client-company.test" },
      { emailAddress: "unknown@invalid" },
    ],
    body: "> From: Иван <ivan@forwarded-client.test>",
  }, kContext);
  const addresses = features.filter(feature => feature.kind == "address").map(feature => feature.value);
  expect(addresses.sort()).toEqual([
    "ivan@forwarded-client.test",
    "logist@client-company.test",
    "mr.client@gmail.com",
  ]);
  const domains = features.filter(feature => feature.kind == "domain").map(feature => feature.value);
  expect(domains.sort()).toEqual(["client-company.test", "forwarded-client.test"]);
});

test("normalizes subjects and treats generic support topics as weak", () => {
  expect(relatedSubjectTopic("RE: ошибка 500. КН 1001011949 Обращение: 20102026-10921\\1")).toBe("ошибка 500");
  expect(relatedSubjectTopic("Ha: FW: Вопрос по API")).toBe("вопрос по api");
  expect(isSpecificRelatedTopic(relatedSubjectTopic("RE: Вопрос по API"))).toBe(false);
  expect(isSpecificRelatedTopic(relatedSubjectTopic("RE: ошибка при со"))).toBe(false);
  expect(isSpecificRelatedTopic(relatedSubjectTopic("Отсутствие данных водителя от DPD"))).toBe(true);
});

test("one message with several shared signals is listed once, under its strongest one", () => {
  const signal = classifyRelatedMail(
    {
      subject: "Re: Вопрос по API",
      body: "По КН 1001064286 нужна история статусов.",
      participants: [{ emailAddress: "client@gmail.com" }],
    },
    {
      subject: "Не приходят статусы",
      body: "КН 1001064286, заказ RU122736593",
      participants: [{ emailAddress: "client@gmail.com" }],
    },
    kContext,
  )!;
  expect(signal.features.map(feature => feature.kind)).toEqual(["customer", "address"]);
  const groups = groupRelatedMailMatches([{
    email: { subject: "Не приходят статусы" } as EMail,
    ...signal,
  }]);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ feature: "customer", label: "1001064286" });
});

let inbox: Folder;
let source: EMail;
const saved = new Map<string, EMail>();

async function saveMail(folder: Folder, id: string, options: {
  from: string;
  to?: string[];
  subject: string;
  text: string;
  outgoing?: boolean;
  sent?: string;
}): Promise<EMail> {
  const email = newTestEMail(folder, id);
  email.from = findOrCreatePersonUID(options.from, options.from.split("@")[0]);
  email.to.clear();
  for (const address of options.to ?? ["integrators@support.example"]) {
    email.to.add(findOrCreatePersonUID(address, address.split("@")[0]));
  }
  email.outgoing = options.outgoing ?? false;
  email.contact = email.outgoing ? email.to.first! : email.from;
  email.subject = options.subject;
  email.text = options.text;
  email.sent = new Date(options.sent ?? "2026-10-21T10:00:00Z");
  email.received = email.sent;
  await SQLEMail.save(email);
  saved.set(id, email);
  return email;
}

async function addFolder(account: MailAccount, accountDBID: number, name: string): Promise<Folder> {
  const folder = new Folder(account);
  folder.name = name;
  folder.id = name;
  const row = await (await getDatabase()).run(sql`
    INSERT INTO folder (accountID, name, path) VALUES (${accountDBID}, ${name}, ${name})`);
  folder.dbID = row.lastInsertRowid;
  account.rootFolders.add(folder);
  return folder;
}

beforeAll(async () => {
  ({ folder: inbox } = await setupTestFolder());
  const account = inbox.account;
  account.emailAddress = "integrators@support.example";
  account.rootFolders.add(inbox);
  const database = await getDatabase();
  const accountRow = await database.get<{ id: number }>(sql`SELECT id FROM emailAccount LIMIT 1`);
  account.dbID = accountRow!.id;
  appGlobal.emailAccounts.add(account);
  const sent = await addFolder(account, accountRow!.id, "Sent");

  // Общий ящик — отдельный аккаунт
  const shared = new MailAccount();
  shared.name = "Shared";
  shared.emailAddress = "clients_orders_crm@parent.example";
  shared.storage = new DummyMailStorage();
  const sharedRow = await database.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${shared.id}, ${"owa"})`);
  shared.dbID = sharedRow.lastInsertRowid;
  appGlobal.emailAccounts.add(shared);
  const sharedInbox = await addFolder(shared, sharedRow.lastInsertRowid, "Shared inbox");

  source = await saveMail(inbox, "source@test", {
    from: "fedor.client@gmail.com",
    subject: "Re: Вопрос по API",
    text: "Как получить историю статусов? По КН 1001064286 подключено отслеживание.",
  });
  await saveMail(inbox, "other-client-same-subject@test", {
    from: "someone@another-client.test",
    subject: "RE: Вопрос по API",
    text: "Не работает метод создания заказа, КН 1009999999.",
  });
  await saveMail(inbox, "other-client-generic@test", {
    from: "logist@third-client.test",
    subject: "Вопрос по API",
    text: "Подскажите метод получения статусов.",
  });
  await saveMail(inbox, "same-client-other-subject@test", {
    from: "fedor.client@gmail.com",
    subject: "Не приходят статусы по заказам",
    text: "Добрый день, статусы перестали приходить.",
    sent: "2026-09-01T10:00:00Z",
  });
  await saveMail(sent, "reply-in-sent@test", {
    from: "integrators@support.example",
    to: ["fedor.client@gmail.com"],
    outgoing: true,
    subject: "RE: Подключение Event Tracking",
    text: "Подключили отслеживание.",
    sent: "2026-08-01T10:00:00Z",
  });
  await saveMail(sharedInbox, "colleague-mentions-icn@test", {
    from: "manager@parent.example",
    subject: "Хранилище чеков",
    text: "Клиент с ИКН 1001064286 просит выгрузку.",
    sent: "2026-07-01T10:00:00Z",
  });
});

test("finds the same client across subjects, folders and mailboxes, but not other clients with the same subject", async () => {
  const progress: number[] = [];
  const matches = await findRelatedEmails(source, undefined, partial => progress.push(partial.length));
  const ids = matches.map(match => match.email.id).sort();
  expect(ids).toEqual([
    "colleague-mentions-icn@test",
    "reply-in-sent@test",
    "same-client-other-subject@test",
  ]);
  expect(progress[0]).toBeGreaterThan(0);

  const byID = new Map(matches.map(match => [match.email.id, match]));
  expect(byID.get("colleague-mentions-icn@test")!.features![0]).toMatchObject({
    kind: "customer", value: "1001064286",
  });
  expect(byID.get("same-client-other-subject@test")!.features![0]).toMatchObject({
    kind: "address", value: "fedor.client@gmail.com",
  });
  expect(byID.get("reply-in-sent@test")!.email.folder?.name).toBe("Sent");

  const groups = groupRelatedMailMatches(matches);
  expect(groups.map(group => group.feature)).toEqual(["customer", "address"]);
  expect(groups[1].matches.map(match => match.email.id)).toEqual([
    "same-client-other-subject@test",
    "reply-in-sent@test",
  ]);
});
