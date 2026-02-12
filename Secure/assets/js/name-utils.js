export function deriveNameFromEmail(email, fallback = 'Member') {
  const localRaw = String(email || '').split('@')[0] || '';
  const local = localRaw.split('+')[0].trim();
  if (!local) return fallback;

  const letters = local.match(/[A-Za-z]+/g);
  if (letters && letters.length) {
    const merged = letters.join(' ').trim();
    if (merged) return merged;
  }

  const cleaned = local.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  return cleaned || fallback;
}

export function resolveUserDisplayName(user, fallback = 'Member') {
  const profileName = String(user?.displayName || '').trim();
  if (profileName) return profileName;
  return deriveNameFromEmail(user?.email, fallback);
}
