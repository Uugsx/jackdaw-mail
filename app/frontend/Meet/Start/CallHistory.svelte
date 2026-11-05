<vbox flex class="call-history">
  <hbox class="header">
    {#if !$appGlobal.isMobile}
      <Button
        icon={BackIcon}
        iconOnly
        plain
        label={$t`Back to meetings`}
        onClick={() => goTo(meetApp.appURL, {})} />
    {/if}
    <h2 class="heading">{$t`Call history`}</h2>
    <hbox flex />
    {#if $callLog.hasItems}
      <Button
        label={$t`Clear history`}
        classes="secondary"
        onClick={clearCallLog}
        errorCallback={showError} />
    {/if}
  </hbox>
  {#if errorMsg}
    <div class="error" role="alert">
      <ErrorMessage bind:errorMessage={errorMsg} errorGravity={ErrorGravity.Error} ex={errorEx} />
    </div>
  {/if}
  <Scroll>
    <div class="list">
      <CallLogList removable errorCallback={showError}>
        <div slot="emptyMsg" class="empty">
          <p class="empty-title">{$t`No calls yet`}</p>
          <p class="empty-hint">{$t`Calls to colleagues appear here. Start one from a chat or a contact.`}</p>
        </div>
      </CallLogList>
    </div>
  </Scroll>
</vbox>

{#if $appGlobal.isMobile}
  <CallHistoryBarM />
{/if}

<script lang="ts">
  import { appGlobal } from "../../../logic/app";
  import { loadCallLog, clearCallLog } from "../../../logic/Meet/Jackdaw/callLog";
  import { friendlyErrorMessage } from "../../../logic/util/friendlyError";
  import CallHistoryBarM from "./CallHistoryBarM.svelte";
  import CallLogList from "./CallLogList.svelte";
  import Button from "../../Shared/Button.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import ErrorMessage, { ErrorGravity } from "../../Shared/ErrorMessage.svelte";
  import BackIcon from "lucide-svelte/icons/arrow-left";
  import { goTo } from "../../AppsBar/selectedApp";
  import { meetApp } from "../MeetJackdawApp";
  import { logError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  const callLog = loadCallLog();

  let errorMsg: string | null = null;
  let errorEx: Error | null = null;

  function showError(ex: Error) {
    errorMsg = friendlyErrorMessage(ex);
    errorEx = ex;
    logError(ex);
  }
</script>

<style>
  .call-history {
    min-height: 0;
  }
  .header {
    align-items: center;
    gap: 8px;
    padding: 16px 24px 8px;
  }
  .heading {
    margin: 0;
    font-size: 1.375rem;
    line-height: 1.3;
    font-weight: 600;
  }
  .error {
    padding: 0 24px 8px;
  }
  .list {
    max-width: 720px;
    padding: 8px 16px 24px;
  }
  .empty {
    padding: 48px 8px;
    text-align: center;
  }
  .empty p {
    margin: 0;
    line-height: 1.45;
  }
  .empty-title {
    font-weight: 600;
    margin-block-end: 4px !important;
  }
  .empty-hint {
    opacity: 0.75;
  }
</style>
