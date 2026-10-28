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
const ui = {
  switchAria: "Choose a throne",
  loading: "Loading the throne…",

  // Hero
  vacantReignLine: "The first person to pay {price} takes it.",
  proclamationHidden: "This proclamation is hidden while it’s reviewed.",
  liveCrowned: "Long live {title} {name}. A new king has taken the {throneLabel}.",
  liveVacant: "The {throneLabel} is vacant.",

  // Report form (FR-07)
  reportLink: "Report",
  reportHeading: "Report this king",
  reportIntro: "Tell us what’s wrong with {name}’s name or proclamation. A moderator will review it.",
  reportReasonLegend: "Reason",
  reportReasons: {
    offensive: "Offensive",
    impersonation: "Impersonation",
    spam: "Spam or advertising",
    other: "Something else",
  },
  reportDetails: "Details (optional)",
  reportSubmit: "Send report",
  reportSending: "Sending…",
  reportCancel: "Cancel",
  reportClose: "Close",
  reportThanks: "Thanks. A moderator will look at it.",
  reportRateLimited: "You’ve sent a lot of reports. Try again later.",

  // Call to action
  pitchHigher: "{name} is only {article} {current}. You’d be crowned {next}.",
  pitchTitle: "You’ll be crowned {title} of the {throneName}.",
  metaNext: "If you pay the minimum, the next challenger pays {price}.",
  metaDecayRule: "If no one takes it for 24 hours, the price falls {pct}% a day.",
  metaDecayed: "Untouched for {days} {dayWord}, so the price has fallen {pct}%.",
  metaDaily: "Resets to {base} at midnight UTC, in {duration}.",
  day: "day",
  days: "days",
  tryOnPlaceholder: "Type your name",
  errBanned: "You can’t take the throne. If you think this is a mistake, contact us.",

  // Live signals (FR-30…32)
  liveSignals: "Live signals",
  watching: "{n} people watching right now",
  lastTakeover: "Last takeover {ago}",
  recordReign: "Record reign {duration} by {name}",

  // Price ladder (FR-40…43)
  ladderHeading: "The price only goes up",
  ladderLeadEternal: "Every takeover adds at least {pct}%. The crown started at {base} and costs {price} now.",
  ladderLeadDaily:
    "Every takeover adds at least {pct}% until midnight UTC. Today’s crown started at {base} and costs {price} now.",
  ladderReach2: " Even at the minimum, it reaches {a} by takeover #{m} and {b} by #{n}.",
  ladderReach1: " Even at the minimum, it reaches {b} by takeover #{n}.",
  ladderTail: " The earlier you rule, the cheaper the crown.",
  chartTakeover: "Takeover #{n}",
  chartHere: "You are here",
  chartStart: "Start",
  titleFrom: "from {price}",
  titlesNote: "Your title depends on what you pay. Right now the throne makes you {article} {title}.",

  // Hall of kings (FR-50…52)
  hallHeading: "Hall of kings",
  hallSummary: "{count} {kingWord} paid {total} for this throne.",
  hallSummaryDaily: "Today, {count} {kingWord} paid {total} for this throne.",
  kingHas: "king has",
  kingsHave: "kings have",
  hallEmpty: "No one has ruled yet. The first king pays {base}.",
  hallEmptyDaily: "No one has ruled today. The first king pays {base}.",
  recordLongest: "Longest reign",
  recordLongestDaily: "Longest reign today",
  recordHighest: "Highest price paid",
  recordHighestDaily: "Highest price today",
  recentHeading: "Recent rulers",
  rowReigning: "Reigning now, {duration} so far",
  rowRuled: "Ruled for {duration}",
  rowRemoved: "Removed after {duration}",

  // How it works (FR-60)
  howHeading: "How it works",
  how: [
    "Taking the throne costs at least 10% more than the last person paid, and you can always pay more. The more you pay, the grander your title, from Lord all the way to Emperor, and the more it costs to overthrow you. The king gets nothing back except the glory.",
    "The daily throne resets to €2 every midnight UTC. The eternal throne never resets, but if no one takes it for 24 hours, its price falls 2% a day.",
    "You pay by card. Your card is only charged if you actually take the throne: if someone beats you to it, the payment is cancelled. When someone takes your seat, you get an email inviting you to win it back.",
  ],

  // Footer (FR-61)
  footerNav: "Legal",
  footerLinks: {
    terms: "Terms",
    privacy: "Privacy",
    imprint: "Imprint",
    contact: "Contact",
    refunds: "Refund policy",
  },
  footerNote: "Buying the throne buys display time, not a prize. Kings never receive money.",

  // Checkout
  coKicker: "You’ll be crowned",
  coYou: "You",
  coPrice: "Your price",
  coQuickPrices: "Quick prices",
  chipMinimum: "Minimum",
  chipBecome: "Become {title}",
  chipTimes: "×{n}",
  helpMinimum: "That’s the minimum.",
  helpAbove: "{diff} above the minimum.",
  helpRank: " You’ll rank as {a1} {title} instead of {a2} {minTitle}.",
  helpNext: " The next challenger pays {price}.",
  helpBelow: "The minimum is {min}.",
  helpAboveMax: "The most you can pay is {max}.",
  lockLine: "Your minimum of {price} is locked for {clock}.",
  coName: "Your name",
  coProclamation: "Your proclamation (optional)",
  coProclamationPlaceholder: "What should your subjects read?",
  coCount: "{n} / {max}",
  coEmail: "Email for your receipt",
  coAlert: "Email me if someone takes my throne",
  coTermsBefore: "I’m 18 or older. I’m buying display time, not a prize, and there’s no refund when I’m overthrown. I accept the ",
  coTermsLink: "Terms",
  coTermsAfter: ".",
  coPay: "Pay {price} and take the throne",
  coProcessing: "Processing payment…",
  coCancel: "Cancel",
  coClose: "Close",
  coPaymentLegend: "Payment",
  coPaymentLoading: "Loading secure payment form…",
  coPaymentUnavailable: "Card payments aren’t available right now. Try again in a few minutes.",
  errNameRequired: "Enter the name the throne should display.",
  errNameLong: "Names can be at most {max} characters.",
  errProclamationLong: "Proclamations can be at most {max} characters.",
  errEmail: "Enter a valid email address for your receipt.",
  errTerms: "Confirm that you’re 18 or older and accept the Terms.",
  errDeclinedFull: "Your card was declined. Try another card.",
  errCanceled: "Your payment was cancelled, so the throne wasn’t taken. You weren’t charged.",
  errModeration: "That can’t go on the throne. Change it and try again.",
  errLost: "Your price lock was lost. Open checkout again.",
  errNetwork: "We couldn’t reach the throne. Check your connection and try again.",

  // Test-card panel (fake payment mode)
  fakeBadge: "Test mode",
  fakeHeading: "Test payment",
  fakeIntro: "This server runs without real payments. No card is charged and no money moves.",
  fakeOutcome: "Test card result",
  fakeSucceed: "Succeed",
  fakeDecline: "Decline",

  // Coronation
  coronationKicker: "Long live",
  coronationPaid: "You paid {price} for the {throneLabel}. The next challenger pays {next}.",
  coronationBrag: "I just took The Throne and was crowned {title} {name} for {price}. Come and take it from me.",
  coronationShare: "Share",
  coronationCopy: "Copy link",
  coronationCopied: "Link copied",
  coronationCopyFailed: "Copying isn’t allowed here. Select the link above instead.",
  coronationShareTitle: "The Throne",
  waiting: "Crowning you…",
  waitingDetail: "Your card is authorized. We’re placing you on the throne.",
  failedHeading: "The throne wasn’t taken",
} as const;

/** S: safety, moderation and admin strings. */
const safety = {} as const;

/** G: growth, email, share and legal strings. */
const growth = {} as const;

export const copy = { ...shared, ui, safety, growth } as const;
export type Copy = typeof copy;
