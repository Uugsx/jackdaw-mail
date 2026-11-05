import { describe, expect, test } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";
import {
  alertIncidentKey,
  alertMessageOpensIncident,
  buildAlertIncidents,
  compileAlertPatterns,
  indexAlertIncidentHistory,
  normalizeAlertSubject,
  suggestAlertFolder,
} from "../../../logic/Mail/AlertIncident";

const minute = 60 * 1000;
const hour = 60 * minute;
const base = new Date(2026, 9, 20, 9, 0).getTime();

let nextID = 0;
function mail(subject: string, at: number, from = "alerts@monitoring.example", isRead = false): EMail {
  return {
    dbID: ++nextID,
    subject,
    received: new Date(at),
    sent: new Date(at),
    isRead,
    from: { emailAddress: from, name: "Monitoring" },
    contact: null,
  } as unknown as EMail;
}

function key(subject: string): string {
  return normalizeAlertSubject(subject).key;
}

describe("normalizeAlertSubject", () => {
  test("Prometheus Alertmanager: FIRING and RESOLVED pair", () => {
    let firing = normalizeAlertSubject("[FIRING:3] InstanceDown (node-exporter 10.0.0.1:9100 prod)");
    let resolved = normalizeAlertSubject("[RESOLVED] InstanceDown (node-exporter 10.0.0.1:9100 prod)");
    expect(firing.polarity).toBe("firing");
    expect(resolved.polarity).toBe("resolved");
    expect(firing.key).toBe(resolved.key);
    expect(firing.cleaned).toBe("InstanceDown (node-exporter 10.0.0.1:9100 prod)");
    expect(firing.template).toBe("InstanceDown (node-exporter … prod)");
  });

  test("Zabbix: Problem / Resolved in …", () => {
    let problem = normalizeAlertSubject("Problem: High CPU utilization on srv-db01");
    let resolved = normalizeAlertSubject("Resolved in 15m 0s: High CPU utilization on srv-db01");
    expect(problem.polarity).toBe("firing");
    expect(resolved.polarity).toBe("resolved");
    expect(problem.key).toBe(resolved.key);
    expect(normalizeAlertSubject("PROBLEM: Disk full").key).toBe(normalizeAlertSubject("OK: Disk full").key);
    expect(normalizeAlertSubject("OK: Disk full").polarity).toBe("resolved");
  });

  test("Grafana: unified and legacy subjects", () => {
    expect(key("[FIRING:1] CPU usage (grafana)")).toBe(key("[RESOLVED] CPU usage (grafana)"));
    expect(normalizeAlertSubject("[Alerting] Queue length").polarity).toBe("firing");
    let ok = normalizeAlertSubject("[OK] Queue length");
    expect(ok.polarity).toBe("resolved");
    expect(ok.key).toBe(key("[Alerting] Queue length"));
    expect(normalizeAlertSubject("[No Data] Queue length").polarity).toBe("firing");
  });

  test("Datadog: Triggered / Recovered with host scope and priority", () => {
    let triggered = normalizeAlertSubject("[P2] [Triggered on {host:web-1}] CPU is high");
    let recovered = normalizeAlertSubject("[Recovered on {host:web-1}] CPU is high");
    expect(triggered.polarity).toBe("firing");
    expect(recovered.polarity).toBe("resolved");
    expect(triggered.key).toBe(recovered.key);
    expect(normalizeAlertSubject("[Re-Triggered] CPU is high").key).toBe(triggered.key);
    expect(normalizeAlertSubject("[Warn] CPU is high").polarity).toBe("firing");
  });

  test("Azure Monitor and Nagios", () => {
    let fired = normalizeAlertSubject("Fired:Sev3 Azure Monitor Alert CPU on vm-1 at 10/20/2026 10:00:00 AM");
    let resolved = normalizeAlertSubject("Resolved:Sev3 Azure Monitor Alert CPU on vm-2 at 10/21/2026 11:30:00 PM");
    expect(fired.polarity).toBe("firing");
    expect(resolved.polarity).toBe("resolved");
    expect(fired.key).toBe(resolved.key);

    let problem = normalizeAlertSubject("** PROBLEM Service Alert: web01/HTTP is CRITICAL **");
    let recovery = normalizeAlertSubject("** RECOVERY Service Alert: web01/HTTP is OK **");
    expect(problem.polarity).toBe("firing");
    expect(recovery.polarity).toBe("resolved");
    expect(problem.key).toBe(recovery.key);
  });

  test("Russian error / restored subjects", () => {
    let error = normalizeAlertSubject("Ошибка: нет связи с сервером 1С (заказ 12345)");
    let restored = normalizeAlertSubject("Восстановлено: нет связи с сервером 1С (заказ 12345)");
    expect(error.polarity).toBe("firing");
    expect(restored.polarity).toBe("resolved");
    expect(error.key).toBe(restored.key);
    expect(key("[ОШИБКА] Интеграция WB")).toBe(key("[ВОССТАНОВЛЕНО] Интеграция WB"));
    expect(normalizeAlertSubject("[ВОССТАНОВЛЕНО] Интеграция WB").polarity).toBe("resolved");
    let suffix = normalizeAlertSubject("Сервер ИПОЛ недоступен — восстановлено");
    expect(suffix.polarity).toBe("resolved");
    expect(suffix.key).toBe(key("Сервер ИПОЛ недоступен"));
  });

  test("removes numbers, IDs, dates, hosts and reply prefixes", () => {
    let a = key("Re: Fwd: Ошибка выгрузки заказа 4815162342 от 20.10.2026 12:30:01 на db01.corp.local");
    let b = key("Ошибка выгрузки заказа 99 от 21.10.2026 08:00 на app07.corp.local");
    expect(a).toBe(b);
    expect(key("Job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed")).toBe(key("Job 9a0c0305e82c3301 failed"));
    expect(key("Timeout on 192.168.1.10:8080")).toBe(key("Timeout on 10.0.0.2"));
    expect(key("Report for Oct 20, 2026")).toBe(key("Report for Nov 1, 2026"));
    expect(key("Отчёт за 20 октября")).toBe(key("Отчёт за 3 ноября"));
  });

  test("ordinary subjects keep their words", () => {
    expect(normalizeAlertSubject("Update on the contract").cleaned).toBe("Update on the contract");
    expect(normalizeAlertSubject("Update on the contract").polarity).toBe("firing");
    expect(key("Disk may be full")).toBe("disk may be full");
    expect(key("Ошибка выгрузки")).not.toBe(key("Выгрузка"));
  });

  test("custom patterns remove host names", () => {
    let patterns = compileAlertPatterns(["srv-[a-z]+", "(bad"]);
    expect(patterns).toHaveLength(1);
    expect(compileAlertPatterns(["srv-[a-z]+", "(bad"])).toBe(patterns);
    expect(normalizeAlertSubject("CPU high on srv-alpha", patterns).key)
      .toBe(normalizeAlertSubject("CPU high on srv-beta", patterns).key);
    expect(normalizeAlertSubject("CPU high on srv-alpha").key)
      .not.toBe(normalizeAlertSubject("CPU high on srv-beta").key);
  });
});

describe("buildAlertIncidents", () => {
  test("groups by sender and normalized subject with counters and times", () => {
    let messages = [
      mail("[FIRING:1] DiskFull db01", base),
      mail("[FIRING:1] DiskFull db02", base + 5 * minute),
      mail("[FIRING:1] DiskFull db03", base + 10 * minute, "alerts@monitoring.example", true),
      mail("[FIRING:1] DiskFull db01", base + 7 * minute, "other@monitoring.example"),
      mail("Weekly report", base + 2 * minute, "boss@example.com"),
    ];
    let incidents = buildAlertIncidents(messages, { now: base + 20 * minute, quietMs: hour });
    expect(incidents).toHaveLength(3);
    let disk = incidents[0];
    expect(disk.firingCount).toBe(3);
    expect(disk.unreadCount).toBe(2);
    expect(disk.firstAt?.getTime()).toBe(base);
    expect(disk.lastAt?.getTime()).toBe(base + 10 * minute);
    expect(disk.status).toBe("active");
    expect(disk.label).toBe("DiskFull db…");
    expect(disk.messages.map(message => message.subject)).toEqual([
      "[FIRING:1] DiskFull db03",
      "[FIRING:1] DiskFull db02",
      "[FIRING:1] DiskFull db01",
    ]);
    expect(disk.nextTransitionAt).toBe(base + 10 * minute + hour + 1);
    expect(incidents[1].senderLabel).toBe("Monitoring");
    expect(incidents[2].label).toBe("Weekly report");
  });

  test("label keeps the real subject when all messages share it", () => {
    let incidents = buildAlertIncidents([
      mail("Problem: Queue 15 stuck", base),
      mail("Problem: Queue 15 stuck", base + minute),
    ], { now: base + 2 * minute });
    expect(incidents[0].label).toBe("Queue 15 stuck");
  });

  test("resolved after the last firing", () => {
    let incidents = buildAlertIncidents([
      mail("[FIRING:2] HighLatency", base),
      mail("[FIRING:2] HighLatency", base + 5 * minute),
      mail("[RESOLVED] HighLatency", base + 9 * minute),
    ], { now: base + 10 * minute, quietMs: hour });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].status).toBe("resolved");
    expect(incidents[0].firingCount).toBe(2);
    expect(incidents[0].resolvedCount).toBe(1);
    expect(incidents[0].lastAt?.getTime()).toBe(base + 5 * minute);
    expect(incidents[0].nextTransitionAt).toBeNull();
  });

  test("quiet after the quiet period", () => {
    let incidents = buildAlertIncidents([
      mail("Ошибка: WB API", base),
      mail("Ошибка: WB API", base + 10 * minute),
    ], { now: base + 10 * minute + hour + 1, quietMs: hour });
    expect(incidents[0].status).toBe("quiet");
  });

  test("resumed after a quiet period, after resolved and after closing", () => {
    let afterQuiet = buildAlertIncidents([
      mail("Ошибка: WB API", base),
      mail("Ошибка: WB API", base + 3 * hour),
      mail("Ошибка: WB API", base + 3 * hour + 5 * minute),
    ], { now: base + 3 * hour + 10 * minute, quietMs: hour });
    expect(afterQuiet[0].status).toBe("resumed");

    let afterResolved = buildAlertIncidents([
      mail("Ошибка: WB API", base),
      mail("Восстановлено: WB API", base + 5 * minute),
      mail("Ошибка: WB API", base + 10 * minute),
    ], { now: base + 11 * minute, quietMs: hour });
    expect(afterResolved[0].status).toBe("resumed");
    expect(afterResolved[0].firingCount).toBe(2);

    let messages = [mail("Ошибка: WB API", base), mail("Ошибка: WB API", base + 10 * minute)];
    let closedAt = base + 5 * minute;
    let afterClose = buildAlertIncidents(messages, { now: base + 11 * minute, quietMs: hour, closedAt: () => closedAt });
    expect(afterClose[0].status).toBe("resumed");
    let closed = buildAlertIncidents(messages, { now: base + 11 * minute, quietMs: hour, closedAt: () => base + 10 * minute });
    expect(closed[0].status).toBe("closed");
  });

  test("continuous firing stays active, not resumed", () => {
    let messages = Array.from({ length: 20 }, (_, i) => mail("[FIRING:1] Flapping", base + i * 10 * minute));
    let incidents = buildAlertIncidents(messages, { now: base + 200 * minute, quietMs: hour });
    expect(incidents[0].status).toBe("active");
    expect(incidents[0].firingCount).toBe(20);
  });

  test("handles 50 000 messages linearly", () => {
    let messages: EMail[] = [];
    for (let i = 0; i < 50_000; i++) {
      messages.push(mail(`[FIRING:1] Check ${i % 40} failed on host-${i}.corp.local id ${i * 7919}`,
        base + i * 1000, `monitor${i % 5}@example.com`));
    }
    let started = performance.now();
    let incidents = buildAlertIncidents(messages, { now: base + 50_000 * 1000, quietMs: hour });
    let cold = performance.now() - started;
    expect(incidents).toHaveLength(5);
    expect(incidents.reduce((total, incident) => total + incident.firingCount, 0)).toBe(50_000);

    started = performance.now();
    buildAlertIncidents(messages, { now: base + 50_000 * 1000, quietMs: hour });
    let warm = performance.now() - started;
    // Регулярные выражения — один раз на письмо; повторная сборка из кэша быстрая
    expect(cold).toBeLessThan(5000);
    expect(warm).toBeLessThan(1000);
  });
});

describe("notifications", () => {
  test("only a new incident or a resumption opens a notification", () => {
    let old = [mail("Ошибка: WB API", base), mail("Ошибка: WB API", base + 5 * minute)];
    let repeat = mail("Ошибка: WB API", base + 10 * minute);
    let history = indexAlertIncidentHistory([...old, repeat], new Set([repeat]));
    let previous = history.get(alertIncidentKey(repeat))!;
    expect(alertMessageOpensIncident(repeat, previous, { quietMs: hour })).toBe(false);

    let later = mail("Ошибка: WB API", base + 5 * minute + 2 * hour);
    expect(alertMessageOpensIncident(later, previous, { quietMs: hour })).toBe(true);

    let fresh = mail("Ошибка: ИПОЛ", base + 10 * minute);
    let noHistory = indexAlertIncidentHistory(old, new Set()).get(alertIncidentKey(fresh));
    expect(noHistory).toBeUndefined();
    expect(alertMessageOpensIncident(fresh, { lastFiring: null, lastResolved: null })).toBe(true);

    let resolved = mail("Восстановлено: WB API", base + 11 * minute);
    expect(alertMessageOpensIncident(resolved, previous, { quietMs: hour })).toBe(false);
    expect(alertMessageOpensIncident(repeat, { lastFiring: base, lastResolved: base + minute }, { quietMs: hour })).toBe(true);
    expect(alertMessageOpensIncident(repeat, previous, { quietMs: hour, closedAt: base + 6 * minute })).toBe(true);
  });
});

describe("suggestAlertFolder", () => {
  test("suggests a folder full of the same alert from one sender", () => {
    let messages = Array.from({ length: 40 }, (_, i) => mail(`Ошибка обмена ${i}`, base + i * minute));
    messages.push(mail("Привет", base, "colleague@example.com"));
    let suggestion = suggestAlertFolder(messages);
    expect(suggestion?.count).toBe(40);
    expect(suggestion?.label).toBe("Ошибка обмена …");
  });

  test("does not suggest an ordinary folder", () => {
    let messages = Array.from({ length: 40 }, (_, i) => mail(`Letter about topic ${String.fromCharCode(65 + i)}`, base + i * minute,
      `person${i}@example.com`));
    expect(suggestAlertFolder(messages)).toBeNull();
  });
});
