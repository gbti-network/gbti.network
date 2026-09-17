---
title: '/FARLEY : An Agent Skill for Remembering People'
slug: farley-file-skill-for-claude-code
shortDescription: >-
  A drop-in /farley skill for Claude Code that keeps a Farley File: one Markdown dossier per person
  you meet, tagged and searchable, read back as a brief before you see them again. Named for the
  files Jim Farley kept for Franklin Roosevelt, and borrowed from Robert Heinlein's Double Star.
categories:
  - ai
  - prompts
  - skill
status: draft
visibility: public
publicStub: false
pricing: free
targets:
  - Claude Code
tags:
  - claude-code
  - agent-skills
  - workflow
  - note-taking
  - relationship-management
publishedAt: '2026-09-17T18:05:51.491Z'
updatedAt: '2026-09-17T18:05:51.491Z'
type: prompt
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill"). This one gives your agent a `/farley` command that keeps a Farley File: a private dossier on the people you meet, one Markdown file per person, so the next time you see someone you already know their spouse's name, what you promised them, and when you last spoke.

The name comes from James Farley, Franklin Roosevelt's campaign manager and later Postmaster General, who kept a file on everyone the two of them met: family, work, the last conversation. Before a return visit he read it, and a man who had shaken his hand once, a year earlier, got asked about his daughter by name.

I came across it reading Robert Heinlein's *Double Star*, where an actor stands in for a politician and survives the handshakes because the politician's staff keeps exactly that file. Heinlein named it after Farley, and the 1956 novel is how most people who keep one first heard of the idea.

Most of the skill is the discipline around that file: what goes in, what never does, how it gets tagged so you can ask it questions later, and what it will not do with the web.

## What it does

`/farley` takes a mode as its first word, and `/farleyfile` is the same skill under a second name.

| Command | What it does |
|---|---|
| `/farley <name> <notes>` | Creates or updates that person's dossier, logs the meeting, and tags it. Plain sentences work: `/farley Met Tom Ruiz at the fundraiser, his wife is Ana`. |
| `/farley brief <name>` | Reads the dossier back as a pre-meeting brief: names, last conversation, open threads, what to raise, what to avoid. |
| `/farley search <query>` | Finds people by text (`fly fishing`) or by tag (`tag:role/donor tag:place/austin`). Local only, plain grep. |
| `/farley research <name>` | Searches the web for their public footprint and records confirmed findings with sources, in their own section. |
| `/farley list`, `/farley autotag`, `/farley init` | Everyone on file; re-tag one dossier or all of them; set where the file lives. |

## Install

It belongs in your home directory rather than a repository, so it works from any project and so the dossiers never end up in a commit.

1. Create `~/.claude/skills/farley/`.
2. Save the file below into it as `SKILL.md`. That is the whole skill.
3. Run `/farley init`. It asks where the dossiers should live, creates the folder, and writes `config.json`. Pick somewhere outside every git repository.
4. Type `/farley` and it shows you the menu.

Nothing else to install. The dossiers are Markdown, the search is grep, and the only setting is the folder they live in.

## The skill file

Save this as `~/.claude/skills/farley/SKILL.md`.

````markdown
---
name: farley
description: >
  Keep the Farley File: a private dossier on the people (and organizations) the operator meets.
  Invoke for "/farley" or "/farleyfile" with any of: init, list, search <query>, research <name>,
  autotag [name], brief <name>, or a name followed by notes. Also for "add this to the farley file",
  "I just met <name>", "note that <name>'s daughter is ...", "brief me on <name>", or "who do we
  know who ...". Stores one Markdown dossier per entity, tags it automatically, searches by text or
  tag, and researches a person on the web when asked. With no arguments it asks what the operator
  wants. Works from any project directory; the storage location is set once, globally, by
  "/farley init".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# /farley: the Farley File

A Farley File is a personal dossier on everyone the operator meets: spouse and children's names,
hobbies, preferences, past conversations, where and when they met, and anything else worth
remembering. Before seeing someone again, the operator reads the file so the relationship picks up
where it left off.

`/farleyfile` is the same skill under a second name.

## Storage

**Markdown is the only store of record.** Each person or organization gets a folder holding one
Markdown dossier, and the operator may drop anything else in beside it. There is no database, no
graph store and no service to run. Search is grep.

```
<root>/
  jane-doe/
    jane-doe.md            the dossier (the only file that holds data)
    (anything else the operator drops in: photos, business cards, letters)
```

The location of `<root>` is the one setting, kept in `config.json` beside this file:
`{"root": "<absolute path>"}`. **Init** writes it and nothing else does.

## Step 0: resolve the root (every mode)

Read `config.json`. Its `root` is the folder every mode reads and writes, whatever the current
working directory is. Below, `<root>` means that value; always use the literal absolute path in
commands, since shell variables do not survive between calls.

If `config.json` is missing, has no `root`, or the folder no longer exists, tell the operator no
location is set, run **Init** first, then carry on with what they asked for.

## Pick the mode from `$ARGUMENTS`

The first word decides. A person who happens to be named "List" is written as `/farley brief List`
or with notes after the name.

| Arguments | Mode |
|---|---|
| empty | **Ask.** Ask what the operator wants. |
| `init` | **Init.** Set or change the storage location. |
| `list` | **List.** Every name on file. |
| `search <query>` | **Search.** Find dossiers by text or `tag:`. Local only. |
| `research <name> [focus]` | **Research.** Look for more on the person via web search. |
| `autotag [name]` | **Autotag.** Re-tag one dossier, or every dossier when no name is given. |
| `brief <name>`, `prep <name>`, or a bare name | **Brief.** Read the dossier back for a meeting. |
| a name plus information about them, or free prose | **Record.** Create or update the dossier. |

A subcommand given without the context it needs (`/farley search`) is handled like **Ask**, narrowed
to that subcommand: ask for the missing query or name.

## Ask

Do nothing else yet. Reply with a short question asking who or what this is about, and show the
menu so the operator can answer in one line:

```
Who is this about, and what should I do?
  <name> <notes>            record what you learned
  brief <name>              read a dossier back before a meeting
  search <query>            find people by text, or by tag:place/austin
  research <name>           look them up on the web
  autotag [name]            re-tag one dossier, or all of them
  list                      everyone on file
  init                      set where the Farley File lives
```

End the turn there. Treat the operator's next message as the arguments and pick the mode from it.

## Init

1. Read `config.json`.
2. **A root is already set:** say where it is and how many dossiers it holds. Ask with
   AskUserQuestion whether to keep it or change it. Keep ends here.
3. **No root yet, or the operator chose to change it:** ask for the location with AskUserQuestion.
   Offer the current working directory and `~/farley` as options; the operator can type any other
   path through "Other".
4. Normalize the answer: `~` expands to the home directory, and the result must be absolute. On WSL,
   a Windows path (`D:\Brain\farley`) becomes a WSL path with `wslpath -u`.
5. Create the folder if needed (`mkdir -p`), and write `config.json` as
   `{"root": "<absolute path>"}`.
6. **Changing from an old root that holds dossiers:** ask whether to move them to the new location
   or leave them where they are. Move only on a yes, with `mv`, and never delete anything.
7. Report the new location.

## Step 1: find the entity (Record, Brief, Research, Autotag)

1. Derive the **slug**: the name in lowercase ASCII, accents folded, honorifics and suffixes dropped
   (Dr, Rep, Sen, Mr, Ms, Jr, III), apostrophes and periods removed, spaces to hyphens.
   `Dr. María O'Neil` becomes `maria-oneil`. `The Acme Foundation` becomes `acme-foundation`.
2. Look for an existing dossier before creating one. Check the folder list, then the `name:` and
   `aliases:` lines of every dossier, case-insensitively, so a nickname, a maiden name or a first name
   alone still finds the right person:

   ```bash
   ls <root>
   grep -iE "^(name|aliases):" <root>/*/*.md 2>/dev/null
   ```

3. Decide:
   - **One clear match:** use it.
   - **No match:** Record creates `<slug>/<slug>.md` from the layout below. The other modes say no
     dossier exists and ask whether to start one. Never create an empty file.
   - **Several plausible matches** (two Johns, or "Sarah" alone): ask with AskUserQuestion, listing
     each candidate with their role and last contact. Never guess and merge two people.
   - **Same name, different person:** add a disambiguator to the slug from what the notes give
     (`john-smith-austin`, `john-smith-acme`), and say so.

## Record

Read the whole dossier first, then edit it in place. Never rewrite it from memory. A new dossier
takes this shape, with the headings kept even when empty, so every file reads the same way:

```markdown
---
name: Jane Doe
aliases: []
type: person
relationship: how the operator knows them, in a few words
first_met: 2026-09-16
last_contact: 2026-09-16
tags: []
---

# Jane Doe

## At a glance

One or two sentences: who they are and why they matter.

## Identity

- Role and organization:
- Location:
- Contact:
- Birthday:

## Family

- Spouse or partner:
- Children:
- Pets:

## Interests and preferences

## Background

## Topics and positions

## Connections

## Follow-ups

## Research

## Interaction log
```

**Structured sections** (`At a glance`, `Identity`, `Family`, `Interests and preferences`,
`Background`, `Topics and positions`, `Connections`, `Follow-ups`) hold the distilled, current
facts the operator supplied. Put each new fact under the heading where someone skimming before a
meeting would look for it. Add a bullet; do not duplicate one that already says the same thing.
`Research` is written only by **Research**.

**The interaction log** holds what happened. Add one entry per meeting or note, **newest first**,
directly under `## Interaction log`:

```markdown
### 2026-09-16 · Rotary lunch, Austin
- What was said, done or learned, in the operator's own words where possible.
- Anything they asked for, offered, or promised.
```

If the notes are not about a meeting (a fact heard secondhand, a correction), log it as
`### 2026-09-16 · Note` and name the source if the operator gave one.

**Frontmatter.** Keep it current on every write: add new nicknames to `aliases`, set `last_contact`
to the date of the newest real interaction (not a secondhand note or research), and set `first_met`
only once. Keep `aliases` and `tags` as one-line lists (`tags: [role/donor, place/austin]`), which is
the form the searches below read.

**Then tag it:** apply **Tags** to the dossier.

### Rules that keep the file trustworthy

- **Record only what the operator supplied.** Do not infer, embellish, or fill gaps. The web is used
  only by **Research**, and only when the operator invokes it.
- **Pronouns:** use the ones the operator used. If none were given, write around them or use
  they/them. Never infer them from a name.
- **Absolute dates only.** Convert "yesterday", "last Tuesday", "next month" against today's date.
  If no meeting date is given, use today and say so in the reply.
- **Never delete a fact.** When new information contradicts old, write the new value and keep the
  old one beside it with its date: `Works at Dell (previously HP, noted 2026-03-02)`.
- **Uncertain facts stay marked as uncertain.** "I think her son is at UT" becomes
  `Son possibly at UT (unconfirmed)`.
- **Follow-ups are checkboxes.** Promises made in either direction become `- [ ] Send Tom the grant
  deadline (promised 2026-09-16)`. When the operator reports one done, tick it and add the date; do
  not remove it.
- **Other people in the notes.** Relatives, assistants and colleagues mentioned in passing go under
  `Family` or `Connections` in the main person's dossier. Give someone their own folder only if the
  notes are substantially about them too, or the operator asks. When both people have dossiers,
  link them with relative links (`[Ana Ruiz](../ana-ruiz/ana-ruiz.md)`) in each file's `Connections`.
- **Write no em-dashes** in any file this skill writes, per the global writing rule. Use commas,
  colons, parentheses or a new sentence. The `·` in log headings is fine.

Report briefly: the dossier path and whether it was **created** or **updated**, a few bullets of what
was added, the tags added, any contradiction recorded, any assumption made (date defaulted to today,
which of two Johns), and this person's open follow-ups. Do not echo the whole dossier back.

## Tags

Tags are how the file answers "everyone who ..." questions without a database. They are assigned
automatically on every **Record**, **Research** and **Autotag**; the operator never has to ask.

**Form:** `facet/value`, lowercase, hyphenated: `place/travis-county`, `interest/fly-fishing`.

| Facet | For | Examples |
|---|---|---|
| `role` | how they relate to the operator | `role/donor`, `role/volunteer`, `role/press`, `role/staff`, `role/elected-official` |
| `org` | organizations they belong to or lead | `org/literacy-council`, `org/dell` |
| `place` | where they live, work or are active, online communities included | `place/austin`, `place/district-7`, `place/reddit` |
| `event` | where the operator met or saw them | `event/rotary-lunch`, `event/2026-literacy-gala` |
| `interest` | hobbies and passions | `interest/fly-fishing`, `interest/jazz` |
| `issue` | policy areas they care about or work on | `issue/school-funding`, `issue/water-rights` |

**Rules:**

1. **Reuse before inventing.** Read the tags already in use and pick an existing one when it fits,
   so `interest/fishing` does not gain a rival `interest/angling`:

   ```bash
   grep -h "^tags:" <root>/*/*.md | tr -d '[]' | tr ',' '\n' | sed 's/^tags://' | tr -d ' ' | sort -u
   ```

2. **Tag only what the dossier says.** Every tag must trace to a line in the file. Remove a tag
   only when the fact behind it is gone or superseded, and say so.
3. **Stay within the six facets.** A tag that fits none of them usually belongs in prose instead.
4. **Never tag sensitive traits:** health, religion, ethnicity, sexual orientation, immigration
   status, political party, or anything similar. If the operator recorded such a fact it stays in
   the prose; it never becomes a way to list people.
5. **A handful per dossier.** Tags that would match almost everyone on file (`place/texas` for a
   Texas office) add nothing; prefer the more specific one.

## List

Read the frontmatter of every dossier and return **every** name, alphabetically, one per line, with
relationship and last contact after it, and the total at the end:

```bash
grep -H -E "^(name|relationship|last_contact):" <root>/*/*.md
```

```
Ana Ruiz · board member, Literacy Council · last contact 2026-08-30
Jane Doe · donor, Travis County · last contact 2026-09-16
2 people on file.
```

If the folder is empty, say so and offer to add someone.

## Search

Local only; this mode never touches the web and never edits a dossier. Plain grep over Markdown is
the whole engine.

1. **Tag queries.** `tag:place/austin` finds dossiers carrying that tag. Several `tag:` terms mean
   all of them (`tag:role/donor tag:place/austin`). The brackets match the whole tag, so
   `role/donor` does not also match `role/donor-major` (a `\b` boundary would):

   ```bash
   grep -lE "^tags:.*[[ ]role/donor[],]" <root>/*/*.md | xargs -r grep -lE "^tags:.*[[ ]place/austin[],]"
   ```

2. **Text queries.** Turn the query into terms and their obvious variants (`fish`, `fishing`,
   `angler`), and search every dossier with line numbers:

   ```bash
   grep -rinE "fish|angl" <root> --include='*.md'
   ```

3. **Structural queries.** Use the frontmatter (`relationship`, `first_met`, `last_contact`) and the
   dated log headings (`### YYYY-MM-DD`) for "everyone I met in March" or "donors I have not spoken
   to since spring". For "who knows Ana Ruiz", grep for links to her dossier:
   `grep -l "ana-ruiz/ana-ruiz.md" <root>/*/*.md`.
4. Open the candidate dossiers and confirm each hit actually answers the query. Drop incidental
   matches.
5. Return a ranked, numbered list, at most 15 (say how many more there are):

   ```
   1. Jane Doe (donor, Travis County; last contact 2026-09-16)
      Fly fishes on the Llano with her husband Tom.
      <root>/jane-doe/jane-doe.md:24
   ```

With no results, say so and suggest a broader query or a nearby tag already in use.

## Autotag

`/farley autotag <name>` re-tags one dossier; `/farley autotag` re-tags every dossier. Use it after
the tag rules change, or on files written before tagging existed.

1. Read the tags already in use, then each dossier in turn.
2. Apply **Tags** to its whole content. Add missing tags, fold synonyms into the existing tag, and
   remove only tags whose fact is gone.
3. Change nothing but the `tags:` line. Do not log autotagging in the interaction log.
4. Report per dossier what was added, merged or removed.

## Brief

Read the dossier and give a pre-meeting brief the operator can take in at a glance:

1. **Who:** one line (role, organization, how you know them, first met).
2. **Names to remember:** spouse, children, pets, assistant.
3. **Last time:** date, place, and what was discussed.
4. **Open threads:** unchecked follow-ups, things they were waiting on, anything they said they
   were about to do (a trip, a surgery, a kid's graduation) that is worth asking about now.
5. **Talking points:** interests and preferences worth raising, and anything to avoid.

Draw only from the file. Anything taken from `Research` is labelled as coming from public sources.
If the file is thin, say so rather than padding the brief.

## Research

Invoking this mode is the operator's explicit request to search the web for this person. It sends
the person's name and identifying details to a search provider, so it runs only when invoked.

1. **Find the dossier** (Step 1). With no dossier, ask who the person is (where they work or live,
   how the operator met them) and whether to start a dossier for the results. Never search a bare
   name with nothing to confirm identity against.
2. **Load the tools:** `ToolSearch` with `select:WebSearch,WebFetch`.
3. **Collect anchors** from the dossier: organization, role, city, known associates, events. Any
   focus given after the name (`research Jane Doe literacy work`) steers the queries.
4. **Search** with several queries pairing the name with each anchor, and fetch the pages that look
   relevant.
5. **Confirm identity.** A result counts only when it matches the name **and** at least one anchor.
   Anything else is a possible match: report it, do not record it.
6. **Look for** the public, professional and civic footprint: current role and career history,
   boards and nonprofit roles, public statements and positions, news coverage, awards, published
   work, public professional profiles, and public records tied to a public role (campaign
   contributions, lobbying registrations, business filings).
7. **Do not look for or record** a home address, personal phone number or email, date of birth,
   health, personal finances, or details about family members beyond what the operator already
   recorded (children above all). Do not use people-search or data-broker sites, and do not try to
   get past a login or paywall.
   **People known only by a handle** (a Reddit or forum username): research what they publish under
   that handle, and nothing more. Do not try to connect the handle to a real name, and do not treat
   the same handle on another site as the same person unless it matches an anchor. If they have
   linked their own identity publicly, that link may be recorded.
   **Blocked sites:** WebFetch cannot reach reddit.com (old or new). Do not work around a block with
   curl or a browser; record that the site could not be read, and suggest the operator paste or
   screenshot what they want kept.
8. **Write** confirmed findings as bullets under `## Research`, each with its source and date:

   ```markdown
   - Chairs the Travis County Literacy Council board ([Austin Chronicle](https://...), retrieved 2026-09-16)
   ```

   Do not duplicate an existing bullet; when a finding updates one, keep both with their dates. Do
   not copy findings into the firsthand sections. If a finding contradicts something the operator
   recorded, leave the firsthand fact alone and raise it in the reply.
9. **Log it** as `### 2026-09-16 · Web research` with one line: how many findings were added and the
   focus, if any. Do not change `last_contact`. Apply **Tags** (confirmed findings may add `org/`
   and `issue/` tags).
10. **Report:** the findings added with their sources, the possible matches left out and why, what
    was searched for and not found, and a reminder that the queries went to a search provider.

## Privacy

This is sensitive personal information about real people who did not ask to be recorded.

- The dossiers stay on this machine. Never publish one as an Artifact, never put one in Claude Docs,
  Google Drive or email, and never commit them to a repository.
- The only thing that leaves the machine is the search queries **Research** sends, and only when
  the operator invokes it.
- Tags never encode sensitive traits (see **Tags**), so the file cannot be used to list people by
  them.
- Do not quote a dossier into another project's files or conversations unless the operator asks.
- If the operator asks to remove a person, confirm, delete that folder, then say what was deleted.
````

## Why these rules are in the file

You have to trust a dossier line by line, and these are the rules that earn it.

**It records what you said, and nothing else.** No inference, no filling in the obvious gap. A file that quietly decides someone probably has children is worse than no file, because you will act on that in front of them. Only `research` reaches the web, and only when you ask it to.

**It never deletes a fact.** New information sits beside the old with its date: `Works at Dell (previously HP, noted 2026-03-02)`. You often need the old fact to make sense of the person.

**Uncertain stays uncertain.** "I think her son is at UT" is written as `Son possibly at UT (unconfirmed)`, which is the difference between a good question and an embarrassing one.

**Dates are absolute.** "Last Tuesday" becomes a date, because the file outlives the conversation that produced it.

**Promises become checkboxes**, in both directions, with the date they were made. Half the value of the file is walking in knowing what you owe someone.

**Tags never encode sensitive traits.** Health, religion, ethnicity, sexual orientation, immigration status and party are off the list, because a tag is how you list people, and a list of people by those traits is not something to keep on a laptop. If you recorded the fact it stays in the prose.

**Research is narrow and opt-in.** It looks for the public and professional footprint: role, boards, public statements, coverage, public records tied to a public role. It does not look for a home address, a personal phone number, a birth date, health or finances, and it does not use data brokers. If you know someone only by a forum handle, it reads what they publish under that handle and stops there, without trying to attach a name to it.

**It stays on your machine.** The dossiers are never published, never synced, never committed. The only thing that leaves is a search query, and only when you run `research`.

## Making it yours

The six tag facets (`role`, `org`, `place`, `event`, `interest`, `issue`) came out of political and nonprofit work, which is where Farley Files are most at home. Swap them for your own trade before you have fifty dossiers: a contractor wants `trade` and `site`, a recruiter wants `company` and `stack`. The rules around them matter more than the words: reuse an existing tag before inventing one, tag only what the file actually says, and keep the sensitive list empty.

The dossier headings are the other place to edit. They are ordered the way you skim before a meeting, so if you always want one thing first, move it in the file and the agent follows.

The skill is one file on purpose. Two additions earn their keep once you have twenty dossiers: a generated index of everyone on file, and a printable sheet you can carry into the meeting rather than reading off a screen.

The skill writes no em dashes, in Markdown or HTML, because of a global writing rule of mine. Drop that line if it is not yours.
