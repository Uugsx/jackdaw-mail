# Jackdaw Mail product information for Lemon Squeezy

## Product summary

Jackdaw Mail is a desktop mail, calendar and contacts client for people and teams that work with Exchange/OWA, EWS, ActiveSync, IMAP/JMAP and CardDAV/CalDAV accounts. Its distinctive Pro feature is a local response-time workflow: it counts working minutes, shows an unanswered-message queue and builds reports that explain how quickly requests were answered.

The app is downloaded from GitHub Releases. Mail, calendars, contacts and local databases are kept on the customer’s computer and the customer’s own mail provider. The Jackdaw Mail license service is separate from the mail service and does not need message bodies, attachments, passwords or address books.

## What is sold

### Free Jackdaw Mail

- Desktop application for macOS and Windows.
- Mail, calendar and contacts for one connected mailbox.
- Local storage and direct connections to supported providers.
- No payment or manual fulfilment is required.

### Jackdaw Mail Pro

Jackdaw Mail Pro is a recurring digital software entitlement. It unlocks:

- interactive response-time reports;
- live unanswered-mail/SLA queue;
- working hours per weekday;
- working-minute timers and reminders;
- response reports and HTML export;
- formatted HTML signatures with links and images;
- multiple accounts and shared mailboxes where supported.

Public plans:

- **Monthly:** $9.99 per month;
- **Yearly:** $79.99 per year;
- **Trial:** 7 days, no card required, online validation required.

The plans are subscriptions, not custom development services. There is no manual customization or manual provisioning after purchase.

## Fulfilment flow

1. The customer selects a monthly or yearly variant in the hosted Lemon Squeezy checkout.
2. Lemon Squeezy processes the payment and automatically sends the license key/receipt to the purchase email.
3. The customer downloads the desktop installer from the public GitHub Releases page.
4. The customer enters the key in `Settings → Jackdaw Pro`.
5. The license service verifies the key, registers the device within the allowed activation limit and returns a signed entitlement.

The same flow works without a support agent or a custom order. If the payment provider or license service is temporarily unavailable, the customer can continue using the free mail features; Pro access is checked again when the service is available.

## How it is made and licensed

Jackdaw Mail is developed and maintained by Uugsx. The public repository contains Electron, Svelte and TypeScript desktop code and related mobile work. Parts of the repository are published under EUPL-1.2; proprietary modules and third-party dependencies remain governed by their applicable license terms. Pro is a paid entitlement to use the protected features; it is not a transfer of ownership of the source code or trademarks.

## Intended customers

Jackdaw Mail is for individual professionals, support teams and organizations that need a desktop mail workflow across Exchange/OWA or IMAP-compatible infrastructure and want a clear, local view of response time. It is not a physical product, a managed mailbox, a consulting service or a bespoke software-development service.

## Data and support

The product website and the public repository describe the data flow in detail. The license service stores only the hashes and technical metadata needed for activation, subscription state, trial enforcement and security. Lemon Squeezy remains the hosted payment provider and merchant of record for checkout transactions. Support is provided through the public GitHub issue tracker; customers should not post passwords, mail contents or license keys there.

See the public policies:

- <https://jackdaw-mail.pro/legal/terms.html>
- <https://jackdaw-mail.pro/legal/privacy.html>
