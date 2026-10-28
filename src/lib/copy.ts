// OWNER: F (structure + shared strings). All UI strings live here (PRD "Localization").
// U, S and G append their own keys inside their own section objects below — do not edit another
// workstream's section. Placeholders use {name}; fill them with fill().

/** Replace {key} placeholders: fill("Reigning for {duration}", { duration: "41s" }). */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Shared strings from the PRD "Copy deck" and core mechanics (F). */
const shared = {
  brand: "The Throne",
  throneName: { eternal: "Eternal Throne", daily: "Daily Throne" },
  throneLabel: { eternal: "eternal throne", daily: "daily throne" },
  switchLabel: { eternal: "Eternal throne", daily: "Daily throne" },

  // Copy deck
  greetingReigning: "Long live",
  greetingTryOn: "Picture this",
  tryOnLabel: "See your name on the throne",
  reignLine: "Reigning for {duration}",
  lockedNotice: "Someone is paying for this throne right now. Their price is locked for {clock}.",
  extraPayHint:
    "Pay more than the minimum at checkout to get a grander title and make the throne pricier for the next challenger.",
  checkoutHeading: "Take the {throneLabel}",
  coronation: "Long live {title} {name}",
  overthrowSubject: "You’ve been overthrown",
  overthrowButton: "Reclaim my throne",

  // Hero
  titlePlate: "{title} of the {throneName}",
  hallName: "{title} {name}",
  vacantName: "Vacant",
  vacantNever: "No one has ruled yet",
  vacantRemoved: "The last king was removed",
  vacantReset: "A new day has begun",
  yesterdayRuler: "Yesterday’s ruler: {name}",
  thatsYou: "That’s you.",
  previewBadge: "Preview",
  tryOnSeat: "This seat is yours for {price}.",

  // Call to action (FR-10, first match wins)
  ctaSelf: "Crown yourself again for {price}",
  ctaTryOn: "Take the throne as {name} for {price}",
  ctaOverthrow: "Overthrow {name} for {price}",
  ctaVacant: "Claim the empty throne for {price}",

  // Failure messages (PRD "Failure handling")
  errBusy: "Someone else is paying for this throne right now. Try again in a moment.",
  errExpired: "Your price lock ran out. Open checkout again to get the current price.",
  errAmount: "Enter a price between {min} and {max}.",
  errModerationUnavailable: "We can’t check names right now. Try again in a few minutes.",
  errDeclined: "Try another card.",
  errOutbid: "Your card wasn’t charged. Someone else took the throne first.",
  errCaptureFailed: "Your payment didn’t go through, so the throne wasn’t taken. You weren’t charged.",
  errRateLimited: "Too many attempts. Try again in 10 minutes.",
  errGeneric: "Something went wrong. Try again.",
} as const;

/** U: public UI strings. */
const ui = {} as const;

/** S: safety, moderation and admin strings. */
const safety = {} as const;

/** G: growth, email, share and legal strings. */
const growth = {
  // Emails (PRD "Notifications and sharing"). Subjects never contain user text.
  emailFooter: "You’re getting this email because you bought display time on The Throne.",
  emailSupport: "Questions? Write to {email}.",
  receiptSubject: "Your receipt: long live {title} {name}",
  receiptHeading: "Long live {title} {name}",
  receiptIntro: "You took the {throneLabel}. Here is your receipt.",
  receiptRows: {
    throne: "Throne",
    title: "Title",
    name: "Name",
    amount: "Amount paid",
    date: "Date and time",
    reference: "Reference",
  },
  // Placeholder until VAT setup is decided (PRD "Legal and compliance": VAT on digital services).
  receiptVatLine: "Price includes VAT where applicable.",
  receiptReignLink: "See your reign",
  receiptOutro: "You’re displayed until someone pays at least 10% more. There’s no refund when you’re overthrown.",
  overthrowBody: "{title} {name} just took your seat on the {throneLabel}. Win it back for {price} before they get comfortable.",
  overthrowPriceNote: "The price on the throne is always the live minimum, which may have changed since this email was sent.",
  overthrowUnsubscribe: "Stop overthrow emails",
  overthrowFooter: "You’re getting this because you asked to be told when someone takes your seat.",
  removalSubject: "Your reign has ended",
  removalBody:
    "Your reign as {title} {name} on the {throneLabel} was ended under our Terms. Reason: {reason}.",
  removalOutro: "If you think this was a mistake, reply to this email or contact us.",
  refundSubject: "Your refund is on its way",
  refundBody: "We’ve refunded {amount} for your reign as {title} {name} on the {throneLabel}.",
  refundTiming: "Refunds usually appear on your statement within 5–10 business days.",
  termsLink: "Terms",
  contactLink: "Contact",

  // Unsubscribe page
  unsubscribeTitle: "You’re unsubscribed",
  unsubscribeBody: "We won’t email you when someone takes your seat, on any throne. Receipts still arrive when you buy.",
  unsubscribeInvalidTitle: "This link doesn’t work",
  unsubscribeInvalidBody: "The unsubscribe link is invalid or has expired. Contact us and we’ll remove you by hand.",
  backToThrone: "Back to the throne",

  // Share pages (FR-70, FR-73)
  shareReigningNow: "Reigning now",
  shareRuledFor: "Ruled for {duration}",
  sharePaid: "Paid {amount} for the {throneLabel}",
  shareCrowned: "Crowned {ago}",
  shareCtaLive: "Overthrow {name}",
  shareCtaEnded: "See the {throneLabel}",
  shareHiddenTitle: "This reign is no longer shown",
  shareHiddenBody: "It was removed from the throne. The throne itself is still up for grabs.",
  shareHiddenCta: "Go to the throne",
  shareButton: "Share this reign",
  shareCopied: "Link copied",
  shareMetaTitle: "{title} {name} on the {throneName}",
  shareMetaDescription: "{title} {name} paid {amount} for the {throneName}. Come and take it from them.",
  shareMetaHiddenDescription: "Put your name on the throne until someone pays at least 10% more.",

  // OG images
  ogLongLive: "Long live",
  ogVacant: "The throne is empty",
  ogClaimFor: "Claim it for {price}",
  ogTakeFor: "Overthrow for {price}",
  ogHidden: "Who will take the throne?",

  // Legal pages
  legalNav: {
    terms: "Terms",
    privacy: "Privacy",
    imprint: "Imprint",
    contact: "Contact",
    refunds: "Refund policy",
  },
  legalDraftNotice:
    "Draft. This page is a placeholder until the operator’s lawyer supplies the final text. Items marked [TO BE SUPPLIED BY LEGAL] are missing.",
} as const;

export const copy = { ...shared, ui, safety, growth } as const;
export type Copy = typeof copy;
