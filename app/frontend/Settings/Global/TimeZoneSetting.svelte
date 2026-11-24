{#if available}
  <HeaderGroupBox>
    <hbox slot="header">{$t`Time zone`}</hbox>
    <vbox class="setting time-zone">
      <hbox class="dropdown">
        <select value={selected} on:change={event => catchErrors(() => onChange(event.currentTarget.value))}>
          <option value="">{$t`Same as this computer`} ({systemLabel})</option>
          {#each zones as zone (zone.id)}
            <option value={zone.id}>{zone.label}</option>
          {/each}
        </select>
      </hbox>
      <hbox class="hint font-small">
        {$t`All times in mail and calendar are shown in this time zone, regardless of the computer's time zone.`}
      </hbox>
    </vbox>
  </HeaderGroupBox>
{/if}

<script lang="ts">
  import { onMount } from "svelte";
  import { appGlobal } from "../../../logic/app";
  import { t } from "../../../l10n/l10n";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import { catchErrors } from "../../Util/error";

  type Zone = { id: string, label: string, offsetMin: number };

  let remoteApp = appGlobal.remoteApp as any;
  const available = typeof remoteApp?.setTimeZoneSetting == "function";
  let selected = "";
  const systemId = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function offsetMinutes(timeZone: string, date: Date): number {
    let parts = new Intl.DateTimeFormat("en-US", {
      timeZone, timeZoneName: "longOffset",
    }).formatToParts(date);
    let name = parts.find(part => part.type == "timeZoneName")?.value ?? "GMT";
    let match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (!match) {
      return 0;
    }
    return (match[1] == "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  }

  function formatOffset(minutes: number): string {
    let sign = minutes < 0 ? "-" : "+";
    let abs = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  }

  function buildZones(): Zone[] {
    let now = new Date();
    let ids: string[] = [];
    try {
      ids = (Intl as any).supportedValuesOf("timeZone");
    } catch {
      ids = [];
    }
    for (let extra of ["Europe/Moscow", "Asia/Tashkent", "UTC"]) {
      if (!ids.includes(extra)) {
        ids.push(extra);
      }
    }
    return ids.map(id => {
      let offsetMin = offsetMinutes(id, now);
      return { id, offsetMin, label: `(${formatOffset(offsetMin)}) ${id.replace(/_/g, " ")}` };
    }).sort((a, b) => a.offsetMin - b.offsetMin || a.id.localeCompare(b.id));
  }

  const zones: Zone[] = available ? buildZones() : [];
  const systemLabel = available ? `${formatOffset(offsetMinutes(systemId, new Date()))} ${systemId}` : "";

  onMount(() => catchErrors(async () => {
    if (available) {
      selected = (await remoteApp.getTimeZoneSetting()) ?? "";
    }
  }));

  async function onChange(value: string) {
    selected = (await remoteApp.setTimeZoneSetting(value || null)) ?? "";
    // Все даты считаются заново: перезапускаем приложение, чтобы ничего не осталось в старом поясе.
    // Простая перезагрузка окна не годится: секрет соединения с backend живёт в адресе страницы,
    // а роутер его стирает.
    await remoteApp.restartApp();
  }
</script>

<style>
  .setting {
    gap: 8px;
  }
  .hint {
    opacity: 0.75;
  }
  select {
    max-width: 420px;
  }
</style>
