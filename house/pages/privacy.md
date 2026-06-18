---
type: page
title: "Privacy Policy"
slug: privacy
status: published
visibility: public
description: "How the GBTI Network collects, uses, and protects your data. Covers the public content repository, the membership registry (Stripe), the processors we rely on, your rights including erasure, and the honest limits of deleting content from a public repository."
updatedAt: 2026-06-09
redirectFrom: ["/privacy/"]
---

# Privacy Policy

_Last updated: June 9th 2026_

## 1. Who we are

The GBTI Network ("GBTI", "we", "our", or "us") operates this website and the related membership community. For the personal data described here, GBTI is the data controller. If you have a question about your data, please [contact us](/contact/).

## 2. The public content repository (please read this first)

The GBTI Network's website is published from a public Git repository, and that repository is the system of record for member content. This shapes almost everything below.

- Content you choose to publish (your member profile, articles, products, prompts, and comments) is committed to a public repository and is visible to anyone.
- Because the repository is public, copies can be made outside our control: it can be forked on GitHub, cached by content delivery networks such as jsDelivr, and captured by web archives.
- When you ask us to remove published content, we remove it from our canonical repository and rebuild the site, but we cannot guarantee removal from third-party forks, caches, or archives. Publishing to a public repository is, in this sense, irreversible.
- Member-only content is encrypted before it is committed, and the decryption key never leaves our server. We rotate that key on a schedule, which makes older encrypted content in the repository history unreadable over time. This is strong protection for perks, not a guarantee of absolute secrecy.

## 3. What we collect, and where it lives

We practice data minimization. We do not store your email address or payment details on our own systems.

- **Identity.** When you sign in with GitHub, we record your immutable GitHub user id and login. If you connect Discord, we record your Discord user id. If you set a profile avatar, we store a one-way Gravatar hash, not your email address.
- **Membership and billing.** Our payment processor, Stripe, holds your email address and billing details and acts as the registry of your membership status. We read your status from Stripe; we do not store card data.
- **Published content.** Your profile, articles, products, prompts, and comments live in the public repository, by your choice to publish them.
- **Activity data.** Your private bookmarks (favorites) and collections are stored in a separate, deletable store at the network edge, keyed to your GitHub id. They are private to you and are not published to the repository.
- **Operational data.** Our infrastructure provider, Cloudflare, processes technical request data such as IP addresses for security and reliability, and we use Cloudflare Turnstile to deter automated abuse at sign-up.

## 4. How we use your data, and our lawful bases

- To provide the service you signed up for: authentication, publishing, membership, billing, role assignment, and community access. Our lawful basis is performance of our contract with you.
- To keep the service secure: anti-abuse checks, access controls, and logging. Our lawful basis is our legitimate interest in protecting the network.
- To run the referral program: when you arrive through a member's referral link, we set a first-party cookie that records only the referrer's id, so that member is credited if you join later. Our lawful basis is our legitimate interest in operating the referral program. The cookie is first-party, holds no profile, and you can clear it anytime in your browser.
- To understand and improve the site: privacy-respecting, cookieless analytics (Cloudflare Web Analytics). It sets no cookies and stores no cross-site identifier, so it needs no consent banner. Our lawful basis is our legitimate interest in understanding aggregate traffic to improve the co-op.

We do not use advertising cookies, we do not sell your data, and we do not profile you to make decisions that produce legal effects.

## 5. Cookies

One referral cookie, plus a sign-in session cookie that is strictly necessary to keep you logged in. Our analytics is cookieless and sets no cookie at all:

- **Referral (always set, for referral credit):** a first-party cookie set only when you arrive through a member's referral link, so a referral can be credited if you join. It holds only the referrer's id. It is set for all visitors, including those in the EU, the EEA, and the UK. You can clear it at any time in your browser settings.
- **Analytics (cookieless):** we use Cloudflare Web Analytics, which is privacy-respecting and sets NO cookie and no cross-site identifier, so there is nothing here to consent to. We do not use advertising or cross-site tracking cookies. (The EU/EEA/UK consent banner remains in place should we ever add a cookie-based analytics product.)

## 6. Who we share data with

We do not sell your personal data, and we do not share it with third parties for their own marketing.

We rely on a small number of service providers (processors), each under a data processing agreement:

- **GitHub** hosts the public repository and provides sign-in.
- **Stripe** processes payments and holds the membership registry.
- **Cloudflare** hosts the site and the edge services, and provides Turnstile.
- **Discord** hosts the community and holds community messages.
- **Resend** sends transactional email when email is used.

Some of these providers are based in the United States. Where personal data is transferred internationally, the transfer relies on appropriate safeguards such as Standard Contractual Clauses or the EU-US Data Privacy Framework.

## 7. Your rights

Depending on where you live, you may have the right to access your data, correct it, delete it, receive a portable copy, restrict or object to certain processing, and withdraw consent. To exercise any of these, please [contact us](/contact/).

- **Access and portability.** Much of your data is already portable: your published content is plain Markdown in your own folder in the repository.
- **Erasure.** We will remove your content from our canonical repository, hard-delete your activity data (favorites and collections) from the edge store, rotate the key that protects your encrypted member-only content, and remove your membership records from Stripe and your community roles from Discord. As explained in section 2, we cannot guarantee removal from third-party forks, caches, or archives of the public repository.
- **Complaints.** If you are in the EU, the UK, or another region with a supervisory authority, you have the right to lodge a complaint with it.

## 8. Data retention

We keep membership records for the life of your membership and for any period required by tax or accounting law, then delete or anonymize them. Activity data is kept until you remove it or close your account. Backups of the edge store will be encrypted and kept for a bounded period.

## 9. Security

We encrypt member-only content, store a one-way hash rather than your email, derive membership status rather than warehousing it, and fail closed on access checks so that an error never grants access it should not. No method of storage or transmission is perfectly secure, but we take reasonable measures to protect your data.

## 10. Children

The service requires a GitHub account and is intended for adults and for users old enough to consent under their local law. It is not directed to children under 16.

## 11. Changes to this policy

We may update this policy from time to time. When we do, we will revise the "Last updated" date above and, for material changes, take reasonable steps to notify members.

## 12. Contact us

Questions about this policy or your data can be sent through our [contact page](/contact/).
