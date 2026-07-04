---
id: intro-author-a-gbti-sow
targetType: prompt
targetSlug: author-a-gbti-sow
createdAt: '2026-07-02T23:14:51.531Z'
status: published
visibility: public
authorNote: true
type: comment
author: atwellpub
---

This is the skill I reach for whenever an agent needs to author or manage a Statement of Work. To set it up in a fresh project, run /sow init. That scaffolds the lane folders (0_queue, 1_progressing, 2_waiting_review, and a _staging side-lane) plus a todo file, and it never overwrites anything you already have. It is a one-time step, and it only builds the folders, it does not write a SOW.

To add a new Statement of Work, describe the work in plain language, for example "add a SOW for the new billing webhook". The skill writes one canonical markdown file for it. Here is the subtle part worth knowing: a new SOW lands in 0_queue by default. It only starts in 1_progressing when you say so explicitly, for example "add a SOW for the billing webhook and start it in progress". So if you do not name a lane, expect the SOW to wait in the queue until you move it forward.

Before it creates anything new, the skill searches the open SOWs first. It reads what is already sitting in the queue and in progress (and anything waiting for review) to decide whether your addition belongs inside a SOW that already exists. If it finds a good home, it tucks the change into that file as a new phase, a decision, or a resolved open question, instead of spawning a duplicate. A brand new SOW file only appears when nothing open is a reasonable fit, and it will tell you that it checked first.

After that, every SOW follows the same discipline: ground it in a real code audit so it cites file and line rather than guesses, reference the completed work it builds on, and keep its status in sync as it moves across the lanes. It is project-agnostic, so point any agent at it and your planning docs come out uniform and grounded.
