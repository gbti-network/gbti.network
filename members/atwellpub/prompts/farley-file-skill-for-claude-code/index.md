---
title: '/FARLEY : An Agent Skill for Remembering People'
slug: farley-file-skill-for-claude-code
shortDescription: >-
  A drop-in /farley skill for Claude Code that keeps a Farley File: one Markdown dossier per person
  you meet, tagged and searchable, with a pre-meeting brief and a printable sheet. Named for the
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
| `/farley print <name> [occasion]` | Writes a printable one-page HTML sheet and offers to open the print dialog. |
| `/farley list`, `/farley autotag`, `/farley init` | Everyone on file; re-tag one dossier or all of them; set where the file lives. |

## Install

It belongs in your home directory rather than a repository, so it works from any project and so the dossiers never end up in a commit.

1. Create `~/.claude/skills/farley/`.
2. Save the files below into it. `SKILL.md` is the skill; the rest are the layouts and two small scripts it calls.
3. Run `/farley init`. It asks where the dossiers should live, creates the folder, and writes `config.json`. Pick somewhere outside every git repository.
4. Type `/farley` and it shows you the menu.

Python 3 is the only requirement, and only for the two helper scripts. The dossiers are Markdown and the search is grep, so there is nothing else to install and nothing to keep running.

## The skill file

Save this as `~/.claude/skills/farley/SKILL.md`.

````markdown
---
name: farley
description: >
  Keep the Farley File: a private dossier on the people (and organizations) the operator meets.
  Invoke for "/farley" or "/farleyfile" with any of: init, list, search <query>, research <name>,
  print <name>, autotag [name], brief <name>, or a name followed by notes. Also for "add this to the
  farley file", "I just met <name>", "note that <name>'s daughter is ...", "brief me on <name>", "who
  do we know who ...", or "print a sheet on <name> for the meeting". Stores one Markdown dossier per
  entity, tags it automatically, searches by text or tag, researches a person on the web when asked,
  and writes printable HTML reports. With no arguments it asks what the operator wants. Works from
  any project directory; the storage location is set once, globally, by "/farley init".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# /farley: the Farley File

A Farley File is a personal dossier on everyone the operator meets: spouse and children's names,
hobbies, preferences, past conversations, where and when they met, and anything else worth
remembering. Before seeing someone again, the operator reads the file so the relationship picks up
where it left off.

`/farleyfile` is the same skill under a second name.

## Skill files

All in `~/.claude/skills/farley/`:

| File | Purpose |
|---|---|
| `config.json` | The global setting: `{"root": "<absolute path>"}`. Written only by init. |
| `template.md` | Layout of a new dossier. |
| `print-template.html` | Layout and styling of a printable report. |
| `root-readme.md` | The root's README, and the single source of its command list. |
| `sync-readme.py` | Copies that command list into `<root>/README.md`. |
| `build-index.py` | Regenerates `<root>/index.md` and `<root>/tags.md` from the dossiers. |

**Changing this skill's commands?** Update the table between the `farley:commands` markers in
`root-readme.md` in the same edit. Step 0 carries it into the root README on the next run.

## Storage

**Markdown is the only store of record.** Each dossier is a Markdown file, and everything else is
derived from the dossiers and can be regenerated from them: `index.md` and `tags.md` by
`build-index.py`, and the HTML reports by **Print**. There is no database, no graph store and no
service to run. The skill never creates a PDF, for any purpose, including checking a report.

```
<root>/
  README.md                what this folder is, with the command list
  index.md                 generated: one row per dossier
  tags.md                  generated: every tag, and who carries it
  jane-doe/
    jane-doe.md            the dossier (the only file that holds data)
    print/
      jane-doe-2026-09-16.html   generated printable report
    (anything else the operator drops in: photos, business cards, letters)
```

## Step 0: resolve the root (every mode)

Read `config.json`. Its `root` is the folder every mode reads and writes, whatever the current
working directory is. Below, `<root>` means that value; always use the literal absolute path in
commands, since shell variables do not survive between calls.

If `config.json` is missing, has no `root`, or the folder no longer exists, tell the operator no
location is set, run **Init** first, then carry on with what they asked for.

Then keep the root README's command list current. It touches only the marked block, so the
operator's own edits elsewhere in the README survive:

```bash
python3 ~/.claude/skills/farley/sync-readme.py <root>
```

Mention it in the reply only when it prints something other than `unchanged`.

## Pick the mode from `$ARGUMENTS`

The first word decides. A person who happens to be named "Print" or "List" is written as
`/farley brief Print` or with notes after the name.

| Arguments | Mode |
|---|---|
| empty | **Ask.** Ask what the operator wants. |
| `init` | **Init.** Set or change the storage location. |
| `list` | **List.** Every name on file. |
| `search <query>` | **Search.** Find dossiers by text or `tag:`. Local only. |
| `research <name> [focus]` | **Research.** Look for more on the person via web search. |
| `print <name> [occasion]` | **Print.** Write a printable HTML report and ask whether to print it. |
| `autotag [name]` | **Autotag.** Re-tag one dossier, or every dossier when no name is given. |
| `brief <name>`, `prep <name>`, or a bare name | **Brief.** Read the dossier back for a meeting. |
| a name plus information about them, or free prose | **Record.** Create or update the dossier. |

A subcommand given without the context it needs (`/farley search`, `/farley print`) is handled like
**Ask**, narrowed to that subcommand: ask for the missing query or name.

## Ask

Do nothing else yet. Reply with a short question asking who or what this is about, and show the
menu so the operator can answer in one line:

```
Who is this about, and what should I do?
  <name> <notes>            record what you learned
  brief <name>              read a dossier back before a meeting
  search <query>            find people by text, or by tag:place/austin
  research <name>           look them up on the web
  print <name> [occasion]   printable report
  autotag [name]            re-tag one dossier, or all of them
  list                      everyone on file
  init                      set where the Farley File lives
```

End the turn there. Treat the operator's next message as the arguments and pick the mode from it.

## Init

1. Read `config.json`.
2. **A root is already set:** say where it is (give the Windows path too, from `wslpath -w`) and how
   many dossiers it holds. Ask with AskUserQuestion whether to keep it or change it. Keep ends here.
3. **No root yet, or the operator chose to change it:** ask for the location with AskUserQuestion.
   Offer the current working directory and `~/farley` as options; the operator can type any other
   path through "Other".
4. **Advise on provisioning.** Check `python3 --version`. Tell the operator that is the only
   requirement: the file is plain Markdown searched with grep, so there is no database, graph or
   service to install. If `python3` is missing, say the README sync and the index will not run
   until it is installed, and continue.
5. Normalize the answer: a Windows path (`D:\Brain\farley`) becomes a WSL path with `wslpath -u`,
   `~` expands to the home directory, and the result must be absolute.
6. Create the folder if needed (`mkdir -p`), then run `sync-readme.py` and `build-index.py` on it.
   Together they create `README.md`, `index.md` and `tags.md`.
7. Write `config.json` as `{"root": "<absolute WSL path>"}`.
8. **Changing from an old root that holds dossiers:** ask whether to move them to the new location
   or leave them where they are. Move only on a yes, with `mv`, and never delete anything. Rebuild
   the index in the new root afterwards.
9. Report the new location in both WSL and Windows form.

## Step 1: find the entity (Record, Brief, Research, Print, Autotag)

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
   - **No match:** Record creates `<slug>/<slug>.md` from `template.md`. The other modes say no
     dossier exists and ask whether to start one. Never create an empty file.
   - **Several plausible matches** (two Johns, or "Sarah" alone): ask with AskUserQuestion, listing
     each candidate with their role and last contact. Never guess and merge two people.
   - **Same name, different person:** add a disambiguator to the slug from what the notes give
     (`john-smith-austin`, `john-smith-acme`), and say so.

## Record

Read the whole dossier first, then edit it in place. Never rewrite it from memory.

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
the form `build-index.py` reads.

**Then tag and rebuild:** apply **Tags** to the dossier, and run **Rebuild the views**.

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
- **Write no em-dashes** in any file this skill writes, Markdown or HTML, per the global writing
  rule. Use commas, colons, parentheses or a new sentence. The `·` in log headings is fine.

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

1. **Reuse before inventing.** Read `<root>/tags.md` first and use an existing tag when one fits:
   `interest/fishing` is already there, so do not add `interest/angling`.
2. **Tag only what the dossier says.** Every tag must trace to a line in the file. Remove a tag
   only when the fact behind it is gone or superseded, and say so.
3. **Stay within the six facets.** A tag that fits none of them usually belongs in prose instead.
4. **Never tag sensitive traits:** health, religion, ethnicity, sexual orientation, immigration
   status, political party, or anything similar. If the operator recorded such a fact it stays in
   the prose; it never becomes a way to list people.
5. **A handful per dossier.** Tags that would match almost everyone on file (`place/texas` for a
   Texas office) add nothing; prefer the more specific one.

## Rebuild the views

After every write to a dossier, regenerate the index and the tag list. Never edit either by hand:

```bash
python3 ~/.claude/skills/farley/build-index.py <root>
```

It prints a summary. If it reports a dossier it could not read, fix that dossier's frontmatter.

## List

Rebuild the views, then read `<root>/index.md`. Return **every** name, alphabetically, one per line,
with relationship and last contact after it, and the total at the end:

```
Ana Ruiz · board member, Literacy Council · last contact 2026-08-30
Jane Doe · donor, Travis County · last contact 2026-09-16
2 people on file.
```

If the file is empty, say so and offer to add someone.

## Search

Local only; this mode never touches the web and never edits a dossier. Plain grep over Markdown is
the whole engine.

1. **Tag queries.** `tag:place/austin` finds dossiers carrying that tag. Several `tag:` terms mean
   all of them (`tag:role/donor tag:place/austin`). Answer from `tags.md` for one tag, or grep the
   frontmatter to intersect. The brackets match the whole tag, so `role/donor` does not also match
   `role/donor-major` (a `\b` boundary would):

   ```bash
   grep -lE "^tags:.*[[ ]role/donor[],]" <root>/*/*.md | xargs -r grep -lE "^tags:.*[[ ]place/austin[],]"
   ```

2. **Text queries.** Turn the query into terms and their obvious variants (`fish`, `fishing`,
   `angler`), check `tags.md` for a matching tag, and search every dossier with line numbers:

   ```bash
   grep -rinE "fish|angl" <root> --include='*.md' --exclude=index.md --exclude=README.md --exclude=tags.md
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

With no results, say so and suggest a broader query or a nearby tag from `tags.md`.

## Autotag

`/farley autotag <name>` re-tags one dossier; `/farley autotag` re-tags every dossier. Use it after
the tag rules change, or on files written before tagging existed.

1. Read `tags.md`, then each dossier in turn.
2. Apply **Tags** to its whole content. Add missing tags, fold synonyms into the existing tag, and
   remove only tags whose fact is gone.
3. Change nothing but the `tags:` line. Do not log autotagging in the interaction log.
4. Rebuild the views once at the end, and report per dossier what was added, merged or removed.

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
   and `issue/` tags) and **Rebuild the views**.
10. **Report:** the findings added with their sources, the possible matches left out and why, what
    was searched for and not found, and a reminder that the queries went to a search provider.

## Print

The report is an HTML page and nothing else. Do not create, convert to, or check it with a PDF.

1. **Find the dossier** (Step 1) and read all of it. Anything after the name is the **occasion or
   focus** (`print Jane Doe for Friday's gala`): show it on the report and order the talking points
   toward it. A context naming several people gets one report each.
2. **Build the report** from `print-template.html`. Keep its CSS and structure as they are, fill the
   placeholders, and delete any block the dossier has nothing for. "Before you walk in" carries the
   same content as **Brief**; "On file" carries the structured sections; "From public sources"
   carries `Research`; the log shows every entry, newest first. The report is a snapshot of the
   dossier; never edit a report to change what is on file.
3. **Keep it self-contained:** inline CSS only, system fonts, no scripts beyond the template's
   print hook, and no external requests of any kind. Escape `&`, `<` and `>` in dossier text. No
   em-dashes.
4. **Save it** as `<root>/<slug>/print/<slug>-<YYYY-MM-DD>.html`, adding a short occasion slug when
   one was given (`jane-doe-2026-09-18-gala.html`). Create `print/` if needed. Rerunning on the
   same day for the same occasion overwrites that file, which is intended: the latest dossier wins.
5. **Ask** with AskUserQuestion whether to print it now or just share the location. Name the Windows
   default printer in the question, from:

   ```bash
   powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Printer | Where-Object Default).Name"
   ```

6. **Print it now:** open the HTML in Windows Chrome with the print dialog up. The `#print`
   fragment triggers the template's print hook, and the operator picks the printer and clicks Print:

   ```bash
   powershell.exe -NoProfile -Command "Start-Process chrome.exe -ArgumentList 'file:///$(wslpath -m <report path>)#print'"
   ```

   Fall back to `msedge.exe` if Chrome is missing. Never print silently and never change the
   default printer. Tell the operator the dialog is waiting for them.
7. **Just the location:** give the WSL path, the Windows path (`wslpath -w`) and a `file:///` link.

## Privacy

This is sensitive personal information about real people who did not ask to be recorded.

- Dossiers and reports stay on this machine. Never publish them as an Artifact, never put them in
  Claude Docs, Google Drive, email or a band file, and never commit them to a repository.
- The only thing that leaves the machine is the search queries **Research** sends, and only when
  the operator invokes it.
- Tags never encode sensitive traits (see **Tags**), so the file cannot be used to list people by
  them.
- Do not quote a dossier into another project's files or conversations unless the operator asks.
- If the operator asks to remove a person, confirm, delete that folder, then rebuild the views.
````

## The supporting files

Five more files live beside `SKILL.md`, all in `~/.claude/skills/farley/`.

`template.md` is the shape of a new dossier. Frontmatter holds the fields the index reads; the headings are the order you skim in.
````markdown
---
name: {{Full Name}}
aliases: []
type: person
relationship: {{how the operator knows them, in a few words}}
first_met: {{YYYY-MM-DD}}
last_contact: {{YYYY-MM-DD}}
tags: []
---

# {{Full Name}}

## At a glance

{{One or two sentences: who they are and why they matter.}}

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

### {{YYYY-MM-DD}} · {{Place or context}}

- {{What happened}}
````

`root-readme.md` is the README that gets written into the dossier folder itself, so the folder explains itself to anyone who opens it in a year, including you. The command table between the markers is the one copy: edit it here and the sync script carries it over.
````markdown
# Farley File

A private dossier on the people we meet: names of spouses and children, hobbies, preferences, past
conversations, and where and when we met. Read a person's file before seeing them again so the
relationship picks up where it left off.

Each person or organization gets a folder holding one Markdown dossier (`jane-doe/jane-doe.md`),
printable HTML reports under `print/`, and anything else worth keeping, such as photos or business
cards.

The dossiers are the only place data lives. `index.md` (everyone on file) and `tags.md` (every tag,
and who carries it) are generated from them on every change, and the HTML reports are snapshots of
them. There is no database to maintain, and no PDFs.

<!-- farley:commands:start -->
## Commands

The global `/farley` skill maintains this folder from any project directory. `/farleyfile` is the
same skill under a second name, and takes the same commands.

| Command | What it does |
|---|---|
| `/farley` | Asks who or what you want, and shows this menu. |
| `/farley init` | Sets where the Farley File lives, or shows and changes the current location. |
| `/farley <name> <notes>` | Creates or updates the person's dossier, logs the meeting and tags it automatically. Plain sentences work too: `/farley Met Tom Ruiz at the fundraiser, his wife is Ana`. |
| `/farley brief <name>` | Reads the dossier back as a pre-meeting brief. `/farley <name>` alone does the same. |
| `/farley list` | Lists every name on file, with relationship and last contact. |
| `/farley search <query>` | Finds dossiers matching the query, such as `fly fishing` or `donors I met in March`. `tag:` terms match tags exactly, and several must all match: `tag:role/donor tag:place/austin`. Searches this folder only. |
| `/farley research <name> [focus]` | Searches the web for the person's public footprint and adds confirmed findings, with sources, under Research. |
| `/farley print <name> [occasion]` | Writes a printable HTML report to `<name>/print/`, then asks whether to print it now or just give you the location. |
| `/farley autotag [name]` | Re-tags one dossier, or every dossier when no name is given. Tagging already happens on every change; this is for catching up. |

Tags take the form `facet/value`, using six facets: `role`, `org`, `place`, `event`, `interest` and
`issue`. For example: `role/donor`, `place/austin`, `interest/fly-fishing`. Sensitive traits such as
health, religion or party are never tagged.

The skill lives in `~/.claude/skills/farley/`. Its storage location is in `config.json` there, and
the dossier and report layouts are `template.md` and `print-template.html`.
<!-- farley:commands:end -->

## Privacy

Everything here is personal information about real people. It stays on this machine: it is not a
git repository, and nothing in it should be published, synced or shared. The one exception is
`/farley research`, which sends a person's name and identifying details to a web search provider
when you run it.
````

`sync-readme.py` does that carrying. It replaces only the marked block, so notes you add to the folder README survive.
```python
#!/usr/bin/env python3
"""Keep <root>/README.md's command block in step with the skill's root-readme.md.

Usage: sync-readme.py <root>

Replaces only the text between the farley:commands markers, so anything the
operator wrote elsewhere in README.md survives. A missing README.md is created
from root-readme.md whole; one without markers gets the block appended.
Prints what it did: created, updated, appended or unchanged.
"""
import pathlib
import re
import sys

START = "<!-- farley:commands:start -->"
END = "<!-- farley:commands:end -->"
BLOCK = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)

source = (pathlib.Path(__file__).parent / "root-readme.md").read_text(encoding="utf-8")
block = BLOCK.search(source).group(0)
readme = pathlib.Path(sys.argv[1]) / "README.md"

if not readme.exists():
    readme.write_text(source, encoding="utf-8")
    print(f"created {readme}")
    sys.exit(0)

current = readme.read_text(encoding="utf-8")
match = BLOCK.search(current)
if match is None:
    readme.write_text(current.rstrip("\n") + "\n\n" + block + "\n", encoding="utf-8")
    print(f"appended {readme}")
elif match.group(0) == block:
    print(f"unchanged {readme}")
else:
    readme.write_text(current[: match.start()] + block + current[match.end():], encoding="utf-8")
    print(f"updated {readme}")
```

`build-index.py` regenerates `index.md` (everyone on file) and `tags.md` (every tag and who carries it) from the dossiers. Both are derived views, rewritten on every change, which is why nothing asks you to maintain a list.
```python
#!/usr/bin/env python3
"""Rebuild <root>/index.md and <root>/tags.md from the dossiers' frontmatter.

Usage: build-index.py <root>

The Markdown dossiers are the only store of record. Both files written here are
derived views and are overwritten on every run, so nobody edits them by hand.
A dossier is <root>/<slug>/<slug>.md; other Markdown files are ignored.
Prints a one-line summary, plus any dossier it could not read.
"""
import pathlib
import re
import sys

FACETS = ["role", "org", "place", "event", "interest", "issue"]
FRONT = re.compile(r"\A---\n(.*?)\n---\n", re.S)


def parse(text):
    match = FRONT.match(text.replace("\r\n", "\n"))
    if not match:
        return None
    meta = {}
    for line in match.group(1).splitlines():
        key, sep, value = line.partition(":")
        if not sep or line[:1].isspace():
            continue
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            meta[key.strip()] = [v.strip().strip("'\"") for v in value[1:-1].split(",") if v.strip()]
        else:
            meta[key.strip()] = value.strip("'\"")
    return meta


def cell(value):
    return str(value).replace("|", "\\|")


root = pathlib.Path(sys.argv[1])
people, skipped = [], []
for path in sorted(root.glob("*/*.md")):
    if path.stem != path.parent.name:
        continue
    meta = parse(path.read_text(encoding="utf-8"))
    if not meta or not meta.get("name"):
        skipped.append(path.relative_to(root).as_posix())
        continue
    people.append((meta, path.relative_to(root).as_posix()))
people.sort(key=lambda p: p[0]["name"].lower())

index = [
    "# Farley File index",
    "",
    "Generated from the dossiers by `/farley`. Edits here are overwritten; change the dossier instead.",
    "",
    "| Name | Type | Relationship | Last contact | Dossier |",
    "|---|---|---|---|---|",
]
for meta, rel in people:
    slug = pathlib.PurePosixPath(rel).stem
    index.append(
        f"| {cell(meta['name'])} | {cell(meta.get('type', ''))} | {cell(meta.get('relationship', ''))} "
        f"| {cell(meta.get('last_contact', ''))} | [{slug}]({rel}) |"
    )
(root / "index.md").write_text("\n".join(index) + "\n", encoding="utf-8")

tagged = {}
for meta, rel in people:
    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    for tag in dict.fromkeys(tags):
        tagged.setdefault(tag, []).append((meta["name"], rel))

by_facet = {}
for tag in sorted(tagged):
    facet = tag.split("/", 1)[0] if "/" in tag else "no facet"
    by_facet.setdefault(facet, []).append(tag)

lines = [
    "# Farley File tags",
    "",
    "Generated from the dossiers by `/farley`. Edits here are overwritten; change the dossier instead.",
    "Reuse a tag listed here before inventing a new one.",
    "",
]
order = [f for f in FACETS if f in by_facet] + sorted(f for f in by_facet if f not in FACETS)
for facet in order:
    lines += [f"## {facet}", ""]
    for tag in by_facet[facet]:
        names = ", ".join(f"[{name}]({rel})" for name, rel in tagged[tag])
        lines.append(f"- `{tag}` ({len(tagged[tag])}): {names}")
    lines.append("")
if not tagged:
    lines.append("No tags yet.")
(root / "tags.md").write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")

summary = f"indexed {len(people)} dossiers, {len(tagged)} tags"
if skipped:
    summary += f"; could not read frontmatter in: {', '.join(skipped)}"
print(summary)
```

`print-template.html` is the printable sheet: one page, no external requests, a brief block you can read standing up and the log underneath. The header says Private and the footer says do not leave this behind, which is the right amount of paranoia for a sheet about someone that you carry into a room with them.
```html
<!doctype html>
<!--
  Farley File print template. The /farley skill copies this file and fills it in.
  - Keep the <style> and the print hook script exactly as they are.
  - Replace every {{placeholder}}. Delete any block, list item or section the dossier has nothing for.
  - Escape &, < and > in dossier text. No em-dashes. No external requests: no fonts, images or scripts from the web.
  - Delete these instruction comments from the finished report.
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{Full Name}} · Farley File</title>
<style>
  :root {
    --ink: #1c1e22;
    --muted: #5b6270;
    --rule: #d3d8e0;
    --accent: #1e4a73;
    --wash: #f2f5f9;
    --sans: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    --serif: Georgia, Cambria, "Times New Roman", serif;
  }
  @page {
    size: letter;
    margin: 0.6in 0.65in 0.75in;
    @bottom-left { content: "Farley File · Private"; font: 8pt "Segoe UI", system-ui, Arial, sans-serif; color: #5b6270; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt "Segoe UI", system-ui, Arial, sans-serif; color: #5b6270; }
  }
  * { box-sizing: border-box; }
  html { background: #e6e9ee; }
  body {
    margin: 24px auto;
    max-width: 8.5in;
    padding: 0.6in 0.65in;
    background: #fff;
    color: var(--ink);
    font: 10.5pt/1.45 var(--serif);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  }
  h1, h2, h3, .kicker, dt, .src, footer, .print-button { font-family: var(--sans); }
  .print-button {
    position: fixed; top: 16px; right: 16px;
    padding: 8px 16px; border: 0; border-radius: 6px;
    background: var(--accent); color: #fff; font-size: 14px; cursor: pointer;
  }

  .masthead { border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 16px; }
  .kicker { margin: 0; font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  h1 { margin: 2px 0 4px; font-size: 24pt; line-height: 1.1; font-weight: 700; }
  .standfirst { margin: 0 0 10px; font-size: 11.5pt; color: var(--muted); }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; margin: 0; }
  .meta div { min-width: 0; }
  dt { font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  dd { margin: 1px 0 0; font-size: 10pt; }

  h2 {
    margin: 18px 0 8px; padding-bottom: 3px;
    font-size: 10pt; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--accent); border-bottom: 1px solid var(--rule);
    break-after: avoid;
  }
  h3 { margin: 0 0 4px; font-size: 9.5pt; font-weight: 600; break-after: avoid; }
  ul { margin: 0; padding-left: 1.1em; }
  li { margin: 1px 0; }
  p { margin: 0 0 6px; }

  .brief { background: var(--wash); border-left: 3px solid var(--accent); padding: 10px 14px 12px; break-inside: avoid; }
  .brief h2 { margin-top: 0; border-bottom-color: #c9d3df; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; }
  .grid > div { break-inside: avoid; min-width: 0; }
  .avoid { margin: 10px 0 0; }
  ul.checks { list-style: none; padding-left: 0; }
  ul.checks li::before { content: "\2610\00a0"; }
  ul.checks li.done::before { content: "\2611\00a0"; }
  ul.checks li.done { color: var(--muted); }

  .src { color: var(--muted); font-size: 8pt; white-space: nowrap; }

  .entry { padding: 6px 0; border-top: 1px solid var(--rule); break-inside: avoid; }
  .entry:first-of-type { border-top: 0; padding-top: 0; }
  .entry h3 time { color: var(--accent); }

  footer { margin-top: 20px; padding-top: 6px; border-top: 1px solid var(--rule); font-size: 8pt; color: var(--muted); }

  @media (max-width: 640px) {
    body { margin: 0; padding: 20px 16px; box-shadow: none; }
    .meta { grid-template-columns: 1fr 1fr; }
    .grid { grid-template-columns: 1fr; }
    .src { white-space: normal; }
  }
  @media print {
    html { background: none; }
    body { margin: 0; max-width: none; padding: 0; box-shadow: none; }
    .print-button { display: none; }
    .brief { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<button class="print-button" type="button" onclick="window.print()">Print</button>

<header class="masthead">
  <p class="kicker">Farley File · Private</p>
  <h1>{{Full Name}}</h1>
  <p class="standfirst">{{At a glance: who they are and why they matter}}</p>
  <dl class="meta">
    <div><dt>Relationship</dt><dd>{{relationship}}</dd></div>
    <div><dt>First met</dt><dd>{{first_met}}</dd></div>
    <div><dt>Last contact</dt><dd>{{last_contact}}</dd></div>
    <div><dt>Prepared</dt><dd>{{YYYY-MM-DD}}<!-- when an occasion was given: <br>for {{occasion}} --></dd></div>
  </dl>
</header>

<section class="brief">
  <h2>Before you walk in</h2>
  <div class="grid">
    <div>
      <h3>Names to remember</h3>
      <ul>
        <li>{{Spouse: Tom}}</li>
      </ul>
    </div>
    <div>
      <h3>Last time</h3>
      <p>{{YYYY-MM-DD, place: what was discussed}}</p>
    </div>
    <div>
      <h3>Open threads</h3>
      <ul class="checks">
        <li>{{Unchecked follow-up}}</li>
        <li>{{Something they were about to do that is worth asking about}}</li>
      </ul>
    </div>
    <div>
      <h3>Talking points</h3>
      <ul>
        <li>{{Interest or preference worth raising}}</li>
      </ul>
    </div>
  </div>
  <p class="avoid"><strong>Avoid:</strong> {{topics to steer clear of}}</p>
</section>

<section>
  <h2>On file</h2>
  <div class="grid">
    <div><h3>Identity</h3><ul><li>{{Role and organization}}</li></ul></div>
    <div><h3>Family</h3><ul><li>{{Spouse or partner, children, pets}}</li></ul></div>
    <div><h3>Interests and preferences</h3><ul><li>{{fact}}</li></ul></div>
    <div><h3>Background</h3><ul><li>{{fact}}</li></ul></div>
    <div><h3>Topics and positions</h3><ul><li>{{fact}}</li></ul></div>
    <div><h3>Connections</h3><ul><li>{{name and how they connect}}</li></ul></div>
  </div>
  <h3 style="margin-top: 12px">Follow-ups</h3>
  <ul class="checks">
    <li>{{open follow-up}}</li>
    <li class="done">{{completed follow-up (done YYYY-MM-DD)}}</li>
  </ul>
</section>

<section>
  <h2>From public sources</h2>
  <ul>
    <li>{{finding}} <span class="src">{{source domain}}, retrieved {{YYYY-MM-DD}}</span></li>
  </ul>
</section>

<section>
  <h2>Interaction log</h2>
  <article class="entry">
    <h3><time>{{YYYY-MM-DD}}</time> · {{place or context}}</h3>
    <ul><li>{{what happened}}</li></ul>
  </article>
</section>

<footer>Prepared {{YYYY-MM-DD}} from {{slug}}.md. Private: do not leave this behind.</footer>

<script>
  if (location.hash === "#print") {
    window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });
  }
</script>
</body>
</html>
```

`config.json` is written by `/farley init` and holds one line, the absolute path to your dossier folder:

```json
{"root": "/home/you/farley"}
```

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

The dossier sections in `template.md` are the other place to edit. They are ordered the way you skim before a meeting, so if you always want one thing first, move it and the agent follows.

The skill writes no em dashes, in Markdown or HTML, because of a global writing rule of mine. Drop that line if it is not yours.
