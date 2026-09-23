<MenuItem
  onClick={reply}
  label={$t`Reply to author`}
  tooltip={$t`Reply to the person who sent this message`}
  icon={ReplyIcon} />
<MenuItem
  onClick={replyAll}
  label={$t`Reply to all`}
  tooltip={$t`Reply to all recipients of this message`}
  disabled={!canReplyAllMenu}
  icon={ReplyAllIcon} />
<MenuItem
  onClick={forward}
  label={$t`Forward`}
  tooltip={$t`Send this message to somebody else`}
  icon={ForwardIcon} />
{#if onMove}
  <MenuItem
    onClick={onMove}
    label={$t`Move to folder, or add tag`}
    icon={MoveIcon} />
{/if}
<MenuItem
  onClick={redirect}
  label={$t`Redirect`}
  tooltip={$t`Send this message to somebody else, who can reply to the original sender`}
  icon={RedirectIcon} />
{#if message.outgoing}
  <MenuItem
    onClick={editAsNew}
    label={$t`Edit as new`}
    tooltip={$t`Create a new message with the same content and recipients`}
    icon={EditAsNewIcon} />
{/if}
<MenuItem
  onClick={newToAll}
  label={$t`New topic`}
  tooltip={$t`Send a new, unrelated message to all recipients`}
  icon={NewAllIcon} />
<MenuDivider />
<MenuItem
  onClick={toggleRead}
  label={$message.isRead ? $t`Mark as unread` : $t`Mark as read`}
  tooltip={$message.isRead ? $t`Mark this message as unread` : $t`Mark this message as read`}
  icon={$message.isRead ? MailOpenIcon : MailIcon} />
<MenuItem
  onClick={deleteMessage}
  classes="danger"
  label={$t`Delete`}
  icon={TrashIcon} />
{#if message.folder?.specialFolder == SpecialFolder.Trash || message.folder?.specialFolder == SpecialFolder.Spam}
  <MenuItem
    onClick={restoreMessage}
    label={$t`Restore`}
    tooltip={$t`Move this message back to the Inbox`}
    icon={UndoIcon} />
{/if}
<MenuItem
  onClick={toggleSpam}
  classes={$message.isSpam ? "" : "danger"}
  label={$message.isSpam ? $t`Mark as not spam` : $t`Mark as spam`}
  tooltip={$message.isSpam ? $t`Treat this email as *not* spam` : $t`Treat this email as spam: Move it to the Spam folder, and train the spam filter`}
  icon={$message.isSpam ? NotSpamIcon : SpamIcon} />
{#if $availableTags.hasItems}
  <MenuDivider />
  <SubMenu label={$t`Set categories`}>
    <hbox slot="icon" class="categories-icon" aria-hidden="true">
      <span class="sq sq-a"></span>
      <span class="sq sq-b"></span>
      <span class="sq sq-c"></span>
      <span class="sq sq-d"></span>
    </hbox>
    <MenuItem
      onClick={clearTags}
      label={$t`Clear all`}
      tooltip={$t`Remove all categories from this message`}
      disabled={!anyTargetHasTags}
      closeOnClick={false} />
    <MenuDivider />
    {#if $tagCombinations.hasItems}
      {#each usableTagCombinations($tagCombinations.contents) as combination (combination.id)}
        <MenuItem
          label={combination.name}
          onClick={() => applyCombination(combination)}
          closeOnClick={false}
          tooltip={$t`Apply this category combination`}>
          <hbox slot="icon" class="combo-dots">
            {#each resolveCombinationTags(combination) as tag (tag.name)}
              <span class="tag-dot" style="--tag-color: {tag.color}" />
            {/each}
          </hbox>
        </MenuItem>
      {/each}
      <MenuDivider />
    {/if}
    {#each sortedTagList($availableTags.contents) as tag (tag.name)}
      <MenuItem
        label={tag.name}
        selected={checkedTags.has(tag.name)}
        onClick={() => toggleTag(tag)}
        closeOnClick={false}
        tooltip={$t`Apply or remove this category on the message`}>
        <hbox slot="icon" class="tag-dot" style="--tag-color: {tag.color}" />
      </MenuItem>
    {/each}
  </SubMenu>
{/if}
<MenuItem
  onClick={toggleImportant}
  label={$message.isImportant ? $t`Mark as not important` : $t`Mark as important`}
  icon={ImportantIcon} />
<MenuItem
  onClick={archiveMessage}
  label={$t`Archive`}
  tooltip={$t`Move this email to the archive folder`}
  icon={ArchiveIcon} />
<MenuItem
  onClick={save}
  label={$t`Export as file`}
  tooltip={$t`Save this email to a file on your computer`}
  icon={SaveIcon} />
{#if printE}
  <MenuItem
    onClick={print}
    label={$t`Print`}
    tooltip={$t`Put ink on dead trees which were artificially made white. Save the trees!`}
    icon={PrintIcon} />
{/if}
<MenuItem
  onClick={showSource}
  label={$t`Show source`}
  tooltip={$t`Show the on-the-wire format of this message`}
  icon={SourceIcon} />
<MenuItem
  onClick={showDOMInspector}
  label={$t`Show DOM`}
  tooltip={$t`Show HTML email in the DOM Inspector of the Developer Tools`}
  icon={SourceIcon} />
<hbox bind:this={domE} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import { availableTags, sortedTagList, type Tag } from "../../../logic/Abstract/Tag";
  import {
    applyTagCombinationToEmails,
    resolveCombinationTags,
    sortedTagCombinations,
    tagCombinations,
    usableTagCombinations,
    type TagCombination,
  } from "../../../logic/Abstract/TagCombination";
  import { mailApp } from "../MailJackdawApp";
  import { openEMailMessage } from "../open";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { getMessageContentRenderingSetting } from "./messageViewerAppearance";
  import type Print from "./MessagePrint.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import SubMenu from "../../Shared/Menu/SubMenu.svelte";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import NewAllIcon from "lucide-svelte/icons/plus";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import RedirectIcon from "lucide-svelte/icons/move-right";
  import EditAsNewIcon from "lucide-svelte/icons/iteration-ccw";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import UndoIcon from "lucide-svelte/icons/undo-2";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import SaveIcon from "lucide-svelte/icons/save";
  import PrintIcon from "lucide-svelte/icons/printer";
  import SourceIcon from "lucide-svelte/icons/code-xml";
  import MailIcon from "lucide-svelte/icons/mail";
  import MailOpenIcon from "lucide-svelte/icons/mail-open";
  import { saveBlobAsFile } from "../../Util/util";
  import { catchErrors, showError } from "../../Util/error";
  import { deleteMessagesFromUI } from "../mailDeleteUndo";
  import { runMailActions } from "../mailBulkActions";
  import { moveMessagesToArchive } from "../mailArchiveActions";
  import { markMessagesRead, messagesRepresentSameMail } from "../mailReadActions";
  import { selectedMessage, selectedMessages } from "../Selected";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

  import { computeCanReplyAll, subscribeCanReplyAll } from "../canReplyAll";

  export let message: EMail;
  export let printE: Print | null = null;
  export let onMove: (() => void) | null = null;

  let replyAllRev = 0;
  let replyAllUnsub: (() => void) | null = null;
  $: {
    replyAllUnsub?.();
    replyAllUnsub = subscribeCanReplyAll(message, () => replyAllRev++);
  }
  $: canReplyAllMenu = (replyAllRev, computeCanReplyAll(message));

  function actionTargets(): EMail[] {
    return ($selectedMessages?.hasItems && message && $selectedMessages.contents.some(target => messagesRepresentSameMail(target, message))
      ? $selectedMessages.contents
      : [message]).slice();
  }

  function reply() {
    catchErrors(async () => {
      await message.loadForDisplay();
      let reply = message.compose.replyToAuthor();
      mailApp.writeMail(reply);
    });
  }
  function replyAll() {
    catchErrors(async () => {
      await message.loadForDisplay();
      let reply = message.compose.replyAll();
      mailApp.writeMail(reply);
    });
  }
  function newToAll() {
    let mail = message.compose.newToAll();
    mailApp.writeMail(mail);
  }
  async function forward(event: MouseEvent) {
    let setting = getLocalStorage("mail.send.forward", "inline").value;
    let shift = !!event?.shiftKey;
    let forward: EMail;
    if (setting == "attachment" && !shift || setting == "inline" && shift) {
      forward = await message.compose.forwardAsAttachment();
    } else {
      forward = await message.compose.forwardInline();
    }
    mailApp.writeMail(forward);
  }
  async function redirect() {
    let redirect = await message.compose.redirect();
    mailApp.writeMail(redirect);
  }
  async function editAsNew() {
    let clone = await message.compose.editAsNew();
    mailApp.writeMail(clone);
  }

  async function deleteMessage() {
    let list = actionTargets();
    await deleteMessagesFromUI(list, () => goToNextMessage(list[0] ?? message));
  }
  async function restoreMessage() {
    let list = actionTargets();
    let last = list.at(-1) ?? null;
    await runMailActions(list, m => m.restoreFromTrash());
    if (last) {
      await openEMailMessage(last);
    }
  }
  async function toggleSpam() {
    let list = actionTargets();
    let toSpam = !list[0]?.isSpam;
    goToNextMessage(list[0] ?? message);
    await runMailActions(list, m => m.treatSpam(toSpam));
  }
  async function archiveMessage() {
    let list = actionTargets();
    goToNextMessage(list[0] ?? message);
    await moveMessagesToArchive(list);
  }
  async function toggleImportant() {
    let list = actionTargets();
    let toImportant = !list[0]?.isImportant;
    await runMailActions(list, m => m.markImportant(toImportant));
  }
  async function toggleRead() {
    let list = actionTargets();
    if (message && list.some(target => target !== message && messagesRepresentSameMail(target, message))) {
      list.push(message);
    }
    let toRead = !list[0]?.isRead;
    await markMessagesRead(list, toRead);
  }

  /**
   * The category menu stays open across clicks, so its checkmarks have to
   * follow the tags as they change. Svelte's legacy mode works out
   * dependencies syntactically, so calling a function from the markup would
   * never re-run it - the state has to be derived here, where the compiler can
   * see what it reads.
   */
  let tagsEpoch = 0;
  $: tagTargets = currentTagTargets(tagsEpoch, $selectedMessages, message);
  $: checkedTags = new Set(
    $availableTags.contents
      .filter(tag => majorityHasTag(tag, tagTargets))
      .map(tag => tag.name));
  $: anyTargetHasTags = tagTargets.some(m => m.tags.hasItems);

  /* The parameters are the dependencies of the statement above; the values
   * come from `actionTargets()`. */
  function currentTagTargets(_epoch: number, _selected: unknown, _message: EMail): EMail[] {
    return actionTargets();
  }

  function majorityHasTag(tag: Tag, list: EMail[] = tagTargets): boolean {
    if (!list.length) {
      return false;
    }
    return list.filter(m => m.tags.contains(tag)).length / list.length > 0.5;
  }

  async function applyCombination(combination: TagCombination) {
    try {
      await applyTagCombinationToEmails(actionTargets(), combination);
    } finally {
      tagsEpoch++;
    }
  }

  async function toggleTag(tag: Tag) {
    let list = actionTargets();
    let remove = majorityHasTag(tag, list);
    let targets = remove
      ? list.filter(m => m.tags.contains(tag))
      : list.filter(m => !m.tags.contains(tag));
    try {
      await runMailActions(targets, m => remove ? m.removeTag(tag) : m.addTag(tag));
    } finally {
      tagsEpoch++;
    }
  }
  async function clearTags() {
    try {
      await runMailActions(actionTargets(), m => m.clearTags());
    } finally {
      tagsEpoch++;
    }
  }

  function goToNextMessage(anchor: EMail = message) {
    let next = anchor?.nextMessage();
    // Mutate rather than replace: FastList and the ribbon observe this exact
    // collection, and a new instance would silently detach them.
    $selectedMessages.replaceAll(next ? [next] : []);
    $selectedMessage = next ?? null;
    if (next) {
      message = next;
    }
  }

  async function save() {
    await message.loadMIME();
    let content = message.mime as Uint8Array<ArrayBuffer>;
    let filename = sanitize.filename(message.subject, "email") + ".eml";
    let file = new File([content], filename, { type: "message/rfc822" });
    await saveBlobAsFile(file);
  }

  async function print() {
    printE.print()
      .catch(showError);
  }

  function showSource() {
    let setting = getMessageContentRenderingSetting(message.folder?.account);
    setting.value = setting.value == "source" ? "html" : "source";
  }
  let domE: HTMLDivElement;
  function showDOMInspector() {
    let setting = getMessageContentRenderingSetting(message.folder?.account);
    setting.value = "html";
    let messageE = domE.ownerDocument.querySelector(".message-body");
    let webviewE = messageE.querySelector("webview") as HTMLIFrameElement as any;
    webviewE.openDevTools();
  }
</script>

<style>
  .tag-dot {
    width: 10px;
    height: 10px;
    border-radius: 1000px;
    background-color: var(--tag-color);
    flex-shrink: 0;
  }
  .combo-dots {
    gap: 3px;
    align-items: center;
  }
  .categories-icon {
    display: grid;
    grid-template-columns: 7px 7px;
    grid-template-rows: 7px 7px;
    gap: 2px;
    width: 16px;
    height: 16px;
  }
  .sq {
    display: block;
    border-radius: 1px;
  }
  .sq-a { background: #5B9BD5; }
  .sq-b { background: #A6A6A6; }
  .sq-c { background: #ED7D31; }
  .sq-d { background: #70AD47; }
</style>
