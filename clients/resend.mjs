// Thin Resend REST client for transactional email (SOW-005 day-87 trial reminder, the PRIMARY
// channel). Injectable fetch so every call is fixture-testable, the same shape as the other
// clients. Resend wants a JSON body posted to https://api.resend.com/emails with a Bearer apiKey.
//
// Email is the primary day-87 reminder because Discord server-member DMs are widely disabled by
// default and would silently vanish (see membership-and-access.md section 0). The Discord DM stays
// as an optional secondary nudge.

export class ResendError extends Error {
  constructor(status, body) {
    super(`resend error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

export function createResendClient({ apiKey, fetch = globalThis.fetch, baseUrl = 'https://api.resend.com' }) {
  if (!apiKey) throw new Error('createResendClient: apiKey is required');

  async function req(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'gbti-network-controller',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new ResendError(res.status, text);
    return text ? JSON.parse(text) : {};
  }

  return {
    _req: req,

    /**
     * Send one email. `from` and `to` are required; `to` may be a string or an array of strings.
     * `html` is optional; at least one of `text` or `html` should be present.
     */
    sendEmail({ from, to, subject, text, html }) {
      return req('POST', '/emails', {
        from,
        to,
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
      });
    },
  };
}
