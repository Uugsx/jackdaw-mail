/**
 * Витрина демо-режима: правдоподобные рабочие данные для снимков экрана и показа.
 *
 * Включается только вместе с `--jackdaw-demo` и `localStorage["demo.showcase"] = "1"`.
 * Обычные демо-данные (`testData.ts`, автопроверки) не меняются. Отчёты и живой SLA
 * читают письма из базы, поэтому витрина пишет их в отдельные файлы
 * `showcase-mail.db` / `showcase-chat.db`, которые пересоздаются при каждом запуске.
 * Все люди, компании и адреса вымышленные (домен `.example`).
 */
import { appGlobal } from "./app";
import { ContactEntry, Person } from "./Abstract/Person";
import { PersonUID } from "./Abstract/PersonUID";
import { StreetAddress } from "./Contacts/StreetAddress";
import { SpecialFolder } from "./Mail/Folder";
import type { EMail } from "./Mail/EMail";
import { Participant } from "./Calendar/Participant";
import { InvitationResponse } from "./Calendar/Invitation/InvitationStatus";
import { Directory } from "./Files/Directory";
import { SQLFolder } from "./Mail/SQL/SQLFolder";
import { SQLEMail } from "./Mail/SQL/SQLEMail";
import { SQLChatRoom } from "./Chat/SQL/SQLChatRoom";
import { SQLChatMessage } from "./Chat/SQL/SQLChatMessage";
import { useShowcaseDatabase as useShowcaseMailDatabase, getDatabase as getMailDatabase } from "./Mail/SQL/SQLDatabase";
import { useShowcaseDatabase as useShowcaseChatDatabase } from "./Chat/SQL/SQLDatabase";
import { DeliveryStatus, type ChatMessage } from "./Chat/ChatMessage";
import {
  FakeAddressbook, FakeMailAccount, FakeFolder, FakeEMail, FakeChatAccount, FakeChat,
  FakeCalendar, FakeFileSharingAccount, readAvatarList, avatar,
} from "./testData";
import { FakeMeetAccount } from "./Meet/FakeMeeting";
import { getUILocale } from "../l10n/l10n";
import sql from "../../lib/rs-sqlite";
import { ArrayColl, type Collection } from "svelte-collections";

export function isShowcaseRequested(): boolean {
  try {
    return localStorage.getItem("demo.showcase") == "1";
  } catch {
    return false;
  }
}

type L = { ru: string, en: string };
type Lang = keyof L;

const kDomain = "northwind.example";
const kMinute = 60 * 1000;

/** Повторяемая случайность: одинаковые снимки при каждом запуске */
function makeRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

type PersonSpec = {
  key: string,
  first: L, last: L,
  male: boolean,
  email: string,
  company: L, department: L, position: L,
  phone: string,
  city: L,
};

const kMe: PersonSpec = {
  key: "me", first: { ru: "Анна", en: "Anna" }, last: { ru: "Соколова", en: "Sokolova" }, male: false,
  email: "anna.sokolova@" + kDomain,
  company: { ru: "Норд Логистик", en: "Northwind Logistics" },
  department: { ru: "Клиентская поддержка", en: "Customer support" },
  position: { ru: "Руководитель поддержки", en: "Head of customer support" },
  phone: "+7 495 555-01-10", city: { ru: "Москва", en: "London" },
};

const kPeople: PersonSpec[] = [
  { key: "orlov", first: { ru: "Дмитрий", en: "Daniel" }, last: { ru: "Орлов", en: "Foster" }, male: true,
    email: "d.orlov@vector-retail.example", company: { ru: "Вектор Ритейл", en: "Vector Retail" },
    department: { ru: "Логистика", en: "Logistics" }, position: { ru: "Директор по логистике", en: "Logistics director" },
    phone: "+7 495 555-23-41", city: { ru: "Москва", en: "Manchester" } },
  { key: "morozova", first: { ru: "Елена", en: "Laura" }, last: { ru: "Морозова", en: "Bennett" }, male: false,
    email: "e.morozova@" + kDomain, company: kMe.company,
    department: { ru: "Финансы", en: "Finance" }, position: { ru: "Главный бухгалтер", en: "Chief accountant" },
    phone: "+7 495 555-01-24", city: kMe.city },
  { key: "vasiliev", first: { ru: "Игорь", en: "Michael" }, last: { ru: "Васильев", en: "Reed" }, male: true,
    email: "i.vasiliev@stroymarket.example", company: { ru: "СтройМаркет", en: "BuildMart" },
    department: { ru: "Закупки", en: "Procurement" }, position: { ru: "Менеджер по закупкам", en: "Procurement manager" },
    phone: "+7 812 555-48-02", city: { ru: "Санкт-Петербург", en: "Leeds" } },
  { key: "kuznetsova", first: { ru: "Мария", en: "Sophie" }, last: { ru: "Кузнецова", en: "Turner" }, male: false,
    email: "m.kuznetsova@" + kDomain, company: kMe.company,
    department: { ru: "Персонал", en: "People team" }, position: { ru: "HR-бизнес-партнёр", en: "HR business partner" },
    phone: "+7 495 555-01-31", city: kMe.city },
  { key: "smirnov", first: { ru: "Алексей", en: "Alex" }, last: { ru: "Смирнов", en: "Carter" }, male: true,
    email: "a.smirnov@" + kDomain, company: kMe.company,
    department: { ru: "ИТ", en: "IT" }, position: { ru: "Системный администратор", en: "Systems administrator" },
    phone: "+7 495 555-01-47", city: kMe.city },
  { key: "pavlova", first: { ru: "Ольга", en: "Olivia" }, last: { ru: "Павлова", en: "Hayes" }, male: false,
    email: "o.pavlova@alfapharm.example", company: { ru: "Альфа-Фарм", en: "AlphaPharm" },
    department: { ru: "Снабжение", en: "Supply" }, position: { ru: "Руководитель снабжения", en: "Head of supply" },
    phone: "+7 343 555-71-19", city: { ru: "Екатеринбург", en: "Bristol" } },
  { key: "novikov", first: { ru: "Сергей", en: "Ryan" }, last: { ru: "Новиков", en: "Mitchell" }, male: true,
    email: "s.novikov@" + kDomain, company: kMe.company,
    department: { ru: "Продажи", en: "Sales" }, position: { ru: "Директор по продажам", en: "Sales director" },
    phone: "+7 495 555-01-52", city: kMe.city },
  { key: "belova", first: { ru: "Наталья", en: "Natalie" }, last: { ru: "Белова", en: "Brooks" }, male: false,
    email: "n.belova@" + kDomain, company: kMe.company,
    department: { ru: "Юридический отдел", en: "Legal" }, position: { ru: "Юрист", en: "Legal counsel" },
    phone: "+7 495 555-01-63", city: kMe.city },
  { key: "lebedev", first: { ru: "Павел", en: "Peter" }, last: { ru: "Лебедев", en: "Walsh" }, male: true,
    email: "p.lebedev@transcargo.example", company: { ru: "ТрансКарго", en: "TransCargo" },
    department: { ru: "Операционный отдел", en: "Operations" }, position: { ru: "Операционный директор", en: "Operations director" },
    phone: "+7 383 555-90-05", city: { ru: "Новосибирск", en: "Glasgow" } },
  { key: "fedorova", first: { ru: "Ирина", en: "Grace" }, last: { ru: "Фёдорова", en: "Harper" }, male: false,
    email: "i.fedorova@" + kDomain, company: kMe.company,
    department: { ru: "Маркетинг", en: "Marketing" }, position: { ru: "Руководитель маркетинга", en: "Head of marketing" },
    phone: "+7 495 555-01-78", city: kMe.city },
];

/** Ветка переписки: входящий запрос и наш ответ. `{n}` — номер заказа или счёта. */
type ThreadSpec = { from: string, subject: L, alt: L[], body: L, reply: L };

const kThreads: ThreadSpec[] = [
  { from: "orlov",
    subject: { ru: "Задержка поставки по заказу {n}", en: "Delivery delay on order {n}" },
    alt: [{ ru: "Где машина по заказу {n}?", en: "Where is the truck for order {n}?" }, { ru: "Срочно: склад ждёт поставку {n}", en: "Urgent: warehouse waiting for delivery {n}" }],
    body: {
      ru: "Анна, добрый день!\n\nПо заказу {n} машина должна была прийти вчера до 18:00, но на складе её так и нет. В трекинге статус «в пути» без обновлений с понедельника.\n\nПодскажите, пожалуйста, реальный срок — нам нужно перестроить график отгрузки в магазины.\n\nС уважением,\nДмитрий Орлов\nДиректор по логистике, «Вектор Ритейл»",
      en: "Hi Anna,\n\nThe truck for order {n} was due at our warehouse by 6 pm yesterday, but it still hasn't arrived. Tracking has shown \"in transit\" with no updates since Monday.\n\nCould you give us a realistic ETA? We need to rework our store delivery schedule.\n\nBest regards,\nDaniel Foster\nLogistics director, Vector Retail",
    },
    reply: {
      ru: "Дмитрий, добрый день!\n\nПроверили: машина задержалась на таможенном посту, сейчас уже в пути. Прибытие на ваш склад — сегодня до 16:00. Водитель позвонит за час.\n\nПриносим извинения, компенсацию за задержку оформим в счёте.\n\nАнна Соколова",
      en: "Hi Daniel,\n\nWe've checked: the truck was held at customs and is now on its way. It will reach your warehouse today before 4 pm, and the driver will call an hour ahead.\n\nSorry for the trouble — we'll apply a delay credit on the invoice.\n\nAnna Sokolova",
    } },
  { from: "pavlova",
    subject: { ru: "Нужен температурный режим для партии {n}", en: "Temperature control needed for batch {n}" },
    alt: [{ ru: "Логгер температуры по партии {n}", en: "Temperature logger for batch {n}" }, { ru: "Холодовая цепь: доставка {n}", en: "Cold chain: delivery {n}" }],
    body: {
      ru: "Здравствуйте!\n\nПартия {n} — препараты с хранением +2…+8 °C. Прошу подтвердить, что перевозка будет в рефрижераторе с логгером температуры, и прислать отчёт логгера после доставки.\n\nОльга Павлова\n«Альфа-Фарм»",
      en: "Hello,\n\nBatch {n} contains medicines that must stay at +2…+8 °C. Please confirm it will travel in a refrigerated truck with a temperature logger, and send us the logger report after delivery.\n\nOlivia Hayes\nAlphaPharm",
    },
    reply: {
      ru: "Ольга, здравствуйте!\n\nПодтверждаем: рефрижератор с двумя логгерами, контроль каждые 5 минут. Отчёт пришлём в течение часа после разгрузки.\n\nАнна Соколова",
      en: "Hi Olivia,\n\nConfirmed: refrigerated truck with two loggers recording every 5 minutes. We'll send the report within an hour of unloading.\n\nAnna Sokolova",
    } },
  { from: "vasiliev",
    subject: { ru: "Счёт {n}: расхождение по сумме", en: "Invoice {n}: amount mismatch" },
    alt: [{ ru: "Вопрос по счёту {n}", en: "Question about invoice {n}" }, { ru: "Исправьте, пожалуйста, счёт {n}", en: "Please correct invoice {n}" }],
    body: {
      ru: "Добрый день.\n\nВ счёте {n} сумма на 12 400 ₽ больше, чем в коммерческом предложении. Похоже, посчитали погрузку дважды. Можете проверить и прислать исправленный счёт?\n\nИгорь Васильев\n«СтройМаркет»",
      en: "Hello,\n\nInvoice {n} is £120 higher than the quote. It looks like loading was charged twice. Could you check and send a corrected invoice?\n\nMichael Reed\nBuildMart",
    },
    reply: {
      ru: "Игорь, добрый день!\n\nВы правы, погрузка учтена дважды. Исправленный счёт во вложении, старый аннулирован.\n\nАнна Соколова",
      en: "Hi Michael,\n\nYou're right, loading was counted twice. The corrected invoice is attached and the old one has been cancelled.\n\nAnna Sokolova",
    } },
  { from: "lebedev",
    subject: { ru: "Запрос ставки: Москва — Новосибирск, 20 т", en: "Rate request: London — Glasgow, 20 t" },
    alt: [{ ru: "Ставка на декабрь: регулярные рейсы", en: "December rate: regular runs" }, { ru: "Сколько будет стоить доп. рейс {n}?", en: "Cost of an extra trip {n}?" }],
    body: {
      ru: "Анна, привет!\n\nНужна ставка на регулярную перевозку Москва — Новосибирск, 20 т, 2 рейса в неделю с декабря. Груз — бытовая техника на паллетах.\n\nПришлёшь до пятницы?\n\nПавел",
      en: "Hi Anna,\n\nWe need a rate for a regular London — Glasgow run, 20 t, two trips a week from December. Cargo: household appliances on pallets.\n\nCould you send it by Friday?\n\nPeter",
    },
    reply: {
      ru: "Павел, привет!\n\nСтавку и график рейсов прислала во вложении. Если подтвердите до 25-го, закрепим за вами две машины.\n\nАнна",
      en: "Hi Peter,\n\nThe rate and trip schedule are attached. Confirm by the 25th and we'll reserve two trucks for you.\n\nAnna",
    } },
  { from: "novikov",
    subject: { ru: "Клиент жалуется на сроки ответа", en: "Client unhappy with our response times" },
    alt: [{ ru: "Нужны цифры по скорости ответов", en: "Need numbers on response speed" }, { ru: "Отчёт по SLA для клиента {n}", en: "SLA report for client {n}" }],
    body: {
      ru: "Аня, привет.\n\n«Вектор Ритейл» на встрече сказал, что мы отвечаем на письма по полдня. Можешь посмотреть по отчёту, как у нас со скоростью ответа за месяц?\n\nСергей",
      en: "Hi Anna,\n\nVector Retail told us in the meeting that we take half a day to reply to emails. Can you check the report for our response times this month?\n\nRyan",
    },
    reply: {
      ru: "Сергей, привет!\n\nПо отчёту за 30 дней: медиана первого ответа — 14 рабочих минут, в норматив 30 минут укладываемся в 86% случаев. Задержки были в основном вечером пятницы — поставила дежурного.\n\nАня",
      en: "Hi Ryan,\n\nThe 30-day report shows a median first response of 14 working minutes, and we meet the 30-minute target 86% of the time. Delays were mostly on Friday evenings, so I've put someone on call.\n\nAnna",
    } },
  { from: "morozova",
    subject: { ru: "Закрывающие документы за октябрь", en: "October closing documents" },
    alt: [{ ru: "Акт сверки {n}", en: "Reconciliation statement {n}" }, { ru: "Не хватает подписи на акте {n}", en: "Missing signature on statement {n}" }],
    body: {
      ru: "Анна, добрый день!\n\nНапоминаю: до 5-го числа нужны подписанные акты по клиентам поддержки за октябрь. Не хватает актов «СтройМаркета» и «ТрансКарго».\n\nЕлена",
      en: "Hi Anna,\n\nA reminder that I need the signed October statements for support clients by the 5th. BuildMart and TransCargo are still missing.\n\nLaura",
    },
    reply: {
      ru: "Елена, добрый день!\n\nАкт «СтройМаркета» во вложении, «ТрансКарго» подпишут сегодня — перешлю сразу.\n\nАнна",
      en: "Hi Laura,\n\nBuildMart's statement is attached. TransCargo will sign today and I'll forward it right away.\n\nAnna",
    } },
  { from: "smirnov",
    subject: { ru: "Плановые работы на почтовом сервере в субботу", en: "Planned mail server maintenance on Saturday" },
    alt: [{ ru: "Доступ к общему ящику поддержки", en: "Access to the shared support mailbox" }, { ru: "Новый ноутбук для сотрудника {n}", en: "New laptop for employee {n}" }],
    body: {
      ru: "Коллеги, привет!\n\nВ субботу с 10:00 до 12:00 обновляем почтовый сервер. Почта может быть недоступна до 15 минут. Jackdaw Mail сохранит неотправленные письма и отправит их после обновления.\n\nАлексей, ИТ",
      en: "Hi all,\n\nWe're updating the mail server on Saturday from 10:00 to 12:00. Mail may be unavailable for up to 15 minutes. Jackdaw Mail will keep unsent messages and send them afterwards.\n\nAlex, IT",
    },
    reply: {
      ru: "Алексей, спасибо! Предупрежу дежурных поддержки.\n\nАнна",
      en: "Thanks, Alex! I'll let the on-call support team know.\n\nAnna",
    } },
  { from: "kuznetsova",
    subject: { ru: "Собеседование на позицию специалиста поддержки", en: "Interview for the support specialist role" },
    alt: [{ ru: "Отпуск дежурного в ноябре", en: "On-call holiday in November" }, { ru: "Онбординг нового сотрудника {n}", en: "Onboarding new hire {n}" }],
    body: {
      ru: "Анна, добрый день!\n\nНашли двух кандидатов на позицию специалиста поддержки. Удобно провести собеседования в четверг в 15:00 и 16:00? Резюме во вложении.\n\nМария",
      en: "Hi Anna,\n\nWe've found two candidates for the support specialist role. Would Thursday at 3 pm and 4 pm work for interviews? CVs attached.\n\nSophie",
    },
    reply: {
      ru: "Мария, да, четверг подходит. Отправь, пожалуйста, приглашения в календарь.\n\nАнна",
      en: "Sophie, Thursday works. Please send the calendar invites.\n\nAnna",
    } },
  { from: "belova",
    subject: { ru: "Договор с «Альфа-Фарм»: правки к пункту 4.2", en: "AlphaPharm contract: changes to clause 4.2" },
    alt: [{ ru: "Претензия {n}: позиция юристов", en: "Claim {n}: legal position" }, { ru: "NDA с новым клиентом {n}", en: "NDA with new client {n}" }],
    body: {
      ru: "Анна, добрый день!\n\n«Альфа-Фарм» просит изменить пункт 4.2 — срок реакции на претензию с 24 до 8 рабочих часов. Сможем ли мы выдержать такой срок? Если да, согласую формулировку.\n\nНаталья",
      en: "Hi Anna,\n\nAlphaPharm wants clause 4.2 changed: claim response time from 24 to 8 business hours. Can we commit to that? If so, I'll approve the wording.\n\nNatalie",
    },
    reply: {
      ru: "Наталья, сможем: по претензиям у нас сейчас в среднем 3 рабочих часа. Согласовывай.\n\nАнна",
      en: "Natalie, yes: we currently average 3 business hours on claims. Please go ahead.\n\nAnna",
    } },
  { from: "fedorova",
    subject: { ru: "Кейс для сайта: как мы сократили время ответа", en: "Website case study: how we cut response time" },
    alt: [{ ru: "Отзыв клиента для рассылки", en: "Client quote for the newsletter" }, { ru: "Цифры поддержки для презентации {n}", en: "Support numbers for deck {n}" }],
    body: {
      ru: "Аня, привет!\n\nХотим сделать кейс для сайта про то, как поддержка стала отвечать быстрее. Сможешь дать пару цифр «до/после» и короткую цитату?\n\nИра",
      en: "Hi Anna,\n\nWe'd like a case study for the website about how support got faster. Could you share a couple of before/after numbers and a short quote?\n\nGrace",
    },
    reply: {
      ru: "Ира, привет! Было 2 часа 40 минут до первого ответа, стало 14 минут. Цитату пришлю после обеда.\n\nАня",
      en: "Hi Grace! First response went from 2 h 40 min to 14 minutes. I'll send a quote after lunch.\n\nAnna",
    } },
];

/** Неотвеченные сегодня: попадают в живой контроль SLA. Минут назад и ветка. */
const kPending: { minutesAgo: number, thread: number, n: string }[] = [
  { minutesAgo: 6, thread: 0, n: "№ 48213" },
  { minutesAgo: 19, thread: 1, n: "П-7731" },
  { minutesAgo: 37, thread: 3, n: "" },
  { minutesAgo: 52, thread: 2, n: "№ 2026-1187" },
  { minutesAgo: 95, thread: 8, n: "" },
  { minutesAgo: 140, thread: 5, n: "" },
];

const kChats: { with: string, lines: { me: boolean, text: L }[] }[] = [
  { with: "novikov", lines: [
    { me: false, text: { ru: "Аня, «Вектор» подписал продление на год 🎉", en: "Anna, Vector just renewed for another year 🎉" } },
    { me: true, text: { ru: "Отлично! Они как раз хвалили скорость ответов", en: "Great! They were just praising our response times" } },
    { me: false, text: { ru: "Да, Дмитрий сказал, что отчёт по SLA их убедил", en: "Yes, Daniel said the SLA report convinced them" } },
    { me: true, text: { ru: "Пришлю ему HTML-отчёт за квартал", en: "I'll send him the quarterly HTML report" } },
  ] },
  { with: "smirnov", lines: [
    { me: true, text: { ru: "Лёша, у новенького не подключается общий ящик поддержки", en: "Alex, the new hire can't open the shared support mailbox" } },
    { me: false, text: { ru: "Выдал права, перезапусти Jackdaw", en: "Permissions granted, restart Jackdaw" } },
    { me: true, text: { ru: "Заработало, спасибо!", en: "Works now, thanks!" } },
  ] },
  { with: "kuznetsova", lines: [
    { me: false, text: { ru: "Приглашения на четверг отправила", en: "Thursday invites are sent" } },
    { me: true, text: { ru: "Вижу в календаре, спасибо", en: "I see them in my calendar, thanks" } },
  ] },
  { with: "morozova", lines: [
    { me: false, text: { ru: "Акт «ТрансКарго» пришёл?", en: "Has the TransCargo statement arrived?" } },
    { me: true, text: { ru: "Да, переслала тебе на почту", en: "Yes, I forwarded it to you" } },
  ] },
  { with: "fedorova", lines: [
    { me: false, text: { ru: "Кейс почти готов, глянешь черновик?", en: "The case study is almost done, can you review the draft?" } },
    { me: true, text: { ru: "Да, после планёрки", en: "Sure, after stand-up" } },
  ] },
];

const kShortChat: L[] = [
  { ru: "Ок, принято", en: "OK, got it" },
  { ru: "Созвонимся в 15:00?", en: "Call at 3 pm?" },
  { ru: "Готово, посмотри", en: "Done, take a look" },
  { ru: "Спасибо!", en: "Thanks!" },
  { ru: "Перенесли на завтра", en: "Moved to tomorrow" },
  { ru: "Отправила клиенту", en: "Sent to the client" },
];

type EventSpec = { day: number, start: string, minutes: number, title: L, with: string[], location?: L, online?: boolean, free?: boolean };

/** День 0 — понедельник текущей недели */
const kWeekEvents: EventSpec[] = [
  { day: 0, start: "09:30", minutes: 30, title: { ru: "Планы на неделю: поддержка", en: "Support weekly planning" }, with: ["smirnov", "kuznetsova"], location: { ru: "Переговорная «Байкал»", en: "Room \"Thames\"" } },
  { day: 0, start: "14:00", minutes: 60, title: { ru: "Созвон с «Вектор Ритейл»", en: "Call with Vector Retail" }, with: ["orlov", "novikov"], online: true },
  { day: 1, start: "11:00", minutes: 45, title: { ru: "Разбор SLA за прошлую неделю", en: "Last week's SLA review" }, with: ["novikov", "fedorova"], location: { ru: "Переговорная «Байкал»", en: "Room \"Thames\"" } },
  { day: 1, start: "16:00", minutes: 30, title: { ru: "1:1 с Сергеем", en: "1:1 with Ryan" }, with: ["novikov"] },
  { day: 2, start: "10:00", minutes: 60, title: { ru: "Демо для «Альфа-Фарм»", en: "Demo for AlphaPharm" }, with: ["pavlova", "belova"], online: true },
  { day: 2, start: "13:00", minutes: 60, title: { ru: "Обед с командой", en: "Team lunch" }, with: [], location: { ru: "Кафе на первом этаже", en: "Ground floor café" }, free: true },
  { day: 3, start: "10:30", minutes: 30, title: { ru: "Согласование договора «Альфа-Фарм»", en: "AlphaPharm contract sign-off" }, with: ["belova"] },
  { day: 3, start: "15:00", minutes: 60, title: { ru: "Собеседование: специалист поддержки", en: "Interview: support specialist" }, with: ["kuznetsova"], location: { ru: "Переговорная «Ладога»", en: "Room \"Severn\"" } },
  { day: 3, start: "16:00", minutes: 60, title: { ru: "Собеседование: специалист поддержки", en: "Interview: support specialist" }, with: ["kuznetsova"], location: { ru: "Переговорная «Ладога»", en: "Room \"Severn\"" } },
  { day: 4, start: "11:00", minutes: 60, title: { ru: "Тариф «ТрансКарго» на 2027", en: "TransCargo 2027 rates" }, with: ["lebedev", "novikov"], online: true },
  { day: 4, start: "17:00", minutes: 30, title: { ru: "Итоги недели", en: "Week wrap-up" }, with: ["smirnov", "kuznetsova", "fedorova"] },
];

const kFiles: { dir: L, files: L[] }[] = [
  { dir: { ru: "Договоры", en: "Contracts" }, files: [
    { ru: "Договор Альфа-Фарм 2027.pdf", en: "AlphaPharm contract 2027.pdf" },
    { ru: "Доп. соглашение Вектор Ритейл.docx", en: "Vector Retail addendum.docx" },
    { ru: "Тарифы ТрансКарго.xlsx", en: "TransCargo rates.xlsx" },
  ] },
  { dir: { ru: "Отчёты", en: "Reports" }, files: [
    { ru: "SLA поддержки — октябрь.html", en: "Support SLA — October.html" },
    { ru: "Скорость ответов Q3.xlsx", en: "Response times Q3.xlsx" },
  ] },
  { dir: { ru: "Презентации", en: "Presentations" }, files: [
    { ru: "Демо для Альфа-Фарм.pptx", en: "AlphaPharm demo.pptx" },
    { ru: "Итоги квартала.pptx", en: "Quarter review.pptx" },
  ] },
];

class ShowcasePerson extends Person {
  constructor(spec: PersonSpec, lang: Lang) {
    super();
    this.id = "showcase-" + spec.key;
    this.firstName = spec.first[lang];
    this.lastName = spec.last[lang];
    this.name = this.firstName + " " + this.lastName;
    this.emailAddresses.add(new ContactEntry(spec.email, "work"));
    this.phoneNumbers.add(new ContactEntry(spec.phone, "work"));
    let address = new StreetAddress();
    address.city = spec.city[lang];
    this.streetAddresses.add(new ContactEntry(address.toString(), "work"));
    this.company = spec.company[lang];
    this.department = spec.department[lang];
    this.position = spec.position[lang];
    this.picture = avatar(spec.male);
  }
}

function fill(text: L, lang: Lang, n: string): string {
  return text[lang].replace(/\{n\}/g, n).replace(/\s+$/, "").replace(/ +\n/g, "\n");
}

function workTime(day: Date, hhmm: string): Date {
  let [h, m] = hhmm.split(":").map(Number);
  let date = new Date(day);
  date.setHours(h, m, 0, 0);
  return date;
}

function isWeekend(date: Date): boolean {
  return date.getDay() == 0 || date.getDay() == 6;
}

export async function showcaseDataOn(): Promise<void> {
  let lang: Lang = getUILocale().toLowerCase().startsWith("ru") ? "ru" : "en";
  let random = makeRandom(20261106);
  await readAvatarList();

  appGlobal.addressbooks.clear();
  appGlobal.emailAccounts.clear();
  appGlobal.chatAccounts.clear();
  appGlobal.calendars.clear();
  appGlobal.meetAccounts.clear();
  appGlobal.fileSharingAccounts.clear();

  let me = new ShowcasePerson(kMe, lang);
  appGlobal.me = me;
  let addressbook = new FakeAddressbook();
  addressbook.name = lang == "ru" ? "Контакты компании" : "Company contacts";
  let persons = new ArrayColl<Person>(kPeople.map(spec => new ShowcasePerson(spec, lang)));
  for (let person of persons) {
    person.addressbook = addressbook;
  }
  addressbook.persons.addAll(persons);
  appGlobal.addressbooks.replaceAll([addressbook]);
  let byKey = new Map<string, Person>(kPeople.map((spec, i) => [spec.key, persons.getIndex(i)]));

  let mailAccount = new ShowcaseMailAccount(persons, me, lang, byKey, random);
  appGlobal.emailAccounts.replaceAll([mailAccount]);
  let chatAccount = new ShowcaseChatAccount(persons, me);
  chatAccount.name = "Jackdaw Chat";
  appGlobal.chatAccounts.replaceAll([chatAccount]);
  let calendar = new ShowcaseCalendar(persons, 0);
  calendar.name = lang == "ru" ? "Рабочий календарь" : "Work calendar";
  fillCalendar(calendar, lang, me, byKey);
  appGlobal.calendars.replaceAll([calendar]);
  appGlobal.meetAccounts.replaceAll([new FakeMeetAccount()]);
  appGlobal.fileSharingAccounts.replaceAll([makeFiles(lang)]);

  await useShowcaseMailDatabase();
  await mailAccount.login();
  await saveMailToDatabase(mailAccount);

  await chatAccount.login(false);
  fillChats(chatAccount, lang, byKey, random);
  await saveChatToDatabase(chatAccount);
}

class ShowcaseMailAccount extends FakeMailAccount {
  constructor(persons: Collection<Person>, me: Person, readonly lang: Lang, readonly byKey: Map<string, Person>, readonly random: () => number) {
    super(persons, me, 0);
    this.name = lang == "ru" ? "Рабочая почта" : "Work mail";
    this.hostname = "mail." + kDomain;
  }

  async listFolders(): Promise<void> {
    if (this.rootFolders.hasItems) {
      return;
    }
    let names = this.lang == "ru"
      ? ["Входящие", "Отправленные", "Черновики", "Корзина", "Спам"]
      : ["Inbox", "Sent", "Drafts", "Trash", "Spam"];
    let kinds = [SpecialFolder.Inbox, SpecialFolder.Sent, SpecialFolder.Drafts, SpecialFolder.Trash, SpecialFolder.Spam];
    for (let [i, name] of names.entries()) {
      let folder = this.newFolder();
      folder.name = name;
      folder.id = kinds[i];
      folder.specialFolder = kinds[i];
      this.rootFolders.push(folder);
    }
    this.fillMessages();
  }

  fillMessages() {
    let inbox = this.rootFolders.getIndex(0) as FakeFolder;
    let sent = this.rootFolders.getIndex(1) as FakeFolder;
    let meUID = new PersonUID(this.emailAddress, this.realname);
    let now = new Date();
    let incoming: EMail[] = [];
    let outgoing: EMail[] = [];
    let counter = 0;
    let addThread = (thread: ThreadSpec, received: Date, replyAfterMinutes: number | null, n: string, subject = thread.subject) => {
      counter++;
      let person = this.byKey.get(thread.from);
      let pUID = PersonUID.fromPerson(person);
      let mail = inbox.newEMail();
      mail.id = `<req-${counter}.showcase@${kDomain}>`;
      mail.threadID = mail.id;
      mail.subject = fill(subject, this.lang, n);
      mail.text = fill(thread.body, this.lang, n);
      mail.from = pUID;
      mail.contact = pUID;
      mail.to.add(meUID);
      mail.sent = new Date(received.getTime() - 20 * 1000);
      mail.received = received;
      mail.size = mail.text.length + 900;
      mail.outgoing = false;
      mail.loadedBody = true;
      incoming.push(mail);
      if (replyAfterMinutes == null) {
        mail.isRead = now.getTime() - received.getTime() > 30 * kMinute;
        return;
      }
      mail.isRead = true;
      mail.isReplied = true;
      let reply = sent.newEMail();
      reply.id = `<rep-${counter}.showcase@${kDomain}>`;
      reply.inReplyTo = mail.id;
      reply.threadID = mail.id;
      reply.subject = "Re: " + mail.subject;
      reply.text = fill(thread.reply, this.lang, n);
      reply.from = meUID;
      reply.contact = pUID;
      reply.to.add(pUID);
      reply.sent = new Date(received.getTime() + replyAfterMinutes * kMinute);
      reply.received = new Date(reply.sent.getTime() + 500);
      reply.size = reply.text.length + 700;
      reply.outgoing = true;
      reply.isRead = true;
      reply.loadedBody = true;
      outgoing.push(reply);
    };

    // История за 30 дней: 2–4 запроса в рабочий день, ответ в основном за 30 минут
    let hours = ["09:12", "09:47", "10:25", "11:08", "11:52", "12:40", "14:05", "14:48", "15:31", "16:14", "17:02", "17:46"];
    for (let daysAgo = 30; daysAgo >= 1; daysAgo--) {
      let day = new Date(now);
      day.setDate(day.getDate() - daysAgo);
      if (isWeekend(day)) {
        continue;
      }
      let count = 2 + Math.floor(this.random() * 3);
      let slots = hours.filter(() => this.random() < count / hours.length).slice(0, count);
      for (let slot of slots) {
        let thread = kThreads[Math.floor(this.random() * kThreads.length)];
        let r = this.random();
        let replyAfter = r < 0.55 ? 3 + Math.floor(this.random() * 15)
          : r < 0.86 ? 15 + Math.floor(this.random() * 15)
          : 35 + Math.floor(this.random() * 100);
        let n = (this.lang == "ru" ? "№ " : "#") + (46000 + Math.floor(this.random() * 2000));
        let variants = [thread.subject, ...thread.alt];
        addThread(thread, workTime(day, slot), replyAfter, n, variants[Math.floor(this.random() * variants.length)]);
      }
    }
    // Сегодня: уже отвеченные утром и ждущие ответа
    for (let pending of kPending) {
      let received = new Date(now.getTime() - pending.minutesAgo * kMinute);
      let n = (pending.n || "№ 48190").replace("№ ", this.lang == "ru" ? "№ " : "#").replace("П-", this.lang == "ru" ? "П-" : "P-");
      addThread(kThreads[pending.thread], received, null, n);
    }

    inbox.messages.addAll(incoming.sort((a, b) => a.received.getTime() - b.received.getTime()));
    sent.messages.addAll(outgoing.sort((a, b) => a.sent.getTime() - b.sent.getTime()));
    inbox.countTotal = incoming.length;
    sent.countTotal = outgoing.length;
  }
}

async function saveMailToDatabase(account: ShowcaseMailAccount): Promise<void> {
  let db = await getMailDatabase();
  let insert = await db.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${account.id}, ${account.protocol || "showcase"})`);
  account.dbID = insert.lastInsertRowid as number;
  for (let folder of account.rootFolders) {
    await SQLFolder.save(folder);
  }
  for (let folder of account.rootFolders) {
    if (folder.messages.hasItems) {
      await SQLEMail.saveAll(folder.messages.contents);
    }
  }
}

function fillCalendar(calendar: FakeCalendar, lang: Lang, me: Person, byKey: Map<string, Person>) {
  let monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  let meEmail = me.emailAddresses.first.value;
  let add = (spec: EventSpec, weekOffset: number) => {
    let day = new Date(monday);
    day.setDate(day.getDate() + spec.day + weekOffset * 7);
    let event = calendar.newEvent();
    event.title = spec.title[lang];
    event.descriptionText = "";
    event.location = spec.location?.[lang] ?? "";
    event.isOnline = !!spec.online;
    event.onlineMeetingURL = spec.online ? "https://meet." + kDomain + "/" + Math.abs(hash(spec.title.en)) : "";
    event.startTime = workTime(day, spec.start);
    event.endTime = new Date(event.startTime.getTime() + spec.minutes * kMinute);
    event.freeBusyStatus = spec.free ? "Free" : "Busy";
    event.participants.clear();
    if (spec.with.length) {
      event.participants.add(new Participant(meEmail, me.name, InvitationResponse.Organizer));
      for (let key of spec.with) {
        let person = byKey.get(key);
        event.participants.add(new Participant(person.emailAddresses.first.value, person.name, InvitationResponse.Accept));
      }
    }
    calendar.events.add(event);
  };
  // Текущая неделя и три прошлые — для отчёта о загрузке календаря
  for (let week = -3; week <= 1; week++) {
    for (let spec of kWeekEvents) {
      if (week != 0 && spec.title.en.startsWith("Interview")) {
        continue;
      }
      add(spec, week);
    }
  }
}

class ShowcaseChatAccount extends FakeChatAccount {
  newRoom(): FakeChat {
    return new ShowcaseChat(this);
  }
}

/** Новое сообщение (черновик в поле ввода) — пустое, без случайного текста faker */
class ShowcaseChat extends FakeChat {
  newMessage() {
    let msg = super.newMessage();
    msg.text = "";
    msg.html = "";
    msg.outgoing = true;
    return msg;
  }
}

/** Занятость коллег для планировщика встреч: их встречи из витринного календаря */
class ShowcaseCalendar extends FakeCalendar {
  /** Новое событие из интерфейса — пустое, без случайных данных faker */
  newEvent(parentEvent?: any): any {
    let event = super.newEvent(parentEvent);
    event.title = "";
    event.descriptionText = "";
    event.location = "";
    event.participants.clear();
    return event;
  }

  async arePersonsFree(participants: Participant[], from: Date, to: Date): Promise<{ participant: Participant, availability?: { from: Date, to: Date, free: boolean }[] }[]> {
    return participants.map(participant => {
      let address = participant.emailAddress?.toLowerCase();
      let busy = this.events.contents
        .filter(event => event.startTime < to && from < event.endTime && event.freeBusyStatus != "Free" &&
          event.participants.some(p => p.emailAddress?.toLowerCase() == address))
        .map(event => ({ from: event.startTime, to: event.endTime, free: false }));
      // Внешние адреса витрина не знает — как настоящий сервер без доступа к ним
      return { participant, availability: address?.endsWith("@" + kDomain) ? busy : undefined };
    });
  }
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return h;
}

function fillChats(account: FakeChatAccount, lang: Lang, byKey: Map<string, Person>, random: () => number) {
  let now = Date.now();
  for (let [contact, room] of account.rooms.contents.map(room => [room.contact, room] as const)) {
    let chat = room as FakeChat;
    let person = (contact as any).person as Person;
    let script = kChats.find(c => byKey.get(c.with) == person);
    let messages: ChatMessage[] = [];
    // Короткие сообщения за месяц — для отчёта по чатам
    for (let daysAgo = 28; daysAgo >= 2; daysAgo -= 2 + Math.floor(random() * 4)) {
      let msg = chat.newMessage();
      msg.outgoing = random() < 0.5;
      msg.text = msg.html = kShortChat[Math.floor(random() * kShortChat.length)][lang];
      msg.sent = new Date(now - daysAgo * 24 * 60 * kMinute + Math.floor(random() * 8) * 60 * kMinute);
      messages.push(msg);
    }
    let lines = script?.lines ?? [];
    for (let [i, line] of lines.entries()) {
      let msg = chat.newMessage();
      msg.outgoing = line.me;
      msg.text = msg.html = line.text[lang];
      msg.sent = new Date(now - (lines.length - i) * 7 * kMinute - (script ? kChats.indexOf(script) * 50 * kMinute : 0));
      messages.push(msg);
    }
    for (let msg of messages) {
      msg.received = new Date(msg.sent.getTime() + 500);
      msg.deliveryStatus = msg.outgoing ? DeliveryStatus.Seen : DeliveryStatus.Server;
    }
    chat.messages.replaceAll(messages);
    chat.lastMessage = messages[messages.length - 1];
  }
}

async function saveChatToDatabase(account: FakeChatAccount): Promise<void> {
  let db = await useShowcaseChatDatabase();
  let insert = await db.run(sql`
    INSERT INTO chatAccount (idStr, protocol) VALUES (${account.id}, ${account.protocol || "showcase"})`);
  account.dbID = insert.lastInsertRowid as number;
  for (let room of account.rooms.contents) {
    await SQLChatRoom.save(room);
    for (let msg of room.messages.contents) {
      await SQLChatMessage.save(msg);
    }
  }
}

function makeFiles(lang: Lang): FakeFileSharingAccount {
  let account = new FakeFileSharingAccount();
  account.name = lang == "ru" ? "Общий диск" : "Shared drive";
  account.rootDirs.clear();
  let now = Date.now();
  let dirs: Directory[] = [];
  for (let [i, spec] of kFiles.entries()) {
    let dir = account.newDirectory(spec.dir[lang]);
    dir.lastMod = new Date(now - (i + 1) * 26 * 60 * kMinute);
    for (let [j, name] of spec.files.entries()) {
      let file = dir.newFile(name[lang]);
      let parts = file.name.split(".");
      file.ext = parts.pop();
      file.nameWithoutExt = parts.join(".");
      file.size = 180000 + (i * 7 + j * 13) * 91000;
      file.lastMod = new Date(now - (i * 3 + j + 1) * 20 * 60 * kMinute);
      dir.files.add(file);
    }
    dirs.push(dir);
  }
  account.rootDirs.addAll(dirs);
  return account;
}
