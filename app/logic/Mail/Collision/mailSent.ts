/**
 * Событие «письмо отправлено» для тех, кому нужно знать об этом вне композера,
 * например чтобы коллеги по общему ящику увидели «Ответил».
 */
import type { EMail } from "../EMail";

type MailSentListener = (mail: EMail) => void;

const listeners = new Set<MailSentListener>();

/** @returns отписка */
export function onMailSent(listener: MailSentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Сбой получателя не мешает отправке и другим получателям */
export function notifyMailSent(mail: EMail): void {
  for (let listener of [...listeners]) {
    try {
      listener(mail);
    } catch (ex) {
      console.error(ex);
    }
  }
}
