---
title: '/KIMI2 : An Agent Skill for Drafting with Kimi'
slug: kimi2-skill-for-claude-code
shortDescription: >-
  A /kimi2 skill for Claude Code that hands drafting to Kimi from inside a session, against a written
  voice record and under a byline the agent is never allowed to guess. It refuses to invent
  first-person material, leaving a marker where real material is missing instead.
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
  - writing
  - drafting
  - workflow
type: prompt
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command. **`/kimi2`** uses that hook to hand drafting work to Kimi from inside a session. It also answers to `/kimi`, so either slash command starts the same flow. The agent handles the mechanical work around the request, so you stay in the same terminal without breaking flow to open a browser or copy text between windows.

This is a division of labour. The drafting model works from a documented **voice record** rather than a generic set of instructions. That record is a long markdown file describing how the operator writes: their tells, prohibitions, and preferences. Because the agent that commissions the draft is not the one that reviews it, the model writing can be held to a specific voice while the agent running the session stays focused on context and execution. You brief the agent, the agent briefs Kimi, and the result is a draft you review before it goes anywhere. The default model is `kimi-k2.6`. You can name the flagship model for one piece instead, though that costs roughly three times as much and its thinking cannot be turned off.

### What it does

| Command | What it does |
|---|---|
| `/kimi2 status` | The agent checks the key and the voice record are in place without printing the key. |
| `/kimi2 write` | The agent builds the request from a brief, the named byline, the voice record and any material files, and writes the draft to a path you name. |
| `/kimi2 rewrite` | The same call against an existing draft, frontmatter held back and reattached, with no fact, figure, link, quote or first-person statement changed. |
| Setup | Put the API key in an environment variable read from the shell profile rather than in the chat. |

The output path is required, and an existing file is never overwritten.

### The two rules it enforces

The first rule is that the **byline** is chosen, not guessed. Every call to `write` or `rewrite` names exactly one byline, and the skill refuses to run if one is missing. A missing byline is an error rather than a silent default, because a draft under the wrong name is a misattribution with a real person's name on it. There is no fallback to a generic voice and no silent assumption that the current project is the speaker. The skill also refuses to write a bylined draft when the voice record is missing, unless the user says to go ahead without one.

The second rule is that the model does not invent first-person material. The prompts bar fabricated motivation, anecdotes, quotes, opinions, and facts. Where real material is missing, the model leaves a **[NEEDS]** marker. The agent reports every marker with its line number and does not fill one in itself. The fix is to supply real material files and rerun. This rule exists because a fabricated origin story shipped under a real byline in July 2026. The skill treats a gap as recoverable and a filled-in lie as a failure. That is why real material files are the only source of facts and first-person statements for a write, and why the rewrite prompt forbids changing any fact, figure, link, quote, or first-person statement.

### What the skill checks before it reports back

The agent post-processes every draft before writing it to disk. If the model produced any em dashes, the agent sends the piece back once with a narrow repair instruction rather than substituting a different dash character, because swapping one dash for another is the same construction in disguise. Any that survive are named in the report. Curly quotes are straightened without a model call. An outer code fence or preamble around the draft is removed. The final report states where the draft is, its length, every `[NEEDS]` marker verbatim, and anything flagged as truncated or still present. It also names any em dashes that survived the repair pass. You get the draft and a summary of what still needs attention in one step.

### Install

1. Create the folder `.claude/skills/kimi2`.
2. Save the `SKILL.md` file there.
3. Put the API key in an environment variable read from the shell profile rather than passing it through the chat transcript.
4. Check that everything is ready with `/kimi2 status`.

If you are working in a team, there is also a relay setup: a small service on a private network holds the key so client machines hold nothing. The clients reach the relay by name, and the key does not leave the one host.

This published version is the simplified one: the author runs a command line version of the same skill privately, and the file here has no dependency on it.

### The honest limitation

A model applying a voice record to its own draft is a first pass, not a review. A single writer checking its own work against rules it was just handed is exactly the failure an independent review exists to catch, so a draft goes through a separate review before anything ships. The voice record is roughly 30,000 tokens and rides along with every call, and while the API caches repeated prefixes, the overhead is still real enough that thinking can be turned off for short pieces where the reasoning time is not worth the trade.

## The skill file

Save this as `~/.claude/skills/kimi2/SKILL.md`.

````markdown
---
name: kimi2
description: >-
  Hand drafting and rewriting work to Kimi from inside a Claude Code session. The agent should invoke this skill when the user says /kimi2 write, /kimi2 rewrite, /kimi, or any plain request for Kimi to draft or revise a piece. The output is always a draft file for the user to review; nothing ships automatically.
allowed-tools: Bash, Read, AskUserQuestion
---

# kimi2

Kimi drafts, and a person decides what ships. The output is always a draft.

## Two rules that outrank everything else here

These two rules override every other instruction in this file.

The byline is chosen, never guessed. Every draft names exactly one byline. If the user has not said which, ask with AskUserQuestion. Never infer it from the topic or from last time.

Kimi never invents first-person material, and neither does the agent. The request tells Kimi to leave a `[NEEDS: ...]` marker wherever real material is missing. The agent reports every marker to the user verbatim and never fills one in. The fix is real material from the user, then a rerun.

## Setup

1. The API key lives in an environment variable, `KIMI_API_KEY`, read from the user's shell profile. It is never pasted into the chat transcript.
2. Before running, check that the variable is set and non-empty without printing its value. If it is missing, stop and ask the user to configure it.
3. The voice record is optional. It is a markdown file the user provides once, describing how they write. Without a voice record the draft is generic. The skill should refuse a bylined draft rather than guess a voice.

A team can put the key behind a small service on a private network instead of on every machine.

## Write a draft

This is the exact bash the agent runs. The output path is a required argument. Refuse to overwrite an existing file.

```bash
if [ -f "$OUT" ]; then
  echo "Output file already exists: $OUT"
  exit 1
fi

{
  echo "You are a drafting writer for the byline: $BYLINE."
  echo "Rule 1: Never invent first-person material. Do not invent motivation, anecdotes, quotes, opinions, or experiences. If material is missing, leave a [NEEDS: ...] marker."
  echo "Rule 2: Follow the voice record below. It describes how this author writes."
  echo ""
  echo "Voice record:"
  cat "$VOICE_RECORD" 2>/dev/null || echo "No voice record provided."
  echo ""
  echo "Brief:"
  echo "$BRIEF"
  echo ""
  echo "Materials:"
  for f in $MATERIAL_FILES; do
    echo "File: $f"
    cat "$f"
    echo ""
  done
} > /tmp/kimi-system.txt

echo "Write the draft." > /tmp/kimi-user.txt

jq -Rs . < /tmp/kimi-system.txt > /tmp/kimi-system.json
jq -Rs . < /tmp/kimi-user.txt > /tmp/kimi-user.json

cat > /tmp/kimi-req.json << EOF
{
  "model": "kimi-k2.6",
  "messages": [
    {"role": "system", "content": $(cat /tmp/kimi-system.json)},
    {"role": "user", "content": $(cat /tmp/kimi-user.json)}
  ]
}
EOF

curl -s https://api.moonshot.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KIMI_API_KEY" \
  -d @/tmp/kimi-req.json | jq -r '.choices[0].message.content' > "$OUT"
```

## Rewrite an existing draft

The call is the same, but the system message carries an existing draft and instructions to rewrite it. YAML frontmatter is held back from the model and reattached unchanged. The rewrite must not change any fact, figure, link, quote or first-person statement.

```bash
if [ -f "$OUT" ]; then
  echo "Output file already exists: $OUT"
  exit 1
fi

# Hold back YAML frontmatter, the closing fence included, when the file opens with one.
if head -n 1 "$IN" | grep -qx -- '---'; then
  FM_END=$(awk 'NR > 1 && /^---$/ { print NR; exit }' "$IN")
  head -n "$FM_END" "$IN" > /tmp/kimi-fm.txt
  tail -n +"$((FM_END + 1))" "$IN" > /tmp/kimi-body.txt
else
  : > /tmp/kimi-fm.txt
  cp "$IN" /tmp/kimi-body.txt
fi

{
  echo "You are a drafting writer for the byline: $BYLINE."
  echo "Rule 1: Never invent first-person material."
  echo "Rule 2: Follow the voice record below."
  echo ""
  cat "$VOICE_RECORD" 2>/dev/null || echo "No voice record provided."
  echo ""
  echo "Rewrite instructions: $INSTRUCTIONS"
  echo ""
  echo "Existing draft body:"
  cat /tmp/kimi-body.txt
} > /tmp/kimi-system.txt

echo "Rewrite the draft. Do not change any fact, figure, link, quote, or first-person statement." > /tmp/kimi-user.txt

jq -Rs . < /tmp/kimi-system.txt > /tmp/kimi-system.json
jq -Rs . < /tmp/kimi-user.txt > /tmp/kimi-user.json

cat > /tmp/kimi-req.json << EOF
{
  "model": "kimi-k2.6",
  "messages": [
    {"role": "system", "content": $(cat /tmp/kimi-system.json)},
    {"role": "user", "content": $(cat /tmp/kimi-user.json)}
  ]
}
EOF

curl -s https://api.moonshot.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KIMI_API_KEY" \
  -d @/tmp/kimi-req.json | jq -r '.choices[0].message.content' > /tmp/kimi-new.txt

if [ -s /tmp/kimi-fm.txt ]; then
  cat /tmp/kimi-fm.txt > "$OUT"
  echo "" >> "$OUT"
  cat /tmp/kimi-new.txt >> "$OUT"
else
  cat /tmp/kimi-new.txt > "$OUT"
fi
```

## Check the draft before reporting it

The agent runs this checklist every time a draft returns.

1. Grep for em dashes and en dashes. If any appear, send the piece back once for a narrow repair rather than substituting a different dash.
2. Straighten curly quotes with sed.
3. Strip an outer code fence or any preamble the model added.
4. List every `[NEEDS: ...]` marker with its line number.

## What to tell the user

The report to the user states where the draft is saved, its word count, every `[NEEDS: ...]` marker verbatim, and anything that survived the dash repair. Do not paste the draft into the chat unless the user asks.

## What leaves the machine

The brief, the materials, the draft and the full voice record go to the model provider. That suits work written for publication. Anything confidential needs a decision first. Never send a file that holds a credential.

## Closing note

This skill produces a first pass, not a reviewed piece. A separate review belongs between this output and publication.
````
