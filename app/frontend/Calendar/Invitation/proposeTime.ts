import { mount, unmount } from "svelte";
import ProposeTimeDialog from "./ProposeTimeDialog.svelte";
import type { Event } from "../../../logic/Calendar/Event";
import type { ProposalResponse, TimeProposal } from "../../../logic/Calendar/Invitation/TimeProposal";

/** Окно «Предложить другое время». null — отменили. */
export function askTimeProposal(event: Event, initialResponse?: ProposalResponse): Promise<{ response: ProposalResponse, proposal: TimeProposal } | null> {
  return new Promise(resolve => {
    let target = document.createElement("div");
    document.body.append(target);
    let instance: ReturnType<typeof mount> | null = null;
    let done = (result: { response: ProposalResponse, proposal: TimeProposal } | null) => {
      if (instance) {
        void unmount(instance);
        instance = null;
      }
      target.remove();
      resolve(result);
    };
    instance = mount(ProposeTimeDialog, {
      target,
      props: { event, initialResponse, onDone: done },
    });
  });
}
