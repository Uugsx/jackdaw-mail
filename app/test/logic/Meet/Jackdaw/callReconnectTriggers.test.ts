// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { watchCallReconnectTriggers } from "../../../../logic/Meet/Jackdaw/JackdawCalls";
import { ComputerOn } from "../../../../logic/util/backend-wrapper";

describe("автоповтор входа в сервис звонков и чата", () => {
  let events: EventTarget;
  let client: { status: string; restart: ReturnType<typeof vi.fn> };
  let computerOn: ComputerOn;
  let stop: () => void;

  beforeEach(() => {
    events = new EventTarget();
    vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
    vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
    client = { status: "online", restart: vi.fn() };
    computerOn = new ComputerOn();
    stop = watchCallReconnectTriggers(client as any, computerOn);
  });

  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });

  test("сеть вернулась: после отказа и без связи — вход сразу, на связи и при подключении — нет", () => {
    for (let status of ["online", "connecting", "disabled"]) {
      client.status = status;
      events.dispatchEvent(new Event("online"));
    }
    expect(client.restart).not.toHaveBeenCalled();
    for (let status of ["rejected", "offline"]) {
      client.status = status;
      events.dispatchEvent(new Event("online"));
    }
    expect(client.restart).toHaveBeenCalledTimes(2);
  });

  test("система проснулась после отказа — вход сразу; засыпание само ничего не делает", () => {
    client.status = "rejected";
    computerOn.isSleeping = true;
    expect(client.restart).not.toHaveBeenCalled();
    computerOn.isSleeping = false;
    expect(client.restart).toHaveBeenCalledTimes(1);
  });

  test("после отписки события не действуют", () => {
    stop();
    client.status = "rejected";
    events.dispatchEvent(new Event("online"));
    computerOn.isSleeping = true;
    computerOn.isSleeping = false;
    expect(client.restart).not.toHaveBeenCalled();
  });

  test("без процесса приложения (нет ComputerOn) работает по событию сети", () => {
    stop();
    stop = watchCallReconnectTriggers(client as any, null);
    client.status = "offline";
    events.dispatchEvent(new Event("online"));
    expect(client.restart).toHaveBeenCalledTimes(1);
  });
});
