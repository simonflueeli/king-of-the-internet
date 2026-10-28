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
