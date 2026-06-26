# Contributing to gbti.network

You author content as pull requests to this public repo. **Publishing is paid-only:** a pull request that
merges into the canonical repo requires a paid membership. A pull request from anyone who is not a paid
member (a visitor, a lapsed account, or a trial member) is auto-rejected and closed. Nothing is lost: a
trial member authors and stages drafts on their own GitHub fork, and after upgrading to a paid membership
their client publishes those staged drafts as a new pull request. Among paid members, your membership
controls whether your own-folder content stays published.

## Add or edit content

1. Create your folder if it does not exist: `members/<your-github-username>/`.
2. Add a `profile.md`, or content under `posts/`, `products/`, or `prompts/`.
3. One item per folder, with its images beside it: `posts/<slug>/index.md` and `posts/<slug>/images/`.
4. Follow the frontmatter in `.data/schemas/content-schemas.md` (or copy an existing item).
5. Open a pull request. The checks below run automatically.

## Contributing to another member's content

You may also suggest an edit to another member's content. Open a pull request that touches only that
one member's folder. If you are a paid member, the gate holds it as a contribution until that folder's
owner accepts it by submitting an approving review on your pull request (a trial contributor's pull request
is auto-rejected and closed instead, with the draft kept on your fork until you upgrade). Once the owner
approves (and the owner is paid), it merges, your commit is recorded in git history, and you are credited
in the content's contributors footnote and the stacked avatars. Classify your change so the owner knows
what it is:

- `grammar`: spelling, punctuation, formatting only. A courtesy. It earns no points.
- `correction`: a factual or code fix that changes meaning or behavior. It earns 1 point.
- `addition`: net-new content (a section, an example). It earns at least 1 point.

A pull request that touches more than one member's folder, or mixes another member's folder with your
own or with any `house/` or `.github/` path, is rejected. See `.data/ops/revenue-ops/README.md` for
how points and the author's right to reject an award work.

## The rules (enforced by CI and the gate)

- For your own content, add or edit files only inside your own `members/<your-github-username>/` folder.
- To contribute to someone else, edit only that one member's folder; it merges when they approve.
- `author` (or `username` on a profile) must equal your folder name.
- Images use web formats (webp, avif, jpg, png, svg) and stay under 1 MB each. Optimize before
  committing. Never commit video; host it on YouTube or Vimeo and reference it with the `video` field.
- Slugs are kebab-case and globally unique within a content type.
- `status` is `draft` or `published`. `visibility` is `public` or `members`.

## What membership changes

- Non-members (visitors and lapsed accounts) cannot publish: their pull requests are auto-rejected and closed.
- Trial members author and stage drafts on their own fork; a trial content pull request (own folder or a
  contribution) is auto-rejected and closed until they pay, so nothing reaches the canonical repo during the trial.
- Paid members' own-folder content auto-merges and publishes.
- If a paid membership lapses, that member's content flips to draft until they resubscribe.
- Details: `.data/specs/membership-and-access.md` and `.data/specs/roles-and-capabilities.md`.

## Run the checks locally

- `npm run check:content`: author scoping, unique slugs, valid status and visibility
- `npm run check:media`: image size and format, no committed video
- `npm run build`: validates frontmatter against the schemas and renders the site
