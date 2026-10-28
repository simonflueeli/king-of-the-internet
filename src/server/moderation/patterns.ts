// OWNER: S. Regular-expression checks for links, domains, email addresses and phone numbers
// (PRD "Automatic checks"). Runs on a compatibility-folded copy of the normalized text so full-width
// letters, look-alike digits and "dot"/"at" spellings are caught too.

// Common and frequently abused TLDs. A bare "word.tld" only counts as a domain for these, so names
// like "St.Louis" or "J.R.R. Tolkien" pass.
const TLDS = [
  "com", "net", "org", "info", "biz", "io", "co", "ai", "app", "dev", "me", "tv", "gg", "ly", "to", "sh",
  "xyz", "online", "site", "store", "shop", "link", "click", "top", "club", "live", "fun", "vip", "pro",
  "eu", "us", "uk", "de", "ch", "at", "fr", "it", "es", "nl", "be", "pl", "ru", "su", "ua", "cn", "jp",
  "kr", "in", "br", "ca", "au", "nz", "se", "no", "dk", "fi", "cz", "pt", "tk", "ml", "ga", "cf", "gq",
  "ws", "cc", "onion", "lol", "wtf", "xxx", "porn", "sex", "bet", "casino", "money", "crypto", "nft",
  "eth", "sol", "gl", "page", "blog", "news", "fm", "am", "cam", "chat", "social", "email", "tech",
].join("|");

// No space after a literal "." so a sentence break like "Hail the king. Me first" is not a domain.
const DOT = String.raw`(?:\s?\.(?=[a-z])|\s?[\[(]\s?(?:\.|dot)\s?[\])]\s?|\s+dot\s+)`;
const AT = String.raw`(?:\s?@\s?|\s?[\[(]\s?at\s?[\])]\s?|\s+at\s+)`;

const CONTACT_PATTERNS: { kind: "url" | "domain" | "email" | "phone"; re: RegExp }[] = [
  { kind: "url", re: /\b(?:https?|ftp|hxxps?)\s?:\s?\/\/|\bwww\s?\.\s?[a-z0-9]/u },
  { kind: "url", re: /\b(?:t\.me|wa\.me|discord\.gg|bit\.ly)\b/u },
  { kind: "email", re: new RegExp(String.raw`[\p{L}\p{N}._%+-]+${AT}[\p{L}\p{N}-]+(?:${DOT}[\p{L}\p{N}-]+)*${DOT}[a-z]{2,}\b`, "u") },
  // "example.com", "example . com" before a non-letter, "example dot com", "example(dot)com"
  { kind: "domain", re: new RegExp(String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62})${DOT}(?:${TLDS})(?![\p{L}\p{N}])`, "u") },
  // Phone numbers: 9+ digits with common separators, or 7+ after an international prefix.
  { kind: "phone", re: /(?:\+|\b00)\s?\p{Nd}(?:[\s().\/-]{0,3}\p{Nd}){6,}/u },
  { kind: "phone", re: /\p{Nd}(?:[\s().\/-]{0,3}\p{Nd}){8,}/u },
];

// Cyrillic/Greek letters that look like Latin ones, folded before pattern and term checks.
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", ԛ: "q", ԝ: "w", ɡ: "g",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu");

/** NFKC + lowercase + strip combining marks + fold Cyrillic/Greek look-alikes. */
export function foldForChecks(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c)
    .replace(/[。．｡]/g, "."); // ideographic / full-width full stops
}

/** First contact-detail pattern found in `text`, or null. */
export function findContactDetails(text: string): "url" | "domain" | "email" | "phone" | null {
  const folded = foldForChecks(text);
  for (const { kind, re } of CONTACT_PATTERNS) if (re.test(folded)) return kind;
  return null;
}
