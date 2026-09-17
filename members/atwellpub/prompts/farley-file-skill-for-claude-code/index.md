---
title: '/FARLEY : An Agent Skill for Remembering People'
slug: farley-file-skill-for-claude-code
shortDescription: >-
  Named for the files Jim Farley kept for Franklin Roosevelt, and borrowed from Robert Heinlein's
  science fiction novel "Double Star".  The /farley claude code skill helps maintain a "Farley File"
  from their agentic interface.
categories:
  - ai
  - prompts
  - skill
status: published
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
image: ./images/farleyfile.jpg
publishedAt: '2026-09-17T20:05:27.945Z'
updatedAt: '2026-09-17T23:11:30.852Z'
type: prompt
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill").   

This Claude Code skill offers your agent an `/farley` command that helps keep track of memorable data you learn about the people you meet. This is for those who network with many people and would like to be able to record and recall details that may otherwise slip the memory.

The name comes from James Farley, Franklin Roosevelt's campaign manager and later Postmaster General, who kept a file on everyone the two of them met: family, work, the last conversation. Before a return visit he read it, and a man who had shaken his hand once, a year earlier, got asked about a family member by name.

I came across this concept while reading Robert Heinlein's *Double Star*, where an actor stands in for a politician and survives the handshakes because the politician's staff keeps exactly that file. Heinlein named it after Farley, and the 1956 novel is how most people who keep one first heard of the idea.

## What it does

`/farley` takes a mode as its first word, and `/farleyfile` is the same skill under a second name.

| Command | What it does |
| --- | --- |
| `/farley <name> <notes>` | Creates or updates that person's dossier, logs the meeting, and tags it. Plain sentences work: `/farley Met Tom Ruiz at the fundraiser, his wife is Ana`. |
| `/farley brief <name>` | Reads the notes back as a pre-meeting brief: names, last conversation, open threads, what to raise, what to avoid. |
| `/farley search <query>` | Finds people by text (`fly fishing`) or by tag (`tag:role/donor tag:place/austin`). Local only, plain grep. |
| `/farley research <name>` | Searches the web for their public footprint and records confirmed findings with sources, in their own section. |
| `/farley list`, `/farley autotag`, `/farley init` | Everyone on file; re-tag one dossier or all of them; set where the file lives. |

## Install

1. Create `~/.claude/skills/farley/`.
2. Save the file below into it as `SKILL.md`. That is the whole skill.
3. Run `/farley init`. It asks where the dossiers should live, creates the folder, and writes `config.json`. Pick somewhere outside every git repository.
4. Type `/farley` and it shows you the menu.

## The skill file

Save this as `~/.claude/skills/farley/SKILL.md`.

````markdown
---
name: farley
description: >
  Keep the Farley File: a private set of notes about people and organizations the user knows or works with.
  Invoke for "/farley" or "/farleyfile" with any of: init, list, search <search>, research <name>,
  autotag [name], brief <name>, or a name followed by notes. Also for "add this to the farley file",
  "I just met <name>", "note that <name> works with ...", "brief me on <name>", or "who do we
  know who ...". Stores one Markdown record per person or organization, adds useful tags, searches
  those records, and looks up public professional information on the web only when asked. With no
  arguments it asks what the user wants. Works from any project directory; the storage location is
  set once with "/farley init".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---


# /farley: the Farley File


A Farley File is a private set of notes about people and organizations the user knows or works with. It keeps useful context from real interactions, such as roles, interests, past conversations, shared work, associates, and follow-ups. Before meeting again, the user can review the record so the conversation can pick up where it left off.


`/farleyfile` is the same skill under a second name.


## Storage


**Markdown is the only place the notes are stored.** Each person or organization gets a folder
with one Markdown record. The user may keep related material beside it, such as a business card,
meeting notes, or a document. There is no database or background service. Search uses plain text.


```
<root>/
  jane-doe/
    jane-doe.md            the record (the only file that holds data)
    (optional related files: business cards, meeting notes, documents)
```


The location of `<root>` is the one setting, kept in `config.json` beside this file:
`{"root": "<absolute path>"}`. **Init** writes it and nothing else does.


## Step 0: find the Farley File folder (every command)


Read `config.json`. Its `root` value is the folder every command reads and writes, no matter which
project is open. Below, `<root>` means that folder. Use the full path in commands because shell
variables do not carry between calls.


If `config.json` is missing, has no `root`, or the folder no longer exists, tell the user no
Farley File folder is set, run **Init** first, then carry on with what they asked for.


## Pick the command from `$ARGUMENTS`


The first word decides. A person who happens to be named "List" is written as `/farley brief List`
or with notes after the name.


| Arguments | What to do |
|---|---|
| empty | **Ask.** Ask what the user wants to do. |
| `init` | **Init.** Set or change the storage location. |
| `list` | **List.** Every name on file. |
| `search <search>` | **Search.** Find records by text or `tag:`. Local only. |
| `research <name> [focus]` | **Research.** Look up relevant public professional information. |
| `autotag [name]` | **Autotag.** Re-tag one record, or every record when no name is given. |
| `brief <name>`, `prep <name>`, or a bare name | **Brief.** Read the record back for a meeting. |
| a name plus information about them, or a plain sentence | **Record.** Create or update the record. |


If a command is missing what it needs (`/farley search`, for example), ask only for the missing
name or search terms.


## Ask


Do nothing else yet. Reply with a short question asking who or what this is about, and show the
menu so the user can answer in one line:


```
Who is this about, and what should I do?
  <name> <notes>            record what you learned
  brief <name>              read a record back before a meeting
  search <search>            find people by text, or by tag:place/austin
  research <name>           look up relevant public information
  autotag [name]            re-tag one record, or all of them
  list                      everyone on file
  init                      set where the Farley File lives
```


End the turn there. Treat the user's next message as the arguments and pick the command from it.


## Init


1. Read `config.json`.
2. **A root is already set:** say where it is and how many records it holds. Ask with
   AskUserQuestion whether to keep it or change it. Keep ends here.
3. **No root yet, or the user chose to change it:** ask for the location with AskUserQuestion.
   Offer the current working directory and `~/farley` as options; the user can type any other
   path through "Other".
4. Normalize the answer: `~` expands to the home directory, and the result must be absolute. On WSL,
   a Windows path (`D:\Brain\farley`) becomes a WSL path with `wslpath -u`.
5. Create the folder if needed (`mkdir -p`), and write `config.json` as
   `{"root": "<absolute path>"}`.
6. **Changing from an old root that holds records:** ask whether to move them to the new location
   or leave them where they are. Move only on a yes, with `mv`, and never delete anything.
7. Report the new location.


## Step 1: find the person or organization (Record, Brief, Research, Autotag)


1. Make the **folder name** from the name: lowercase it, remove accents, titles and suffixes
   (Dr, Rep, Sen, Mr, Ms, Jr, III), remove apostrophes and periods, and replace spaces with hyphens.
   `Dr. María O'Neil` becomes `maria-oneil`. `The Acme Foundation` becomes `acme-foundation`.
2. Look for an existing record before creating one. Check the folder list, then the `name:` and
   `aliases:` lines of every record, without caring about capitalization, so a nickname, alternate name, or first name
   alone still finds the right person:


   ```bash
   ls <root>
   grep -iE "^(name|aliases):" <root>/*/*.md 2>/dev/null
   ```


3. Decide:
   - **One clear match:** use it.
   - **No match:** Record creates `<folder-name>/<folder-name>.md` from the layout below. The other
     commands say no record exists and ask whether to start one. Never create an empty file.
   - **Several plausible matches** (two Johns, or "Sarah" alone): ask with AskUserQuestion, listing
     each possible match with their role and last contact. Never guess and merge two people.
   - **Same name, different person:** add a short identifying word to the folder name from what the
     notes give (`john-smith-austin`, `john-smith-acme`), and say so.


## Record


Read the whole record first, then edit it in place. Never rewrite it from memory. A new record 
takes this shape, with the headings kept even when empty, so every file reads the same way:


```markdown
---
name: Jane Doe
aliases: []
type: person
relationship: how the user knows them, in a few words
first_met: 2026-09-16
last_contact: 2026-09-16
tags: []
---


# Jane Doe


## At a glance


One or two sentences: who they are and why they matter.


## About


- Role and organization:
- Location:
- Contact:
- Relevant details:


## Associates


## Interests and preferences


## Background


## Topics and positions


## Connections


## Follow-ups


## Research


## Interaction log
```


**Sections.** Put each new fact under the heading where someone reviewing the record before a
meeting would expect to find it. Add a bullet and do not repeat something already recorded.
Only **Research** writes to the `Research` section.


**The interaction log** keeps a simple history of what happened. Add one entry per meeting or note,
**newest first**, directly under `## Interaction log`:


```markdown
### 2026-09-16 · Rotary lunch, Austin
- What was said, done or learned, in the user's own words where possible.
- Anything they asked for, offered, or promised.
```


If the notes are not about a meeting (a fact heard secondhand, a correction), log it as
`### 2026-09-16 · Note` and name the source if the user gave one.


**Details at the top of the file.** Keep them current on every write: add new names or nicknames to
`aliases`, set `last_contact` to the date of the newest real interaction (not a secondhand note or
research), and set `first_met` only once. Keep `aliases` and `tags` as one-line lists
(`tags: [role/donor, place/austin]`) because the search commands read that format.


**Then tag it:** apply **Tags** to the record.


### Rules that keep the file trustworthy


- **Record only what the user supplied.** Do not infer, embellish, or fill gaps. The web is used
  only by **Research**, and only when the user invokes it.
- **Pronouns:** use the ones the user used. If none were given, write around them or use
  they/them. Never infer them from a name.
- **Absolute dates only.** Convert "yesterday", "last Tuesday", "next month" against today's date.
  If no meeting date is given, use today and say so in the reply.
- **Never delete a fact.** When new information contradicts old, write the new value and keep the
  old one beside it with its date: `Works at Dell (previously HP, noted 2026-03-02)`.
- **Keep uncertainty visible.** "I think she now works at UT" becomes
  `May now work at UT (unconfirmed)`.
- **Follow-ups are checkboxes.** Promises made in either direction become `- [ ] Send Tom the grant
  deadline (promised 2026-09-16)`. When the user reports one done, tick it and add the date; do
  not remove it.
- **Associates mentioned in the notes.** Colleagues, collaborators, assistants, contacts, and other
  associates mentioned in passing go under `Associates` or `Connections`. Give someone their
  own record only if the notes are substantially about them too, or the user asks. When both people
  have records, link the two records to each other (`[Ana Ruiz](../ana-ruiz/ana-ruiz.md)`) in each file's
  `Connections`.
- **Write no em-dashes** in any file this skill writes, per the global writing rule. Use commas,
  colons, parentheses or a new sentence. The `·` in log headings is fine.


Report briefly: the record path and whether it was **created** or **updated**, a few bullets of what
was added, the tags added, any conflicting information kept, any assumption made (for example, using
today when no date was given), and this person's open follow-ups. Do not repeat the whole record.


## Tags


Tags help the file answer questions like "who do I know who..." without a database. They are added
automatically on every **Record**, **Research** and **Autotag**; the user never has to ask.


**Tag format:** `group/value`, lowercase with hyphens: `place/travis-county`, `interest/fly-fishing`.


| Group | For | Examples |
|---|---|---|
| `role` | how they relate to the user or their work | `role/donor`, `role/volunteer`, `role/press`, `role/staff`, `role/elected-official` |
| `org` | organizations they belong to or lead | `org/literacy-council`, `org/dell` |
| `place` | where they live, work or are active, online communities included | `place/austin`, `place/district-7`, `place/reddit` |
| `event` | where the user met or saw them | `event/rotary-lunch`, `event/2026-literacy-gala` |
| `interest` | hobbies and passions | `interest/fly-fishing`, `interest/jazz` |
| `issue` | policy areas they care about or work on | `issue/school-funding`, `issue/water-rights` |


**Rules:**


1. **Reuse before inventing.** Read the tags already in use and pick an existing one when it fits,
   so `interest/fishing` does not gain a rival `interest/angling`:


   ```bash
   grep -h "^tags:" <root>/*/*.md | tr -d '[]' | tr ',' '\n' | sed 's/^tags://' | tr -d ' ' | sort -u
   ```


2. **Tag only what the record says.** Every tag must trace to a line in the file. Remove a tag
   only when the fact behind it is gone or superseded, and say so.
3. **Stay within these six tag groups.** If a tag fits none of them, it usually belongs in the notes instead.
4. **Never use sensitive personal information as a tag:** health, religion, ethnicity, sexual
   orientation, immigration status, political party, or anything similar. If the user chose to
   record such a fact, keep it only in the notes. Never make it a way to group or list people.
5. **A handful per record.** Tags that would match almost everyone on file (`place/texas` for a
   Texas office) add nothing; prefer the more specific one.


## List


Read the details at the top of every record and return **every** name, alphabetically, one per
line, with relationship and last contact after it, and the total at the end:


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


Local only. This command never uses the web and never edits a record. It searches the Markdown files
on this machine with `grep`.


1. **Tag searches.** `tag:place/austin` finds records carrying that tag. Several `tag:` terms mean
   all of them (`tag:role/donor tag:place/austin`). The brackets match the whole tag, so
   `role/donor` does not also match `role/donor-major` (a `\b` boundary would):


   ```bash
   grep -lE "^tags:.*[[ ]role/donor[],]" <root>/*/*.md | xargs -r grep -lE "^tags:.*[[ ]place/austin[],]"
   ```


2. **Text searches.** Turn the search into a few obvious related words (`fish`, `fishing`,
   `angler`), and search every record with line numbers:


   ```bash
   grep -rinE "fish|angl" <root> --include='*.md'
   ```


3. **Date and relationship searches.** Use the details at the top (`relationship`, `first_met`, `last_contact`)
   and dated log headings (`### YYYY-MM-DD`) for questions like "everyone I met in March" or "people
   I have not spoken to since spring". For "who knows Ana Ruiz", search for links to her record:
   `grep -l "ana-ruiz/ana-ruiz.md" <root>/*/*.md`.
4. Open the matching records and make sure each one really answers the search. Ignore accidental
   matches.
5. Return the most useful matches as a numbered list, at most 15 (say how many more there are):


   ```
   1. Jane Doe (donor, Travis County; last contact 2026-09-16)
      Interested in fly fishing and mentioned going on the Llano with Tom.
      <root>/jane-doe/jane-doe.md:24
   ```


With no results, say so and suggest a broader search or a nearby tag already in use.


## Refresh tags (`autotag`)


`/farley autotag <name>` re-tags one record; `/farley autotag` re-tags every record. Use it after
the tag rules change, or to update older records that were created before tags were added.


1. Read the tags already in use, then each record in turn.
2. Apply **Tags** to its whole content. Add missing tags, reuse an existing tag when two tags mean the same thing, and
   remove only tags whose fact is gone.
3. Change nothing but the `tags:` line. Do not add this cleanup work to the interaction log.
4. Report per record what was added, merged or removed.


## Brief


Read the record and give a short pre-meeting brief:


1. **Who:** one line with their role, organization, how you know them, and when you first met.
2. **People to remember:** relevant associates, colleagues, assistants, collaborators, or contacts.
3. **Last time:** the date, place, and what you discussed.
4. **Open threads:** unfinished follow-ups, things they were waiting on, or upcoming work and events
   that are worth asking about.
5. **Talking points:** useful interests, preferences, and subjects connected to the relationship.


Draw only from the file. Anything taken from `Research` is labelled as coming from public sources.
If the file is thin, say so rather than padding the brief.


## Research


This command searches the web only when the user explicitly asks for it. It sends the person's name
and enough context to distinguish them from people with the same name.


1. **Find the record** (Step 1). With no record, ask for enough context to identify the right person,
   such as where they work, their role, organization, or how the user knows them, and whether to start
   a record for the results. Never search a bare name with no identifying context.
2. **Load web search:** `ToolSearch` with `select:WebSearch,WebFetch`.
3. **Collect useful context** from the record: organization, role, city, known associates, and
   events. Any focus given after the name (`research Jane Doe literacy work`) guides the searches.
4. **Search** using the name together with that context, and open the pages that look
   relevant.
5. **Confirm it is the right person.** A result counts only when it matches the name **and** at least
   one piece of that context. If you are not sure, report the possible match but do not add it to the
   record.
6. **Look only for relevant public information:** current role and work history, organizations and
   boards, public statements, news coverage, awards, published work, professional profiles, and
   public records connected to a public or professional role.
7. **Do not look for or record** a home address, personal phone number or email, date of birth,
   health information, personal finances, or private details about associates. Do not use
   people-search or data-broker sites, and do not try to get past a login or paywall.
   **People known only by a handle** (a Reddit or forum username): research only what they publish
   under that handle. Do not try to discover their real name. Do not assume the same handle on another
   site belongs to the same person unless the record already gives enough context to confirm it. If
   they publicly connect the handle to their own name, that link may be recorded.
   **Blocked sites:** WebFetch cannot reach reddit.com (old or new). Do not work around a block with
   curl or a browser; record that the site could not be read, and suggest the user paste or
   screenshot what they want kept.
8. **Write** confirmed findings as bullets under `## Research`, each with its source and date:


   ```markdown
   - Chairs the Travis County Literacy Council board ([Austin Chronicle](https://...), retrieved 2026-09-16)
   ```


   Do not duplicate an existing bullet; when a finding updates one, keep both with their dates. Do
   not copy findings into the firsthand sections. If a finding contradicts something the user
   recorded, leave the firsthand fact alone and raise it in the reply.
9. **Log it** as `### 2026-09-16 · Web research` with one line: how many findings were added and the
   focus, if any. Do not change `last_contact`. Apply **Tags** (confirmed findings may add `org/`
   and `issue/` tags).
10. **Report:** say what was added and where it came from, which possible matches were left out and
    why, what was searched for but not found, and remind the user that the web searches were sent to
    a search provider.


## Privacy


These records contain private notes about real people and organizations, so keep them limited,
relevant, and local.


- Records stay on this machine. Never publish them as an Artifact, put them in Claude Docs,
  Google Drive or email, or commit them to a repository.
- **Research** is the only command that sends anything to the web, and only when the user asks for it.
- Never use sensitive personal information as a tag.
- Do not copy a record into another project or conversation unless the user asks.
- If the user asks to remove a record, confirm first, delete that folder, then say what was deleted.
````
