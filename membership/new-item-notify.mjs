// sow-458: the email the owner gets when a member CREATES an article, project, prompt or share. Pure and node-free
// (no fetch, no KV), so the copy is unit-tested without a network, like coupon-notify.mjs.
//
// It replaces sow-323's "waiting for review" notice. Editorial review was retired on 2026-10-16 ("It is published when
// the person publishes it"), and the owner asked to keep the email: "I still want to be emailed every time a user
// creates a project / prompt / article / share". Superadmins' own items are not mailed (owner's answer, same day), and
// an edit is not mailed; the Worker decides both before it calls this.
//
// A TITLE IS TEXT A MEMBER WROTE. contentItemsIn (membership/hosted-author.mjs) bounded it and stripped control
// characters; opsEmail escapes it again for the HTML half.

import { opsEmail } from './mail-ops.mjs';

const str = (v) => (v == null ? '' : String(v));

/** The page an item has. A members-only share has none, and neither does a members-only article, project or prompt
 *  without a public stub; one WITH a stub has a noindex page that signed-in paying members read. */
export function newItemUrl({ type, slug, login, visibility, publicStub } = {}, origin = 'https://gbti.network') {
  const base = str(origin).replace(/\/$/, '');
  const s = str(slug);
  if (!s) return null;
  if (type === 'share') return visibility === 'public' && login ? `${base}/shares/${str(login)}/${s}/` : null;
  if (visibility === 'members' && publicStub !== true) return null;
  const dir = { post: '/articles', project: '/projects', prompt: '/prompts' }[type];
  return dir ? `${base}${dir}/${s}/` : null;
}

export function typeLabel(type) {
  return { post: 'Article', project: 'Project', prompt: 'Prompt', share: 'Share' }[str(type)] || 'Item';
}

const audienceLabel = (v) => (v === 'members' ? 'Members only' : 'Public');

/**
 * @param items  the new items of one publish, each `{ path, type, slug, login, visibility, title }`.
 * @param origin the site origin, for each item's address.
 * @returns `{ subject, text, html }`. Never throws.
 */
export function newItemsNotice(items, { origin = 'https://gbti.network' } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((r) => r && typeof r === 'object');
  const author = str(list[0]?.login) || '(unknown member)';
  const one = list.length === 1;
  const name = (r) => str(r.title) || str(r.slug);

  const subject = one
    ? `New ${typeLabel(list[0]?.type).toLowerCase()} by ${author}: ${name(list[0])}`
    : `${list.length} new items by ${author}`;
  const lead = one ? `${author} published something new on the network.` : `${author} published ${list.length} new items on the network.`;
  const note = 'It goes live when the site rebuilds, in about 2 to 3 minutes. Nothing needs your approval; this is so you know.';

  const lines = [
    lead,
    '',
    ...list.flatMap((r) => [
      `${typeLabel(r.type)}: ${name(r)}`,
      `Audience: ${audienceLabel(r.visibility)}`,
      `Address: ${newItemUrl(r, origin) || '(no public page)'}`,
      `File: ${str(r.path)}`,
      '',
    ]),
    note,
  ];

  const rows = list.flatMap((r) => [
    [typeLabel(r.type), name(r)],
    ['Audience', audienceLabel(r.visibility)],
    ['Address', newItemUrl(r, origin) || '(no public page)'],
  ]);

  const { html } = opsEmail({
    title: one ? `New ${typeLabel(list[0]?.type).toLowerCase()} on the network` : `${list.length} new items on the network`,
    lead,
    sections: [
      { kind: 'fields', rows: rows.length ? rows : [['Nothing to show', '(no items)']] },
      { kind: 'note', text: note },
    ],
    footer: 'Sent by the GBTI Network signup Worker when a member publishes something new.',
  });

  return { subject, text: lines.join('\n'), html };
}
