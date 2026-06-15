// GitHub OAuth device flow (SOW-006). The client has NO embedded secret: it uses the device flow, where
// the user is shown a short code to enter at github.com/login/device, and we poll until GitHub returns a
// token. That token is then used for local git push + PR create/update via the GitHub API, and by the MCP
// server. Pure transport with an injectable fetch + sleep so the polling loop is unit-testable.

const GITHUB = 'https://github.com';

const FORM = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };

/** Step 1: request a device + user code. Returns GitHub's { device_code, user_code, verification_uri, interval, expires_in }. */
export async function requestDeviceCode({ clientId, scope = 'public_repo read:user', fetch = globalThis.fetch }) {
  if (!clientId) throw new Error('requestDeviceCode: clientId is required');
  const res = await fetch(`${GITHUB}/login/device/code`, {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ client_id: clientId, scope }).toString(),
  });
  if (!res.ok) throw new Error(`device code request failed: ${res.status}`);
  return res.json();
}

/** Step 2 (single poll): exchange the device code. Returns { access_token, ... } or { error: ... }. */
export async function pollForToken({ clientId, deviceCode, fetch = globalThis.fetch }) {
  const res = await fetch(`${GITHUB}/login/oauth/access_token`, {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }).toString(),
  });
  return res.json();
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Drive the full device-flow login: request a code, surface it via onPrompt, then poll until GitHub
 * returns a token, the user denies, or the code expires. Honors GitHub's `interval` and `slow_down`.
 *
 * @returns {Promise<{accessToken:string, scope?:string}>}
 * @throws on denial ('access_denied'), expiry ('expired_token' / deadline), or an unexpected error.
 */
export async function deviceFlowLogin({
  clientId,
  scope,
  fetch = globalThis.fetch,
  onPrompt,
  sleep = defaultSleep,
  now = () => Date.now(),
}) {
  const dc = await requestDeviceCode({ clientId, scope, fetch });
  if (typeof onPrompt === 'function') {
    onPrompt({ userCode: dc.user_code, verificationUri: dc.verification_uri, expiresIn: dc.expires_in });
  }

  let interval = (Number(dc.interval) || 5) * 1000;
  const deadline = now() + (Number(dc.expires_in) || 900) * 1000;

  for (;;) {
    if (now() >= deadline) throw new Error('device flow expired before authorization');
    await sleep(interval);
    const r = await pollForToken({ clientId, deviceCode: dc.device_code, fetch });
    if (r.access_token) return { accessToken: r.access_token, scope: r.scope };
    switch (r.error) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        interval += 5000;
        break;
      case 'expired_token':
        throw new Error('device flow expired before authorization');
      case 'access_denied':
        throw new Error('device flow denied by the user');
      default:
        throw new Error(`device flow error: ${r.error ?? 'unknown'}`);
    }
  }
}
