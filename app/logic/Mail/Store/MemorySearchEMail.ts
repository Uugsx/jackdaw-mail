import { SearchEMail } from "./SearchEMail";
import type { EMail } from "../EMail";
import { appGlobal } from "../../app";
import { ArrayColl } from "svelte-collections";

/**
 * Поиск по письмам, уже загруженным в память, во всех папках ящика.
 * Только для демо-режима: демо-ящики не хранятся в базе, и поиск через SQL
 * в них ничего не находит.
 */
export class MemorySearchEMail extends SearchEMail {
  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let found: EMail[] = [];
    let accounts = this.folder ? [this.folder.account] : this.account ? [this.account] : appGlobal.emailAccounts.contents;
    for (let account of accounts) {
      for (let folder of account.getAllFolders()) {
        for (let email of folder.messages.contents) {
          if (this.matches(email)) {
            found.push(email);
          }
        }
      }
    }
    found.sort((a, b) => (b.received?.getTime() ?? 0) - (a.received?.getTime() ?? 0));
    return new ArrayColl<EMail>(limit ? found.slice(0, limit) : found);
  }
}
