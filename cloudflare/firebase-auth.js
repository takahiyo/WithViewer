import { importX509, jwtVerify } from 'jose';

let certificates, certificateExpiry = 0, loading;
export function publicFirebaseConfig(env) {
  try {
    const value = JSON.parse(env.FIREBASE_WEB_CONFIG || '{}');
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value.projectId || '') ||
        !/^[a-z0-9.-]+$/.test(value.authDomain || '') ||
        typeof value.apiKey !== 'string' || !value.apiKey || typeof value.appId !== 'string' || !value.appId) return null;
    return { projectId: value.projectId, apiKey: value.apiKey, authDomain: value.authDomain, appId: value.appId };
  } catch { return null; }
}

export function firebaseSettings(env) {
  const config = publicFirebaseConfig(env);
  if (!config || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ALLOWED_EMAIL || '')) return null;
  try {
    const origin = new URL(env.PUBLIC_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.PUBLIC_ORIGIN) return null;
  } catch { return null; }
  return { issuer: `https://securetoken.google.com/${config.projectId}`, audience: config.projectId,
    email: env.ALLOWED_EMAIL.toLowerCase() };
}

async function googleKey(header) {
  if (!certificates || certificateExpiry <= Date.now()) {
    loading ||= (async () => {
      const response = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
        { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Certificate fetch failed');
      const value = await response.json();
      const seconds = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 300);
      certificates = value; certificateExpiry = Date.now() + Math.min(seconds, 86400) * 1000;
    })();
    try { await loading; } finally { loading = null; }
  }
  if (!Object.hasOwn(certificates, header.kid || '')) throw new Error('Unknown key');
  return importX509(certificates[header.kid], 'RS256');
}

export async function verifyFirebase(request, env, resolveKeys = googleKey) {
  const settings = firebaseSettings(env);
  const authorization = request.headers.get('Authorization') || '';
  if (!settings || !authorization.startsWith('Bearer ') || authorization.length > 16384) return false;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), resolveKeys, { issuer: settings.issuer, audience: settings.audience,
      algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'auth_time', 'email', 'sub'], clockTolerance: 5 });
    const now = Date.now() / 1000;
    return typeof payload.sub === 'string' && payload.sub.length > 0 && payload.sub.length <= 128 &&
      Number.isFinite(payload.iat) && payload.iat <= now + 5 && Number.isFinite(payload.auth_time) && payload.auth_time <= now + 5 &&
      payload.email_verified === true && payload.firebase?.sign_in_provider === 'google.com' &&
      typeof payload.email === 'string' && payload.email.toLowerCase() === settings.email;
  } catch { return false; }
}
