import { mount, unmount } from "svelte";
import OtherFromDialog from "./OtherFromDialog.svelte";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
export { checkOtherFromAddress } from "../../../logic/Mail/SendAs/SendAs";

/** Спрашивает адрес чужого ящика (Outlook «От → Другой адрес»). null — отменили. */
export function askOtherFromAddress(account: MailAccount): Promise<string | null> {
  return new Promise(resolve => {
    let target = document.createElement("div");
    document.body.append(target);
    let instance: ReturnType<typeof mount> | null = null;
    let done = (address: string | null) => {
      if (instance) {
        void unmount(instance);
        instance = null;
      }
      target.remove();
      resolve(address);
    };
    instance = mount(OtherFromDialog, {
      target,
      props: { account, onDone: done },
    });
  });
}
