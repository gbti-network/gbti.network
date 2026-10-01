// sow-427: the owner notice sent when a prepared listing is CLAIMED, meaning its pull request merged and the project
// is public under the claimant's name. Pure and node-free, like membership/coupon-notify.mjs whose shape it copies,
// so what the owner reads is unit-tested without a network. The Worker's sender (listing-claimed-alert.mjs) sends it
// to the owner alert address (`ADMIN_ALERT_EMAIL || COUPON_ALERT_EMAIL`), fail-soft.
//
// WHO IS TOLD, AS BUILT (amendment 15). The SOW says "the issuing superadmin is told". Both superadmins are the
// owner's accounts and the Worker holds no per-superadmin address, so the notice goes to the owner alert address and
// NAMES the superadmin who prepared the listing. That is the as-built reading of the requirement.
//
// WHAT IT CARRIES. The project is public by the time this is sent, so its title and address are not secrets. The
// invitation code is left out on purpose: it is a bearer credential, it is dead once claimed, and an inbox is not a
// place to keep one. The personal message is left out too; the owner wrote it and it has been deleted.

import { opsEmail } from './mail-ops.mjs';

const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * The record a claimed listing produces for the notice.
 * @param listing  the listing record, claimed (before or after minimizeClaimedListing)
 * @param siteBase the public site origin, for the project address
 * @param upstream the content repository (`owner/name`), for the pull request address
 */
export function listingClaimedRecord(listing, { siteBase = 'https://gbti.network', upstream = 'gbti-network/gbti.network' } = {}) {
  const base = str(siteBase).replace(/\/+$/, '');
  const slug = /^[a-z0-9][a-z0-9-]*$/.test(str(listing?.slug)) ? str(listing.slug) : '';
  const pr = Number.isInteger(listing?.prNumber) && listing.prNumber > 0 ? listing.prNumber : null;
  return {
    title: str(listing?.title || listing?.frontmatter?.title),
    slug,
    recipientName: str(listing?.recipientName),
    preparedByLogin: str(listing?.preparedByLogin),
    claimedLogin: str(listing?.claimedLogin),
    claimedFolder: str(listing?.claimedFolder),
    claimedAt: str(listing?.claimedAt),
    bound: Boolean(listing?.boundGithubId),
    projectUrl: slug ? `${base}/projects/${slug}/` : '',
    prNumber: pr,
    prUrl: pr && /^[\w.-]+\/[\w.-]+$/.test(str(upstream)) ? `https://github.com/${upstream}/pull/${pr}` : '',
  };
}

/**
 * The owner-facing email for one claim. Pure projection of a listingClaimedRecord.
 * @returns `{ subject, text, html }`. The text body is the fallback and carries the same facts in the same order.
 */
export function listingClaimedNotice(record) {
  const title = record?.title ? str(record.title) : '(untitled project)';
  const recipient = record?.recipientName ? str(record.recipientName) : '(no greeting name)';
  const preparedBy = record?.preparedByLogin ? str(record.preparedByLogin) : '(unknown superadmin)';
  const claimant = record?.claimedLogin ? str(record.claimedLogin) : '(unknown github login)';
  const folder = record?.claimedFolder && record.claimedFolder !== record.claimedLogin ? str(record.claimedFolder) : '';
  const projectUrl = str(record?.projectUrl);
  const prUrl = str(record?.prUrl);
  const prNumber = record?.prNumber ? `#${record.prNumber}` : '';
  const claimedAt = str(record?.claimedAt);
  const tied = record?.bound ? 'yes, and the account that claimed it matched' : 'no, the first person holding the link claimed it';

  const subject = `Prepared listing claimed: ${title} by ${claimant}`;
  const rows = [
    ['Project', title],
    ['Prepared for', recipient],
    ['Prepared by', preparedBy],
    ['Claimed by', claimant],
    folder ? ['Member folder', folder] : null,
    ['Tied to an account', tied],
    projectUrl ? ['Project page', projectUrl] : null,
    prNumber ? ['Pull request', prUrl ? `${prNumber} ${prUrl}` : prNumber] : null,
    claimedAt ? ['Claimed', claimedAt] : null,
  ].filter((row) => row !== null);

  const lead = 'A prepared listing was claimed. Its pull request merged, so the project is public under the member\'s name, with their own author note.';
  const guidance = 'The invitation link no longer works, and the prepared copy, its images and the personal message were deleted. '
    + 'The project page can take a few minutes to appear while the site deploys.';
  const text = [
    lead,
    '',
    ...rows.map(([k, v]) => `${`${k}:`.padEnd(20)}${v}`),
    '',
    guidance,
  ].join('\n');
  const { html } = opsEmail({
    title: 'Prepared listing claimed',
    lead,
    sections: [
      { kind: 'fields', rows },
      { kind: 'note', text: guidance },
    ],
    footer: 'Sent by the prepared-listing claim on the GBTI Network signup Worker.',
  });
  return { subject, text, html };
}
