# Contributing to gbti.network

You author content as pull requests to this public repo. **Publishing is paid-only:** a pull request that
merges into the canonical repo requires a paid membership. A pull request from anyone who is not a paid
member (a visitor, a lapsed account, or a trial member) is auto-rejected and closed. Nothing is lost: a
trial member can save drafts privately from the website, the extension or the agent server, and publish
them after upgrading. Among paid members, your membership controls whether your own-folder content stays
published.

## Add or edit content

1. Create your folder if it does not exist: `members/<your-github-username>/`.
2. Add a `profile.md`, or content under `posts/`, `products/`, or `prompts/`.
3. One item per folder, with its images beside it: `posts/<slug>/index.md` and `posts/<slug>/images/`.
4. Follow the frontmatter in `.data/schemas/content-schemas.md` (or copy an existing item).
5. Open a pull request. The checks below run automatically.

## Another member's content

Each member edits only their own folder. A pull request that touches another member's folder is held by
the gate, and a superadmin decides whether it merges; it never merges on its own, and GBTI's own tools do
not offer a way to propose or review one. If you spot a problem in someone else's work, tell them, or tell
a superadmin.

A pull request that touches more than one member's folder, or mixes another member's folder with your
own or with any `house/` or `.github/` path, is rejected.

## The rules (enforced by CI and the gate)

- For your own content, add or edit files only inside your own `members/<your-github-username>/` folder.
- A change to another member's folder is held for a superadmin to decide; it does not merge on its own.
- `author` (or `username` on a profile) must equal your folder name.
- Images use web formats (webp, avif, jpg, png, svg) and stay under 1 MB each. Optimize before
  committing. Never commit video; host it on YouTube or Vimeo and reference it with the `video` field.
- Slugs are kebab-case and globally unique within a content type.
- `status` is `draft` or `published`. `visibility` is `public` or `members`.

## What membership changes

- Non-members (visitors and lapsed accounts) cannot publish: their pull requests are auto-rejected and closed.
- Trial members write drafts, which are saved privately in their account. A trial content pull request is
  auto-rejected and closed until they pay, so nothing reaches the canonical repo during the trial.
- Paid members' own-folder content auto-merges and publishes.
- If a paid membership lapses, published work stays published. A lapse changes community access, not content.
- Details: `.data/specs/membership-and-access.md` and `.data/specs/roles-and-capabilities.md`.

## Run the checks locally

- `npm run check:content`: author scoping, unique slugs, valid status and visibility
- `npm run check:media`: image size and format, no committed video
- `npm run build`: validates frontmatter against the schemas and renders the site
