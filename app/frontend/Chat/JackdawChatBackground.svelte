<!-- Чат Jackdaw ↔ Jackdaw: показывает приложение «Чат», уведомляет о новых сообщениях и о смене ключей собеседников. -->
<script lang="ts">
  import { appGlobal } from "../../logic/app";
  import { JackdawChatAccount, JACKDAW_CHAT_PROTOCOL } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import type { JackdawChatRoom } from "../../logic/Chat/Jackdaw/JackdawChatRoom";
  import type { ChatMessage } from "../../logic/Chat/ChatMessage";
  import { apps, bringAppToFront } from "../AppsBar/selectedApp";
  import { chatApp } from "./ChatJackdawApp";
  import { mailApp } from "../Mail/MailJackdawApp";
  import { openChatRoomFromOtherApp } from "./open";
  import { NotificationKinds, SystemNotification } from "../Shared/SystemNotification";
  import { notifications, Notification, NotificationSeverity } from "../MainWindow/Notification";
  import { backgroundError } from "../Util/error";
  import { gt } from "../../l10n/l10n";
  import { onDestroy } from "svelte";

  const chatAccounts = appGlobal.chatAccounts;
  $: account = $chatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined;
  $: account && setUp(account);

  let unsubscribeWarnings: (() => void) | null = null;
  let shownWarnings = new Set<string>();

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
    if (document.hasFocus()) {
      return;
    }
    let notification = new SystemNotification(
      new NotificationKinds(["popup", "sound"]),
      room.name,
      message.text || (message.attachments.length ? gt`File` : ""),
      `chat-${room.id}`,
      "chat",
    );
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
