<!-- Чат Jackdaw ↔ Jackdaw: показывает приложение «Чат», уведомляет о новых сообщениях и о смене ключей собеседников,
  отмечает прочитанным открытый чат, пока окно в фокусе. -->
<svelte:window on:focus={onFocusChange} on:blur={onFocusChange} />
<svelte:document on:visibilitychange={onFocusChange} />

<script lang="ts">
  import { appGlobal } from "../../logic/app";
  import { JackdawChatAccount, JACKDAW_CHAT_PROTOCOL } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import { JackdawChatRoom } from "../../logic/Chat/Jackdaw/JackdawChatRoom";
  import type { ChatMessage } from "../../logic/Chat/ChatMessage";
  import { apps, bringAppToFront, selectedApp } from "../AppsBar/selectedApp";
  import { selectedRoom } from "./selected";
  import { chatApp } from "./ChatJackdawApp";
  import { mailApp } from "../Mail/MailJackdawApp";
  import { openChatRoomFromOtherApp } from "./open";
  import { NotificationKinds, SystemNotification } from "../Shared/SystemNotification";
  import { chatNotificationKinds } from "./chatNotificationPrefs";
  import { getNotificationSound, playNotificationSound } from "../Shared/NotificationSound";
  import { getJackdawCallClient } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import { notifications, Notification, NotificationSeverity } from "../MainWindow/Notification";
  import { backgroundError } from "../Util/error";
  import { gt } from "../../l10n/l10n";
  import { onDestroy } from "svelte";

  const chatAccounts = appGlobal.chatAccounts;
  $: account = $chatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined;
  $: account && setUp(account);

  let unsubscribeWarnings: (() => void) | null = null;
  let shownWarnings = new Set<string>();
  let isFocused = hasFocus();

  /** Чат, который пользователь сейчас видит: открыто приложение «Чат» и в нём этот чат */
  $: openRoom = $selectedApp == chatApp && $selectedRoom instanceof JackdawChatRoom ? $selectedRoom : null;
  $: openRoom && isFocused && markRead(openRoom);

  function hasFocus(): boolean {
    return document.hasFocus() && document.visibilityState != "hidden";
  }

  function onFocusChange() {
    isFocused = hasFocus();
  }

  function isSeenNow(room: JackdawChatRoom): boolean {
    return room == openRoom && hasFocus();
  }

  function markRead(room: JackdawChatRoom) {
    room.markAllRead().catch(backgroundError);
  }

  function setUp(chat: JackdawChatAccount) {
    showChatApp();
    chat.incomingMessageCallback = notifyIncoming;
    unsubscribeWarnings?.();
    unsubscribeWarnings = chat.subscribe(() => showKeyWarnings(chat.keyWarnings));
  }

  /** Приложение «Чат» скрыто из панели, пока нет чата Jackdaw: другие чаты в этой сборке не предлагаются. */
  function showChatApp() {
    if (apps.includes(chatApp)) {
      return;
    }
    let mailPos = apps.indexOf(mailApp);
    apps.splice(mailPos >= 0 ? mailPos + 1 : apps.length, 0, chatApp);
  }

  function notifyIncoming(room: JackdawChatRoom, message: ChatMessage) {
    let kinds = chatNotificationKinds(room.id, getJackdawCallClient().myStatus);
    if (isSeenNow(room)) {
      markRead(room); // пользователь видит это сообщение — оно прочитано, собеседник получит отметку
      if (kinds.includes("sound") && getNotificationSound("chat") != "none") {
        // Чат открыт: без всплывающего окна, но с тихим щелчком — новое сообщение не пройдёт незамеченным
        playNotificationSound("chat", { sound: "pop" }).catch(backgroundError);
      }
      return;
    }
    if (!kinds.length) {
      return;
    }
    // Заголовок — откуда уведомление: имя собеседника одно не говорит, что это чат Jackdaw Mail
    let notification = new SystemNotification(
      new NotificationKinds(kinds),
      gt`Jackdaw Mail chat`,
      message.text || (message.attachments.length ? gt`File` : ""),
      `chat-${room.id}`,
      "chat",
    );
    notification.subtitle = room.name;
    notification.updatesTaskbarBadge = false;
    notification.onClick = () => {
      openChatRoomFromOtherApp(room);
      bringAppToFront();
    };
    notification.show().catch(backgroundError);
  }

  function showKeyWarnings(warnings: string[]) {
    for (let warning of warnings) {
      if (shownWarnings.has(warning)) continue;
      shownWarnings.add(warning);
      notifications.add(new Notification(warning, NotificationSeverity.Warning));
    }
  }

  onDestroy(() => unsubscribeWarnings?.());
</script>
