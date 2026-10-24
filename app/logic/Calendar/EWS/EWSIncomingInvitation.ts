import { IncomingInvitation } from "../Invitation/IncomingInvitation";
import { InvitationMessage, InvitationResponse, type InvitationResponseInMessage } from "../Invitation/InvitationStatus";
import type { EWSCalendar } from "./EWSCalendar";
import type { EWSEMail } from "../../Mail/EWS/EWSEMail";
import { EWSCreateItemRequest } from "../../Mail/EWS/Request/EWSCreateItemRequest";
import { assert } from "../../util/util";
import { addEWSTimeProposal, checkTimeProposal, type ProposalResponse, type TimeProposal } from "../Invitation/TimeProposal";

const ResponseTypes: Record<InvitationResponseInMessage, string> = {
  [InvitationResponse.Accept]: "AcceptItem",
  [InvitationResponse.Tentative]: "TentativelyAcceptItem",
  [InvitationResponse.Decline]: "DeclineItem",
};

export class EWSIncomingInvitation extends IncomingInvitation {
  declare readonly calendar: EWSCalendar;
  declare readonly message: EWSEMail;

  async respondToInvitationFromMail(response: InvitationResponseInMessage, proposal?: TimeProposal) {
    assert(this.invitationMessage == InvitationMessage.Invitation, "Only invitations can be responded to");
    let request = new EWSCreateItemRequest({MessageDisposition: "SendAndSaveCopy"});
    request.addField(ResponseTypes[response], "ReferenceItemId", { Id: this.message.itemID });
    if (proposal) {
      addEWSTimeProposal(request, ResponseTypes[response], proposal);
    }
    await this.calendar.account.callEWS(request);
    await this.message.deleteMessageLocally(); // Exchange deletes the message from the inbox
    await this.calendar.listEvents(); // Exchange will have created a calendar item if there wasn't one already
  }

  async proposeNewTimeFromMail(response: ProposalResponse, proposal: TimeProposal) {
    assert(!checkTimeProposal(proposal), "Invalid time proposal");
    await this.respondToInvitationFromMail(response, proposal);
  }

  async updateCancelled() {
    await this.updateFromOtherInvitationMessage();
  }
  async updateParticipantReply() {
    await this.updateFromOtherInvitationMessage();
  }
  /** Exchange server auto-processes these */
  async updateFromOtherInvitationMessage() {
    await this.calendar.listEvents();
  }
}
