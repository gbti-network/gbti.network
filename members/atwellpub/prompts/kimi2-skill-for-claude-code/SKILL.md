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
