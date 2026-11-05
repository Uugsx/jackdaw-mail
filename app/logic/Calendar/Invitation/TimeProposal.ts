import { InvitationResponse, type InvitationResponseInMessage } from "./InvitationStatus";
import type { Event } from "../Event";

/** «Предложить другое время» (Outlook): новое время встречи от участника */
export interface TimeProposal {
  start: Date;
  end: Date;
}

/** С предложением Outlook отвечает «Под вопросом» или «Отклонить», но не «Принять» */
export type ProposalResponse = InvitationResponse.Tentative | InvitationResponse.Decline;
export const kProposalResponses: ProposalResponse[] = [InvitationResponse.Tentative, InvitationResponse.Decline];

export type TimeProposalProblem = "invalid" | "end-before-start" | "unchanged";

export function checkTimeProposal(proposal: TimeProposal | null | undefined, event?: Event | null): TimeProposalProblem | null {
  let start = proposal?.start?.getTime();
  let end = proposal?.end?.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "invalid";
  }
  if (end <= start) {
    return "end-before-start";
  }
  if (event?.startTime?.getTime() == start && event?.endTime?.getTime() == end) {
    return "unchanged";
  }
  return null;
}

/** Начальное значение в окне: то же время встречи */
export function defaultTimeProposal(event: Event): TimeProposal {
  return { start: new Date(event.startTime), end: new Date(event.endTime) };
}

export function isProposalResponse(response: InvitationResponseInMessage): response is ProposalResponse {
  return response == InvitationResponse.Tentative || response == InvitationResponse.Decline;
}

/** EWS `MeetingRegistrationResponseObjectType`: после `ReferenceItemId`, время в UTC */
export function addEWSTimeProposal(request: { addField(type: string, key: string, value: any): void }, type: string, proposal: TimeProposal) {
  request.addField(type, "ProposedStart", proposal.start.toISOString());
  request.addField(type, "ProposedEnd", proposal.end.toISOString());
}

/** Встреча после того, как организатор принял предложенное время: длительность — из предложения */
export function applyTimeProposal(event: Event, proposal: TimeProposal) {
  event.startTime = new Date(proposal.start);
  event.endTime = new Date(proposal.end);
}
