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
const safety = {
  // Moderation messages per category (PRD "Automatic checks"). Never show raw model text.
  moderation: {
    links: "Links and contact details aren’t allowed on the throne. Remove them and try again.",
    banned_term: "That can’t go on the throne. Change it and try again.",
    hate: "Hateful words and slurs aren’t allowed on the throne. Change it and try again.",
    harassment: "The throne isn’t for attacking or naming private people. Change it and try again.",
    sexual: "Sexual content isn’t allowed on the throne. Change it and try again.",
    violence: "Threats and violence aren’t allowed on the throne. Change it and try again.",
    self_harm:
      "That can’t go on the throne. If you’re going through a hard time, please reach out to someone you trust or a local helpline.",
    impersonation: "You can’t pose as a real public figure or brand on the throne. Choose another name.",
    spam: "Ads and promotions aren’t allowed on the throne. Change it and try again.",
    personal_data: "Personal details aren’t allowed on the throne. Remove them and try again.",
    other: "That can’t go on the throne. Change it and try again.",
    nameEmpty: "Enter a name for the throne.",
    nameTooLong: "Names can be at most {max} characters.",
    proclamationTooLong: "Proclamations can be at most {max} characters.",
    combiningMarks: "Too many accent marks on one letter. Simplify the text and try again.",
  },
  reports: {
    received: "Thanks. An admin will look at it.",
    rateLimited: "Too many reports. Try again in 10 minutes.",
    notFound: "That reign doesn’t exist.",
    invalid: "Choose a reason for the report.",
  },
  bannedBuyer: "You can’t buy the throne.",
  admin: {
    title: "Throne admin",
    signIn: "Sign in with a passkey",
    devLogin: "Development login",
    register: "Register a passkey",
    registerHint: "First time here? Register a passkey with your admin email and the bootstrap token.",
    notAdmin: "That email isn’t an admin.",
    badToken: "The bootstrap token is wrong.",
    signedOut: "Your admin session ended. Sign in again.",
    passkeyFailed: "The passkey check failed. Try again.",
    confirmRemove: "Remove {name} from the {throne}? The price stays where it is.",
    confirmRefund: "Refund {amount} to this buyer? If this is the current reign, the king is removed.",
    removalCategories: {
      hate: "Hate or slurs",
      harassment: "Harassment",
      sexual: "Sexual content",
      violence: "Violence or threats",
      self_harm: "Self-harm",
      impersonation: "Impersonation",
      spam: "Spam or ads",
      personal_data: "Personal data",
      legal: "Legal request",
      terms: "Other Terms violation",
      payment_issue: "Payment issue",
      other: "Other",
    },
  },
} as const;

/** G: growth, email, share and legal strings. */
const growth = {} as const;

/** C: core API messages (reservations, payments) beyond the shared failure messages above. */
const core = {
  errUnknownThrone: "There is no such throne.",
  errNotFound: "That reservation doesn’t exist.",
  errBadToken: "This checkout belongs to another browser. Open checkout again.",
  errBanned: "You can’t take the throne.",
  errPriceCap: "The throne has reached the maximum price.",
  errCompleted: "This reservation has already been paid.",
  errPaymentInProgress: "Your payment is already being processed.",
  errPaymentUnavailable: "Payments are unavailable right now. Try again in a few minutes. You weren’t charged.",
  errTerms: "Please accept the terms to continue.",
  errEmail: "Enter a valid email address.",
  errName: "Enter a name of 1 to {max} characters.",
  errProclamation: "The proclamation can have at most {max} characters.",
  errBadRequest: "The request is invalid.",
  errNotFakeMode: "Not found.",
  errUnauthorized: "Unauthorized.",
} as const;

export const copy = { ...shared, ui, safety, growth, core } as const;
export type Copy = typeof copy;
