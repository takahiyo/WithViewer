import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();
export function accessSettings(env) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.CF_ACCESS_TEAM_DOMAIN || '') ||
      !/^[a-f0-9]{64}$/.test(env.CF_ACCESS_AUD || '') ||
      typeof env.ALLOWED_EMAIL !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ALLOWED_EMAIL) ||
      typeof env.PUBLIC_ORIGIN !== 'string') return null;
  try {
    const origin = new URL(env.PUBLIC_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.PUBLIC_ORIGIN) return null;
  } catch { return null; }
  return { issuer: env.CF_ACCESS_TEAM_DOMAIN, audience: env.CF_ACCESS_AUD, email: env.ALLOWED_EMAIL.toLowerCase() };
}

export async function verifyAccess(request, env, resolveKeys) {
  const settings = accessSettings(env);
  if (!settings) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) return false;
  try {
    let keys = resolveKeys;
    if (!keys) {
      if (!keySets.has(settings.issuer)) keySets.set(settings.issuer, createRemoteJWKSet(new URL(`${settings.issuer}/cdn-cgi/access/certs`)));
      keys = keySets.get(settings.issuer);
    }
    const { payload } = await jwtVerify(token, keys, { issuer: settings.issuer, audience: settings.audience,
      algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email', 'sub'], clockTolerance: 5 });
    return typeof payload.email === 'string' && payload.email.toLowerCase() === settings.email;
  } catch { return false; }
}
