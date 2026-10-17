/**
 * Обратное подтверждение адреса для звонков и чата Jackdaw.
 *
 * Когда письмо с кодом не доходит (корпоративная почта режет письма с
 * незнакомых доменов), приложение само отправляет короткое письмо с ящика
 * пользователя на одноразовый адрес сервиса. Сервис проверяет подпись DKIM
 * или SPF домена отправителя и подтверждает адрес.
 */
import type { MailAccount } from "../../Mail/MailAccount";
import { PersonUID } from "../../Abstract/PersonUID";
import { appGlobal } from "../../app";
import { normalizeCallEmail } from "./JackdawCallProtocol";
import { gt } from "../../../l10n/l10n";

export interface ReverseVerificationRequest {
  token: string;
  address: string;
  mailSubject: string;
  expiresIn: number;
}

/** Почтовый аккаунт в приложении, с которого можно отправить письмо от этого адреса */
export function mailAccountForAddress(emailAddress: string): MailAccount | null {
  let email = normalizeCallEmail(emailAddress);
  if (!email) return null;
  return appGlobal.emailAccounts.find(account => account.isMyEMailAddress(email)) ?? null;
}

export function reverseVerificationText(): string {
  return gt`This message confirms that this email address belongs to me, for calls and chat in Jackdaw Mail. It was sent automatically by the Jackdaw Mail app.`;
}

/** Отправляет письмо подтверждения от адреса `fromEmail` через аккаунт пользователя. */
export async function sendReverseVerificationMail(account: MailAccount, fromEmail: string, request: ReverseVerificationRequest): Promise<void> {
  let mail = account.newEMailFrom();
  mail.identity = account.findIdentityForEMailAddress(fromEmail) ?? mail.identity;
  mail.from.emailAddress = fromEmail;
  mail.to.add(new PersonUID(request.address, "Jackdaw Mail"));
  mail.subject = request.mailSubject;
  mail.text = reverseVerificationText();
  await account.send(mail);
}
