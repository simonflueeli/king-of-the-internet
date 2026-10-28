// OWNER: S. Stub shipped by F: nobody is banned. S replaces the body with a lookup in `bans`
// (values hashed with hashBanValue from ./hash).

export async function checkBans(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  q: { email?: string; ipHash?: string; deviceId?: string; cardFingerprint?: string },
): Promise<{ banned: boolean; reason?: string }> {
  return { banned: false };
}
