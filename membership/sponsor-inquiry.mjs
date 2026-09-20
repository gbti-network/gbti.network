// sow-266 Phase 4: someone asking to sponsor the weekly digest. The pure half.
//
// WHAT THIS IS. A short form on a page nobody is meant to find by searching, and the record it becomes. It is a
// contact form, not a signup: nothing is enrolled, nothing is charged, and the whole point is that a person
// reads it and replies. So the OWNER EMAIL IS THE PRIMARY CHANNEL and the stored record is the backup, which is
// the opposite of the subscribe flow beside it, where the record is the product and the mail is a step.
//
// IT SELF-PRUNES. Each record carries a TTL rather than living until somebody sweeps it, because an inquiry
// that was answered four months ago is a stale contact detail sitting in a store, and no pruning job exists to
// notice. Ninety days is long enough to work a conversation and short enough that the store does not accrete.
//
// NO RAW ADDRESS EVER REACHES THE STORE. The address is encrypted under MAIL_EMAIL_KEY bound to its hash, the
// same envelope the subscriber records use. When those keys are not configured the record is still written and
// the address is simply LEFT OUT, marked so the read view can say so, rather than either losing the inquiry or
// storing a plaintext address as a convenience. The owner email still carries it.
//
// Node-free and pure: the Worker, the client and the tests all run this.

/** Long enough to work a conversation, short enough that the store does not accrete. */
export const INQUIRY_TTL_SECONDS = 90 * 24 * 60 * 60;

export const INQUIRY_PREFIX = 'sponsor:inquiry:';

/**
 * Field caps. These are BOUNDS ON A PUBLIC ENDPOINT, not editorial judgement: anything over them is somebody
 * using a contact form as storage. The message is generous on purpose, because a real sponsorship note explains
 * a product and a budget and being cut off mid-sentence reads as a broken form.
 */
export const INQUIRY_LIMITS = Object.freeze({
  name: 120,
  email: 254,
  organization: 160,
  website: 300,
  message: 2000,
});

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const trim = (v) => str(v).trim();

/** Collapse runs of whitespace and strip control characters. A form field is one line of text, not a document. */
const oneLine = (v) => trim(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');

/** A message may have paragraphs, so newlines survive; control characters and long runs of blank lines do not. */
const asMessage = (v) => trim(v)
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/\n{3,}/g, '\n\n');

/** The same address shape the subscribe route accepts, restated here so this module stays node-free and alone. */
export function isEmailShape(email) {
  const s = trim(email);
  if (s.length < 3 || s.length > INQUIRY_LIMITS.email) return false;
  if (/\s/.test(s)) return false;
  if (/[^\x21-\x7e]/.test(s)) return false;
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@')) return false;
  const domain = s.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;
  return true;
}

/** A website, if one was given. https or http only: a form field is not a place to accept a scheme we invent. */
export function isWebsiteShape(url) {
  const s = trim(url);
  if (!s) return true; // optional
  if (s.length > INQUIRY_LIMITS.website) return false;
  return /^https?:\/\/[^\s"'<>]+\.[^\s"'<>]+$/i.test(s);
}

/**
 * What is wrong with this inquiry, as sentences a person can act on. Empty means nothing is wrong.
 *
 * ONE PROBLEM PER FIELD AND ALL OF THEM AT ONCE, rather than the first one found: a form that reveals its
 * objections one submit at a time is how somebody gives up on the third try.
 */
export function inquiryProblems(input = {}) {
  const out = [];
  const name = oneLine(input.name);
  const email = trim(input.email);
  const org = oneLine(input.organization);
  const website = trim(input.website);
  const message = asMessage(input.message);

  if (!name) out.push('Please give a name we can reply to.');
  else if (name.length > INQUIRY_LIMITS.name) out.push(`The name is longer than ${INQUIRY_LIMITS.name} characters.`);

  if (!email) out.push('Please give an email address.');
  else if (!isEmailShape(email)) out.push('That does not look like an email address.');

  if (org.length > INQUIRY_LIMITS.organization) out.push(`The organisation is longer than ${INQUIRY_LIMITS.organization} characters.`);
  if (!isWebsiteShape(website)) out.push('The website should be a full address starting with https://.');

  if (!message) out.push('Please say what you would like to sponsor.');
  else if (message.length > INQUIRY_LIMITS.message) out.push(`The message is longer than ${INQUIRY_LIMITS.message} characters.`);
  return out;
}

/**
 * The stored record. `emailEnvelope` and `emailHash` come from the caller, which owns the keys; passing neither
 * writes a record with NO address, flagged, which is the configured-nothing path rather than a failure.
 *
 * THE RECORD NEVER HOLDS THE ADDRESS ITSELF. A test asserts that by serializing it and looking for an '@',
 * which is the same guard the subscriber and queue records carry, and it is the reason `emailDomain` is stored
 * separately: a superadmin scanning a list needs to tell a real company from a throwaway, and the domain alone
 * does that without the record holding a contactable address.
 */
export function buildInquiry(input = {}) {
  const at = input.at instanceof Date ? input.at : new Date(input.at ?? Date.now());
  const email = trim(input.email);
  const domain = isEmailShape(email) ? email.slice(email.indexOf('@') + 1).toLowerCase() : '';
  const envelope = input.emailEnvelope && typeof input.emailEnvelope === 'object' ? input.emailEnvelope : null;
  return {
    v: 1,
    id: oneLine(input.id),
    at: Number.isNaN(at.getTime()) ? new Date(0).toISOString() : at.toISOString(),
    name: oneLine(input.name).slice(0, INQUIRY_LIMITS.name),
    organization: oneLine(input.organization).slice(0, INQUIRY_LIMITS.organization),
    website: trim(input.website).slice(0, INQUIRY_LIMITS.website),
    message: asMessage(input.message).slice(0, INQUIRY_LIMITS.message),
    emailDomain: domain,
    emailHash: typeof input.emailHash === 'string' && /^[0-9a-f]{64}$/.test(input.emailHash) ? input.emailHash : '',
    // null when the mail keys are not configured. The read view says so rather than showing a blank and
    // letting a superadmin conclude the sponsor left the field empty.
    emailEnvelope: envelope,
  };
}

/** Where one inquiry lives. Returns '' for an unusable id, so a caller can never build a key from nothing. */
export function inquiryKey(id) {
  const s = oneLine(id);
  return /^[a-z0-9-]{8,64}$/.test(s) ? `${INQUIRY_PREFIX}${s}` : '';
}

/**
 * The note the owner gets. PLAIN TEXT ONLY, and the address is in it: this mail is the primary channel, and a
 * sponsorship inquiry the owner cannot reply to is not an inquiry.
 */
export function inquiryNotice(inquiry = {}, { email = '' } = {}) {
  const r = inquiry || {};
  const lines = [
    `Name: ${r.name || '(none given)'}`,
    `Email: ${trim(email) || '(not available)'}`,
  ];
  if (r.organization) lines.push(`Organisation: ${r.organization}`);
  if (r.website) lines.push(`Website: ${r.website}`);
  lines.push('', r.message || '(no message)', '', `Received ${r.at || 'at an unknown time'}. Reference ${r.id || '(none)'}.`);
  return {
    subject: `Digest sponsorship inquiry from ${r.name || r.emailDomain || 'someone'}`,
    text: lines.join('\n'),
  };
}
