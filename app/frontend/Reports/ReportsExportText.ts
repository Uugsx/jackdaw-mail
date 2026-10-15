/**
 * Тексты HTML-отчёта. Русский текст остаётся исходным: он же служит ключом,
 * поэтому русский отчёт не меняется. Для английского языка ниже лежит перевод,
 * а метки вида `{name}` подставляются из параметров.
 */
export type ExportLanguage = "ru" | "en";

export const DEFAULT_EXPORT_LANGUAGE: ExportLanguage = "ru";

const EN: Record<string, string> = {
  "Отчёт об активности Jackdaw Mail": "Jackdaw Mail activity report",
  "{answered} ответов · {rate} вне графика":
    "{answered} replies · {rate} outside hours",
  "Нет ответов категорий вне рабочего времени.":
    "No category replies outside working hours.",
  "Сотрудник": "Employee",
  "Выберите сотрудника": "Select an employee",
  "Ритм: {name}": "Rhythm: {name}",
  "Нет данных по ритму категорий.": "No category rhythm data.",
  "Наблюдаемая активность": "Observed activity",
  "Сообщения почты": "Mail messages",
  "Запросы с подтверждённым ответом": "Requests with a confirmed reply",
  "Норматив первого ответа": "First-reply target",
  "{n} рабочих мин": "{n} working min",
  "Среднее время ответа": "Average reply time",
  "Ответов в срок": "Replies on time",
  "Просроченных ответов": "Overdue replies",
  "Ответы вне рабочего времени без категории":
    "Replies outside working hours, no category",
  "Ответы вне рабочего времени": "Replies outside working hours",
  "Ответы вне рабочего времени с категорией сотрудника":
    "Replies outside working hours, with an employee category",
  "Ответы вне рабочего времени без оценки SLA":
    "Replies outside working hours, SLA not evaluated",
  "SLA ответов вне рабочего времени": "SLA of replies outside working hours",
  "{within} в срок · {over} просрочек": "{within} on time · {over} overdue",
  "Сообщения чатов": "Chat messages",
  "Часы в календаре": "Calendar hours",
  "Изменено файлов": "Files changed",
  "{n} с ответом · {share}": "{n} answered · {share}",
  "Нет данных по отвечающим за этот период.":
    "No responder data for this period.",
  "{n} с ответом · {over} просрочек": "{n} answered · {over} overdue",
  "Нет категорий за этот период.": "No categories for this period.",
  "Нет подтверждённых ответов по дням.": "No confirmed replies by day.",
  "ОТЧЁТЫ ОБ АКТИВНОСТИ": "ACTIVITY REPORTS",
  "почтовый аккаунт: {name}": "mail account: {name}",
  "все почтовые аккаунты": "all mail accounts",
  "папка: {name}": "folder: {name}",
  "все папки": "all folders",
  "фильтр категорий: {label}": "category filter: {label}",
  "сформирован {date}": "generated {date}",
  "ДИНАМИКА": "TREND",
  "Активность во времени": "Activity over time",
  "Почта, чаты, календарь и файлы по {unit}.":
    "Mail, chats, calendar and files by {unit}.",
  "Входящие письма": "Incoming mail",
  "Исходящие письма": "Outgoing mail",
  "Чаты": "Chats",
  "Календарь": "Calendar",
  "Файлы": "Files",
  "РИТМ РАБОТЫ": "WORK RHYTHM",
  "Когда происходит активность": "When activity happens",
  "Исходящие сообщения, встречи и изменения файлов по дням недели и часам.":
    "Outgoing messages, meetings and file changes by weekday and hour.",
  "ВРЕМЯ ОТВЕТА": "REPLY TIME",
  "Скорость первого ответа": "First-reply speed",
  "От получения запроса до первого подтверждённого ответа. Норматив: {target}":
    "From receiving a request to the first confirmed reply. Target: {target}",
  "{n} рабочих мин.": "{n} working min.",
  "Рабочий календарь: {schedule}. Ответы считаются по рабочим минутам, если запрос или ответ пришёл в рабочем графике. Если оба момента вне графика, ответ засчитывается сотруднику, но SLA не оценивается; показанное время является справочным.":
    "Working calendar: {schedule}. Replies are counted in working minutes when the request or the reply arrived within the schedule. If both fall outside it, the reply is credited to the employee but the SLA is not evaluated; the time shown is for reference only.",
  "Минимальное время ответа": "Minimum reply time",
  "Максимальное время ответа": "Maximum reply time",
  "В срок": "On time",
  "Просрочки": "Overdue",
  "SLA не оценивается: {n}": "SLA not evaluated: {n}",
  "Ответы по дням и SLA": "Replies by day and SLA",
  "ДНИ С ПРОСРОЧКАМИ": "OVERDUE DAYS",
  "Когда были задержки": "When replies were late",
  "Дни отсортированы по количеству ответов позже норматива.":
    "Days are sorted by the number of replies later than the target.",
  "День": "Day",
  "Ответов": "Replies",
  "Среднее время": "Average time",
  "Минимум": "Minimum",
  "Максимум": "Maximum",
  "ПОДРОБНОСТИ": "DETAILS",
  "Самые долгие ответы": "Slowest replies",
  "Полный список ответов за выбранный период.":
    "The full list of replies for the selected period.",
  "Поступило": "Received",
  "Ответ": "Reply",
  "Время ответа": "Reply time",
  "Профиль": "Profile",
  "Тема": "Subject",
  "Статус SLA": "SLA status",
  "ВНЕ РАБОЧЕГО ВРЕМЕНИ": "OUTSIDE WORKING HOURS",
  "Кто отвечал вне графика": "Who replied outside the schedule",
  "Первые подтверждённые ответы, отправленные вне выбранного графика. При наличии категории показывается сотрудник, иначе — почтовый профиль.":
    "First confirmed replies sent outside the selected schedule. If there is a category, the employee is shown; otherwise the mail profile.",
  "Сотрудник / профиль": "Employee / profile",
  "ОТВЕТЫ": "REPLIES",
  "Кто отвечает": "Who replies",
  "Сотрудники или почтовые профили с запросами, ответами и самым активным днём/часом.":
    "Employees or mail profiles with their requests, replies and busiest day and hour.",
  "Запросы по сотрудникам": "Requests by employee",
  "Запросы по категориям": "Requests by category",
  "Электронная почта": "Email",
  "Запросы": "Requests",
  "С ответом": "Answered",
  "Доля ответов": "Reply rate",
  "Доля в срок": "On-time rate",
  "Отправлено": "Sent",
  "Пиковый день": "Peak day",
  "Пиковый час": "Peak hour",
  "Последняя активность": "Last activity",
  "РИТМ СОТРУДНИКОВ": "EMPLOYEE RHYTHM",
  "Кто и когда отвечает": "Who replies and when",
  "Рейтинг ответов вне графика и ритм каждой категории по дням недели и часам. Выберите сотрудника, чтобы посмотреть его тепловую карту.":
    "Ranking of replies outside the schedule and the rhythm of each category by weekday and hour. Select an employee to see their heatmap.",
  "Кто отвечает чаще вне графика": "Who replies outside the schedule most",
  "Ответы категорий вне рабочего времени":
    "Category replies outside working hours",
  "Ритм сотрудника": "Employee rhythm",
  "Категория сотрудника": "Employee category",
  "Ответы": "Replies",
  "Вне графика": "Outside schedule",
  "Доля вне графика": "Outside-schedule share",
  "Без подтверждённого ответа": "No confirmed reply",
  "Активные дни": "Active days",
  "Тихие дни": "Quiet days",
  "Тихие рабочие слоты": "Quiet working slots",
  "Пик": "Peak",
  "Тише всего": "Quietest",
  "В селекторе доступны все сотрудники из текущего отчёта. Если одно письмо имеет несколько категорий, оно учитывается в каждой из них. «Без подтверждённого ответа» — входящие запросы категории, для которых не найден первый подтверждённый ответ.":
    "The selector lists every employee in this report. If a message has several categories, it counts in each of them. “No confirmed reply” means incoming requests in the category for which no first confirmed reply was found.",
  "ИСТОЧНИКИ ЗАПРОСОВ": "REQUEST SOURCES",
  "Кто создаёт спрос": "Who creates demand",
  "Отправители с наибольшим количеством входящих запросов.":
    "Senders with the most incoming requests.",
  "Человек": "Person",
  "Доля": "Share",
  "Неизвестный контакт": "Unknown contact",
  "СПРОС": "DEMAND",
  "Частые запросы": "Frequent requests",
  "Повторяющиеся темы входящих писем без префиксов ответа и пересылки.":
    "Recurring subjects of incoming mail, without reply and forward prefixes.",
  "КАТЕГОРИИ": "CATEGORIES",
  "Категории и теги": "Categories and tags",
  "Уникальные письма с каждой меткой; одно письмо может попасть в несколько строк.":
    "Unique messages for each label; one message can appear in several rows.",
  "Категория": "Category",
  "Письма с меткой": "Labelled messages",
  "Входящие запросы": "Incoming requests",
  "Исходящие": "Outgoing",
  "Подтверждённые ответы": "Confirmed replies",
  "ПОЧТОВЫЕ ЯЩИКИ": "MAILBOXES",
  "Почтовые аккаунты": "Mail accounts",
  "Активность по аккаунтам и папкам.": "Activity by account and folder.",
  "Аккаунт": "Account",
  "Сообщения": "Messages",
  "Входящие": "Incoming",
  "Размер, байт": "Size, bytes",
  "ПАПКИ": "FOLDERS",
  "Почтовые папки": "Mail folders",
  "Где хранится почтовая активность.": "Where the mail activity is stored.",
  "Папка": "Folder",
  "Путь": "Path",
  "ВРЕМЯ": "TIME",
  "Загрузка календаря": "Calendar load",
  "Время в событиях и встречах.": "Time spent in events and meetings.",
  "События": "Events",
  "Часы": "Hours",
  "Онлайн-встречи": "Online meetings",
  "Участники": "Participants",
  "УЧАСТНИКИ": "PARTICIPANTS",
  "Участники календаря": "Calendar participants",
  "Люди, участвовавшие во встречах за период.":
    "People who took part in meetings during the period.",
  "ДИАЛОГИ": "CONVERSATIONS",
  "Чаты с наибольшим количеством сообщений.": "Chats with the most messages.",
  "Чат": "Chat",
  "ДОКУМЕНТЫ": "DOCUMENTS",
  "Изменённые файлы": "Changed files",
  "Папки с наибольшим количеством изменённых файлов.":
    "Folders with the most changed files.",
  "Размер": "Size",
  "Важно для интерпретации: активность — это измеряемый ориентир по синхронизированным локальным данным, а не учёт рабочего времени. Ответ считается подтверждённым, если почтовый сервер пометил письмо как отвеченное или найдено отправленное письмо, связанное с запросом по In-Reply-To или с той же цепочкой. SLA считается в рабочих минутах по выбранному графику, если запрос или ответ пришёл в рабочее время. Если и запрос, и ответ вне графика, ответ засчитывается сотруднику, но SLA не оценивается; в строке показывается фактическое время как справочное. Такие ответы выделены отдельно и исключены из SLA-агрегатов. Ответ после конца периода учитывается, если запрос пришёл в выбранный период. Одно письмо может иметь несколько меток, поэтому строки категорий не складываются. Архив почты хранит текущую категорию, но не время её назначения, поэтому отчёт не может восстановить точный момент, когда запрос взяли в работу. Отсутствующая история или несинхронизированный аккаунт делают отчёт неполным.":
    "How to read this report: activity is a measured indicator based on synchronized local data, not a record of working time. A reply counts as confirmed if the mail server marked the message as answered, or a sent message linked to the request by In-Reply-To or by the same thread was found. The SLA is counted in working minutes on the selected schedule when the request or the reply arrived during working hours. If both the request and the reply fall outside the schedule, the reply is credited to the employee but the SLA is not evaluated; the actual time is shown for reference. Such replies are listed separately and excluded from the SLA totals. A reply after the end of the period is counted if the request arrived within the selected period. One message can carry several labels, so category rows do not add up. The mail archive stores the current category but not when it was assigned, so the report cannot reconstruct the exact moment a request was picked up. Missing history or an unsynchronized account makes the report incomplete.",
  "Нет данных за этот период.": "No data for this period.",
  "{day} — выходной": "{day} — day off",
  "Пн": "Mon",
  "Вт": "Tue",
  "Ср": "Wed",
  "Чт": "Thu",
  "Пт": "Fri",
  "Сб": "Sat",
  "Вс": "Sun",
  "д": "d",
  "ч": "h",
  "мин": "min",
  "с": "s",
  "Не оценивается": "Not evaluated",
  "Просрочка": "Overdue",
  "Вне рабочего времени": "Outside working hours",
  "0 Б": "0 B",
  "Б": "B",
  "КБ": "KB",
  "МБ": "MB",
  "ГБ": "GB",
  "ТБ": "TB",
  "дням": "day",
  "неделям": "week",
  "месяцам": "month",
};

/**
 * Возвращает текст отчёта на нужном языке. Для русского это исходная строка,
 * для английского — перевод (при отсутствии перевода остаётся русский текст).
 */
export function exportText(
  ru: string,
  language: ExportLanguage,
  params?: Record<string, string>,
): string {
  const text = language == "en" ? (EN[ru] ?? ru) : ru;
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? params[name]
      : placeholder,
  );
}

/** Ключи английского словаря. Нужны тесту, который сверяет их с кодом отчёта. */
export function exportTextKeys(): string[] {
  return Object.keys(EN);
}
