<hbox class="get-mail {status}" class:fetching={!transfer && (status == Status.Fetching || externalSync)} class:login={status == Status.Login}>
  {#if transfer}
    <hbox
      class="transfer-status {transfer.state}"
      role="status"
      aria-live="polite"
      aria-busy={transfer.state == "active"}
      title={transferTooltip}
      >
      <hbox class="transfer-icon" aria-hidden="true">
        {#if transfer.state == "completed"}
          <DoneIcon size="16px" />
        {:else if transfer.state == "error"}
          <ErrorIcon size="16px" />
        {:else if transfer.action == "copy"}
          <CopyIcon size="16px" />
        {:else}
          <MoveIcon size="16px" />
        {/if}
      </hbox>
      <vbox class="transfer-details">
        <hbox class="transfer-heading">
          <span class="transfer-label">{transferLabel}</span>
          <span class="transfer-count">{transferCountLabel}</span>
        </hbox>
        <hbox
          class="transfer-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={transfer.state == "active" && transfer.completed == 0 ? undefined : transferPercent}
          aria-valuetext={transferCountLabel}
          >
          <span
            class="transfer-fill"
            class:indeterminate={transfer.state == "active" && transfer.completed == 0}
            style="width: {transferPercent}%" />
        </hbox>
      </vbox>
    </hbox>
  {:else}
    <RoundButton
      label={folder?.account?.fatalError?.message ?? $t`Get mail`}
      icon={
        status == Status.Fetching || externalSync ? DownloadIcon :
        status == Status.New ? NewIcon :
        status == Status.Error ? ErrorIcon :
        status == Status.Done ? DoneIcon :
        status == Status.Login ? LoginIcon :
        DownloadIcon
      }
      classes="small"
      {iconSize}
      padding="0px"
      disabled={!folder?.account || status != Status.Waiting}
      onClick={getMail}
      />
  {/if}
</hbox>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { appGlobal } from "../../../logic/app";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import DownloadIcon from "lucide-svelte/icons/refresh-cw";
  import DoneIcon from "lucide-svelte/icons/check";
  import NewIcon from "lucide-svelte/icons/sparkle";
  import LoginIcon from "lucide-svelte/icons/key-round";
  import ErrorIcon from "lucide-svelte/icons/server-crash";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import CopyIcon from "lucide-svelte/icons/mails";
  import { showError } from "../../Util/error";
  import { sleep } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";
  import { folderFetchBusy, folderSyncing, selectedFolder } from "../Selected";
  import { mailTransferProgress } from "../mailTransferProgress";
  import { mailSyncing } from "../../../logic/Mail/mailSyncStatus";

  export let folder: Folder | null = null; /* in */
  export let iconSize = appGlobal.isMobile ? "24px" : "12px";
  export let showProgress = false;

  enum Status {
    Waiting = "waiting",
    Login = "login",
    Fetching = "fetching",
    New = "new",
    Error = "error",
    Done = "done",
  };
  let status = Status.Waiting;

  $: externalSync =
    (!!folder && $selectedFolder === folder && $folderSyncing) ||
    (!!folder?.id && $folderFetchBusy.has(folder.id)) ||
    (showProgress && ($mailSyncing || $folderFetchBusy.size > 0));
  $: transfer = showProgress ? $mailTransferProgress : null;
  $: transferLabel = !transfer
    ? ""
    : transfer.state == "completed"
      ? (transfer.action == "copy" ? $t`Messages copied` : $t`Messages moved`)
      : transfer.state == "error"
        ? (transfer.action == "copy" ? $t`Copy failed` : $t`Move failed`)
        : (transfer.action == "copy" ? $t`Copying messages…` : $t`Moving messages…`);
  $: transferCountLabel = !transfer
    ? ""
    : transfer.state == "active"
      ? $t`${transfer.total - transfer.completed} mails`
      : `${transfer.completed} / ${transfer.total}`;
  $: transferPercent = transfer
    ? Math.round(transfer.completed / transfer.total * 100)
    : 0;
  $: transferTooltip = transfer?.targetName
    ? `${transferLabel} → ${transfer.targetName}`
    : transferLabel;

  async function getMail() {
    try {
      if (status != Status.Waiting) {
        return;
      }
      let account = folder.account;
      if (!account.isLoggedIn) {
        status = Status.Login;
        await account.login(true);
      }
      status = Status.Fetching;
      await folder.fetchNewMailQuick();
      folder.notifyObservers();
      status = folder.countNewArrived ? Status.New : Status.Done;
      await sleep(2);
      status = Status.Waiting;
    } catch (ex) {
      showError(ex);
      status = Status.Error;
      await sleep(2);
      status = Status.Waiting;
    }
  }
</script>

<style>
  .get-mail.new :global(svg) {
    color: orange;
    stroke-width: 3px;
  }
  .get-mail.done :global(svg) {
    color: green;
    stroke-width: 4px;
  }
  .get-mail.fetching :global(svg) {
    stroke-width: 2px;
    animation: get-mail-spin 1s linear infinite;
  }
  @keyframes get-mail-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .get-mail.fetching :global(svg) {
      animation: none;
    }
  }
  .get-mail :global(.loader) {
    /* Override Spinner.svelte margin: -4px, which makes the button move */
    margin: 0px;
  }
  .get-mail {
    min-width: 0;
  }
  .transfer-status {
    align-items: center;
    gap: 8px;
    width: min(230px, 100%);
    min-width: 160px;
    padding: 5px 9px;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--icon-primary) 28%, transparent);
    border-radius: 1000px;
    background-color: color-mix(in srgb, var(--selected-bg) 70%, var(--leftbar-bg));
    color: var(--selected-fg);
  }
  .transfer-status.completed {
    border-color: color-mix(in srgb, green 40%, transparent);
    background-color: color-mix(in srgb, green 12%, var(--leftbar-bg));
    color: color-mix(in srgb, green 72%, var(--leftbar-fg));
  }
  .transfer-status.error {
    border-color: color-mix(in srgb, red 40%, transparent);
    background-color: color-mix(in srgb, red 10%, var(--leftbar-bg));
    color: color-mix(in srgb, red 75%, var(--leftbar-fg));
  }
  .transfer-icon {
    flex: 0 0 auto;
  }
  .transfer-details {
    flex: 1 1 auto;
    min-width: 0;
    gap: 3px;
  }
  .transfer-heading {
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  .transfer-label,
  .transfer-count {
    font-size: 11px;
    line-height: 1.1;
  }
  .transfer-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 650;
  }
  .transfer-count {
    margin-inline-start: auto;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    opacity: 75%;
  }
  .transfer-track {
    width: 100%;
    height: 3px;
    overflow: hidden;
    border-radius: 1000px;
    background-color: color-mix(in srgb, currentColor 18%, transparent);
  }
  .transfer-fill {
    display: block;
    height: 100%;
    max-width: 100%;
    border-radius: inherit;
    background-color: currentColor;
    transition: width 180ms ease-out;
  }
  .transfer-fill.indeterminate {
    width: 35% !important;
    animation: transfer-progress 1.25s ease-in-out infinite;
  }
  @keyframes transfer-progress {
    0% { transform: translateX(-120%); }
    50% { transform: translateX(180%); }
    100% { transform: translateX(300%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .transfer-fill {
      transition: none;
    }
    .transfer-fill.indeterminate {
      animation: none;
      width: 55% !important;
    }
  }
</style>
