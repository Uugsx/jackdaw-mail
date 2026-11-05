// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationMessage, InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { IncomingInvitation } from "../../../../logic/Calendar/Invitation/IncomingInvitation";
import { InvitationEvent } from "../../../../logic/Calendar/Invitation/InvitationEvent";
import { addEWSTimeProposal, checkTimeProposal } from "../../../../logic/Calendar/Invitation/TimeProposal";
import { ICalIncomingInvitation } from "../../../../logic/Calendar/ICal/ICalIncomingInvitation";
import { ICalEMailProcessor } from "../../../../logic/Calendar/ICal/ICalEMailProcessor";
import { getICal } from "../../../../logic/Calendar/ICal/ICalGenerator";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSCreateItemRequest } from "../../../../logic/Mail/EWS/Request/EWSCreateItemRequest";
import { OWACreateItemRequest } from "../../../../logic/Mail/OWA/Request/OWACreateItemRequest";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { describe, expect, test, vi } from "vitest";

const kStart = new Date("2026-11-10T10:00:00Z");
const kEnd = new Date("2026-11-10T11:00:00Z");
const kProposal = { start: new Date("2026-11-11T14:00:00Z"), end: new Date("2026-11-11T15:30:00Z") };

function meeting(calendar: Calendar, mine: InvitationResponse) {
  let event = calendar.newEvent();
  event.calUID = "uid-1";
  event.title = "Планёрка";
  event.startTime = new Date(kStart);
  event.endTime = new Date(kEnd);
  event.timezone = "UTC";
  event.participants.add(new Participant("boss@example.com", "Босс", InvitationResponse.Organizer));
  event.participants.add(new Participant("me@example.com", "Я", mine));
  event.myParticipation = mine;
  return event;
}

function mailAccount(): { account: EWSAccount, sent: EMail[] } {
  let account = new EWSAccount();
  account.emailAddress = "me@example.com";
  let identity = new MailIdentity(account);
  identity.emailAddress = "me@example.com";
  identity.realname = "Я";
  account.identities.add(identity);
  let sent = account.newFolder();
  sent.specialFolder = SpecialFolder.Sent;
  account.rootFolders.add(sent);
  let mails: EMail[] = [];
  account.send = vi.fn(async (email: EMail) => { mails.push(email); }) as any;
  return { account, sent: mails };
}

describe("проверка предложения", () => {
  test("неверное, конец раньше начала, то же время", () => {
    let event = meeting(new Calendar(), InvitationResponse.NoResponseReceived);
    expect(checkTimeProposal(kProposal, event)).toBeNull();
    expect(checkTimeProposal({ start: kEnd, end: kStart })).toBe("end-before-start");
    expect(checkTimeProposal({ start: kStart, end: kStart })).toBe("end-before-start");
    expect(checkTimeProposal({ start: kStart, end: kEnd }, event)).toBe("unchanged");
    expect(checkTimeProposal({ start: new Date("x"), end: kEnd })).toBe("invalid");
    expect(checkTimeProposal(null)).toBe("invalid");
  });
});

describe("EWS / OWA", () => {
  test("ProposedStart/ProposedEnd после ReferenceItemId, в UTC", () => {
    let request = new EWSCreateItemRequest({ MessageDisposition: "SendAndSaveCopy" });
    request.addField("TentativelyAcceptItem", "ReferenceItemId", { Id: "item-1" });
    addEWSTimeProposal(request, "TentativelyAcceptItem", kProposal);
    let xml = new DOMParser().parseFromString(new EWSAccount().request2XML(request as any), "text/xml");
    let item = xml.getElementsByTagName("t:TentativelyAcceptItem")[0];
    expect([...item.children].map(child => child.tagName)).toEqual(["t:ReferenceItemId", "t:ProposedStart", "t:ProposedEnd"]);
    expect(item.getElementsByTagName("t:ProposedStart")[0].textContent).toBe("2026-11-11T14:00:00.000Z");
    expect(item.getElementsByTagName("t:ProposedEnd")[0].textContent).toBe("2026-11-11T15:30:00.000Z");
  });

  test("OWA: те же поля в JSON", () => {
    let request = new OWACreateItemRequest({ MessageDisposition: "SendAndSaveCopy" });
    request.addField("DeclineItem", "ReferenceItemId", { __type: "ItemId:#Exchange", Id: "item-1" });
    addEWSTimeProposal(request, "DeclineItem", kProposal);
    expect(request.Body.Items[0]).toEqual({
      __type: "DeclineItem:#Exchange",
      ReferenceItemId: { __type: "ItemId:#Exchange", Id: "item-1" },
      ProposedStart: "2026-11-11T14:00:00.000Z",
      ProposedEnd: "2026-11-11T15:30:00.000Z",
    });
  });
});

describe("iCal COUNTER (RFC 5546 3.2.7)", () => {
  test("участник отправляет COUNTER с новым временем; своё время встречи не меняется", async () => {
    let { account, sent } = mailAccount();
    let event = meeting(new Calendar(), InvitationResponse.NoResponseReceived);
    await ICalIncomingInvitation.proposeNewTimeFromCalEvent(event, InvitationResponse.Tentative, kProposal, account);
    expect(sent).toHaveLength(1);
    let mail = sent[0];
    expect(mail.iCalMethod).toBe("COUNTER");
    expect(mail.to.first.emailAddress).toBe("boss@example.com");
    expect(mail.subject).toBe("New time proposed: Планёрка");
    expect(mail.event.startTime.toISOString()).toBe(kProposal.start.toISOString());
    expect(mail.event.endTime.toISOString()).toBe(kProposal.end.toISOString());
    expect(event.startTime.toISOString()).toBe(kStart.toISOString());
    expect(event.myParticipation).toBe(InvitationResponse.Tentative);
    let ics = await getICal(mail.event, mail.iCalMethod);
    expect(ics).toContain("METHOD:COUNTER");
    expect(ics).toContain("ORGANIZER:MAILTO:boss@example.com");
    expect(ics).toContain("DTSTART;VALUE=DATE-TIME:20261111T140000Z");
    expect(ics).toMatch(/ATTENDEE;PARTSTAT=TENTATIVE;CN=Я:MAILTO:me@example.com/);
  });

  test("ответ без предложения остаётся REPLY", async () => {
    let { account, sent } = mailAccount();
    let event = meeting(new Calendar(), InvitationResponse.NoResponseReceived);
    event.startTime = new Date(Date.now() + 86_400_000);
    event.endTime = new Date(Date.now() + 90_000_000);
    await ICalIncomingInvitation.respondToInvitationFromCalEvent(event, InvitationResponse.Accept, account);
    expect(sent[0].iCalMethod).toBe("REPLY");
    expect(sent[0].event.participants.length).toBe(1);
  });

  test("письмо с METHOD:COUNTER — предложение нового времени", async () => {
    let { account } = mailAccount();
    let ics = [
      "BEGIN:VCALENDAR", "METHOD:COUNTER", "VERSION:2.0", "BEGIN:VEVENT", "UID:uid-1", "SUMMARY:Планёрка",
      "DTSTART:20261111T140000Z", "DTEND:20261111T153000Z", "ORGANIZER:MAILTO:boss@example.com",
      "ATTENDEE;PARTSTAT=TENTATIVE;CN=Анна:MAILTO:anna@example.com", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    let email = account.rootFolders.first.newEMail();
    let attachment = email.newAttachment();
    attachment.mimeType = "text/calendar";
    attachment.content = new File([ics], "invite.ics", { type: "text/calendar" });
    email.attachments.add(attachment);
    await new ICalEMailProcessor().process(email);
    expect(email.invitationMessage).toBe(InvitationMessage.CounterProposal);
    expect(email.event.startTime.toISOString()).toBe("2026-11-11T14:00:00.000Z");
  });
});

describe("организатор принимает предложенное время", () => {
  function counter(calendar: Calendar) {
    let message = { invitationMessage: InvitationMessage.CounterProposal, folder: { account: { isMyEMailAddress: () => true } } } as any;
    let proposed = new InvitationEvent();
    proposed.calUID = "uid-1";
    proposed.startTime = new Date(kProposal.start);
    proposed.endTime = new Date(kProposal.end);
    message.event = proposed;
    return new IncomingInvitation(calendar, message);
  }

  test("время встречи меняется и сохраняется (участникам уходит обновление)", async () => {
    let calendar = new Calendar();
    let event = meeting(calendar, InvitationResponse.Organizer);
    event.save = vi.fn(async () => {}) as any;
    calendar.events.add(event);
    await counter(calendar).acceptProposedTime();
    expect(event.startTime.toISOString()).toBe(kProposal.start.toISOString());
    expect(event.endTime.toISOString()).toBe(kProposal.end.toISOString());
    expect(event.save).toHaveBeenCalledTimes(1);
  });

  test("встречи нет в календаре — понятная ошибка", async () => {
    await expect(counter(new Calendar()).acceptProposedTime()).rejects.toThrow("The meeting was not found in your calendar");
  });

  test("не предложение — отказ", async () => {
    let calendar = new Calendar();
    let invitation = counter(calendar);
    (invitation as any).invitationMessage = InvitationMessage.ParticipantReply;
    await expect(invitation.acceptProposedTime()).rejects.toThrow();
  });
});

test("app загружен", () => {
  expect(appGlobal).toBeTruthy();
});
