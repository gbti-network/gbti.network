---
id: intro-author-a-gbti-sow
targetType: prompt
targetSlug: author-a-gbti-sow
createdAt: '2026-07-04T03:02:19.326Z'
status: published
visibility: public
authorNote: true
type: comment
author: atwellpub
---

A Claude Code skill for authoring and managing Statements of Work (SOWs) as local, lane-based planning documents.

**`/sow init`** scaffolds the framework in the current project. It is idempotent and builds folders only, so it never authors a SOW:

- creates the lane folders `0_queue`, `1_progressing`, `2_waiting_review`, and a `_staging` side-lane
- creates a `todo.md` when one is missing, and never overwrites an existing one
- keeps the `.data/` planning folder out of version control

**`/sow "<request>"`** authors or updates a SOW from a plain-language request, for example `/sow "add a SOW for the new billing webhook"`:

- searches the open SOWs first (queue, in progress, and waiting review) and folds the request into an existing SOW when one fits, instead of creating a duplicate
- creates a new canonical markdown file only when nothing open is a reasonable home, and reports that it checked first
- places a new SOW in `0_queue` by default, and starts it in `1_progressing` only when the request says so explicitly, for example `/sow "add the billing webhook SOW and start it in progress"`
- grounds each SOW in a code audit that cites file and line, references the completed work it builds on, and keeps its status in sync as the SOW moves across the lanes
