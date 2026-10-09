<vbox flex>
  <hbox class="header">
    <hbox class="emailAddress font-small">{$account.emailAddress}</hbox>
    <hbox flex />
    {#if account.oAuth2 instanceof OAuth2}
      <hbox class="buttons">
        {#if oAuth2Running != OAuth2UIMethod.Embed}
          <Button label={$t`Login inline *=> within the same application window`}
            onClick={() => run(loginEmbed)}
            errorCallback={showError}
            />
        {/if}
        <Button label={$t`Login in browser`}
          onClick={() => run(loginBrowser)}
          errorCallback={showError}
          />
        {#if canCopyURL()}
          <Button label={showConfirmCopied ? $t`URL copied` : $t`Copy URL`}
            onClick={() => run(loginCopyURL)}
            errorCallback={showError}
            />
        {/if}
      </hbox>
    {/if}
  </hbox>
  {#if oAuth2Running == OAuth2UIMethod.Embed && embed}
    <vbox class="browser">
      <OAuth2EmbeddedBrowser dialog={embed} withURLbar={false} />
    </vbox>
  {:else if oAuth2Running == OAuth2UIMethod.SystemBrowser ||
      oAuth2Running == OAuth2UIMethod.Localhost}
    <vbox class="waiting">
      <Spinner size="64px" />
      <hbox class="text">
        {$t`Waiting for you to complete the login in your browser`}
      </hbox>
      {#if getProvider(account) == Provider.Google}
        <hbox class="text hint">
          {$t`After signing in, return to Jackdaw — do not close this window.`}
        </hbox>
      {/if}
    </vbox>
  {:else}
    <vbox class="waiting">
      <Spinner size="64px" />
    </vbox>
  {/if}
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { OAuth2 } from "../../../logic/Auth/OAuth2";
  import { Provider } from "../../../logic/Auth/OAuth2URLs";
  import { getProvider } from "../../../logic/Auth/OAuth2Util";
  import { newOAuth2UI, OAuth2UIMethod } from "../../../logic/Auth/UI/OAuth2UIMethod";
  import type { OAuth2UI } from "../../../logic/Auth/UI/OAuth2UI";
  import { OAuth2Embed } from "../../../logic/Auth/UI/OAuth2Embed";
  import { OAuth2Localhost } from "../../../logic/Auth/UI/OAuth2Localhost";
  import { UserCancelled, sleep, assert, type URLString } from "../../../logic/util/util";
  import OAuth2EmbeddedBrowser from "../../Shared/Auth/OAuth2EmbeddedBrowser.svelte";
  import Spinner from "../../Shared/Spinner.svelte";
  import Button from "../../Shared/Button.svelte";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { onDestroy, onMount } from "svelte";

  export let account: MailAccount;
  export let startWith: OAuth2UIMethod | null = OAuth2UIMethod.Embed;
  export let onContinue = () => undefined;
  export let onError = (ex: Error) => undefined;
  export let onCancel = () => undefined;

  let oAuth2Running: OAuth2UIMethod | null = null;
  let embed: OAuth2Embed;
  let url: URLString | null = null;
  let activeUI: OAuth2UI | null = null;

  onMount(() => catchErrors(async () => {
    assert(account.oAuth2, "Need OAuth2 config");
    let method = startWith;
    // Google blocks OAuth inside embedded webviews — use the system browser.
    if (method == OAuth2UIMethod.Embed && getProvider(account) == Provider.Google) {
      method = OAuth2UIMethod.SystemBrowser;
    }
    if (method == OAuth2UIMethod.SystemBrowser) {
      await loginBrowser();
    } else if (method == OAuth2UIMethod.Localhost) {
      await loginCopyURL();
    } else {
      await loginEmbed();
    }
  }, showError));

  onDestroy(() => {
    activeUI?.abort();
    activeUI = null;
    account.oAuth2.abort();
  });

  /** Do not wait for the async function */
  function run(func: () => Promise<void>) {
    func().catch(showError);
  }

  function canCopyURL(): boolean {
    return account.oAuth2 instanceof OAuth2 && account.oAuth2.supportsSystemBrowser;
  }

  async function prepareLogin(method: OAuth2UIMethod) {
    activeUI?.abort();
    activeUI = null;
    account.oAuth2.abort();
    oAuth2Running = method;
  }

  async function startLogin(ui: OAuth2UI, dailyUI: OAuth2UIMethod) {
    assert(account.oAuth2 instanceof OAuth2, "Need OAuth2 config");
    let oAuth2 = account.oAuth2;
    activeUI = ui;
    try {
      let authCode = await ui.login();
      oAuth2Running = null;
      await oAuth2.getAccessTokenFromAuthCode(authCode);
      oAuth2.uiMethod = dailyUI;
      onContinue();
    } finally {
      if (activeUI === ui) {
        activeUI = null;
        oAuth2Running = null;
      }
    }
  }

  async function loginBrowser() {
    await prepareLogin(OAuth2UIMethod.SystemBrowser);
    assert(account.oAuth2 instanceof OAuth2, "Need OAuth2 config");
    let ui = newOAuth2UI(OAuth2UIMethod.SystemBrowser, account.oAuth2);
    await startLogin(ui, OAuth2UIMethod.SystemBrowser);
  }

  async function loginEmbed() {
    await prepareLogin(OAuth2UIMethod.Embed);
    embed = new OAuth2Embed(account.oAuth2);
    try {
      await startLogin(embed, OAuth2UIMethod.Tab);
    } finally {
      embed = null;
      oAuth2Running = null; // Allow to restart on fail
    }
  }

  async function loginCopyURL() {
    if (!(account.oAuth2 instanceof OAuth2) || !account.oAuth2.supportsSystemBrowser) {
      await loginBrowser();
      return;
    }
    if (oAuth2Running == OAuth2UIMethod.Localhost && url) {
      await showCopyURL(url);
      return;
    }
    await prepareLogin(OAuth2UIMethod.Localhost);
    let localhost = new OAuth2Localhost(account.oAuth2);
    localhost.loginURLCallback = showCopyURL;
    try {
      // User wants to control which browser to open it in, not system browser
      await startLogin(localhost, OAuth2UIMethod.Tab);
    } finally {
      url = null;
    }
  }

  async function showCopyURL(loginURL: URLString) {
    url = loginURL;
    await navigator.clipboard.writeText(loginURL);
    confirmCopied()
      .catch(console.error);
  }

  let showConfirmCopied = false;
  async function confirmCopied() {
    showConfirmCopied = true;
    await sleep(2);
    showConfirmCopied = false;
  }

  function showError(ex: Error) {
    if (ex instanceof UserCancelled) {
      onCancel();
      return;
    }
    onError(ex);
  }
</script>

<style>
  .header {
    align-items: center;
    margin-block-end: 16px;
    flex-wrap: wrap;
  }
  .buttons {
    margin-block-start: 12px;
  }
  .header .buttons :global(> button) {
    margin-inline-end: 12px;
  }
  .emailAddress {
    word-wrap: break-word;
    margin-inline-end: 24px;
  }
  .browser {
    min-height: 540px; /* OWA login is slightly taller than regular oAuth2 */
    min-width: 500px;
  }
  .waiting {
    align-items: center;
    margin-block-start: 24px;
    margin-block-end: 8px;
  }
  .waiting .text {
    flex-wrap: wrap;
    margin-block-start: 24px;
  }
  .waiting .hint {
    opacity: 0.75;
    margin-block-start: 8px;
    font-size: 0.9em;
  }
</style>
