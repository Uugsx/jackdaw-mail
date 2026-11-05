import { MailAccount } from "../../../logic/Mail/MailAccount";
import { appGlobal } from "../../../logic/app";
import {
  canUseExchangeNotes, createNote, deleteNote, fetchNotes, noteProtocolFor, updateNote, type ExchangeNote,
} from "../../../logic/Mail/Notes/ExchangeNotes";
import { tasksViewOpen } from "../Tasks/tasksStore";
import { get, writable } from "svelte/store";

/** Страница «Заметки» вместо списка писем */
export const notesViewOpen = writable(false);

// Заметки и задачи открываются на одном месте: одно закрывает другое
notesViewOpen.subscribe(open => {
  if (open && get(tasksViewOpen)) {
    tasksViewOpen.set(false);
  }
});
tasksViewOpen.subscribe(open => {
  if (open && get(notesViewOpen)) {
    notesViewOpen.set(false);
  }
});

export interface NoteItem {
  account: MailAccount;
  note: ExchangeNote;
}

export interface NotesState {
  items: NoteItem[];
  loading: boolean;
  /** Ошибки по ящикам: один недоступный ящик не прячет заметки остальных */
  errors: string[];
}

export const notesState = writable<NotesState>({ items: [], loading: false, errors: [] });

export function noteAccounts(): MailAccount[] {
  return appGlobal.emailAccounts.contents
    .filter((account): account is MailAccount => account instanceof MailAccount && canUseExchangeNotes(account));
}

function sortItems(items: NoteItem[]): NoteItem[] {
  return [...items].sort((a, b) => (b.note.lastModified?.getTime() ?? 0) - (a.note.lastModified?.getTime() ?? 0));
}

export async function refreshNotes(): Promise<void> {
  notesState.update(state => ({ ...state, loading: true, errors: [] }));
  let items: NoteItem[] = [];
  let errors: string[] = [];
  await Promise.all(noteAccounts().map(async account => {
    try {
      let notes = await fetchNotes(noteProtocolFor(account));
      items.push(...notes.map(note => ({ account, note })));
    } catch (ex) {
      errors.push(`${account.name}: ${ex?.message ?? ex}`);
    }
  }));
  notesState.set({ items: sortItems(items), loading: false, errors });
}

export async function addNote(account: MailAccount, text: string): Promise<NoteItem> {
  let note = await createNote(noteProtocolFor(account), text);
  let item = { account, note };
  notesState.update(state => ({ ...state, items: sortItems([item, ...state.items]) }));
  return item;
}

export async function saveNote(item: NoteItem, text: string): Promise<NoteItem> {
  let note = await updateNote(noteProtocolFor(item.account), item.note, text);
  let saved = { account: item.account, note };
  notesState.update(state => ({
    ...state,
    items: sortItems(state.items.map(other => other.note.itemID == item.note.itemID ? saved : other)),
  }));
  return saved;
}

export async function removeNote(item: NoteItem): Promise<void> {
  await deleteNote(noteProtocolFor(item.account), item.note);
  notesState.update(state => ({ ...state, items: state.items.filter(other => other.note.itemID != item.note.itemID) }));
}
