---
name: qa
description: >
  Resolve the open questions before the work proceeds. Invoke for "/qa", "/qa continue", "/qa proceed",
  "/qa deep", "/qa <topic>", or when the user asks you to ask your questions first, clarify before
  building, or answer the things you just raised. By default it gathers the open questions from YOUR OWN LAST REPLY:
  the questions, options and flagged decisions already sitting in it. "/qa deep" runs the full
  six-category sweep instead. Every mode enters plan mode; "continue" and "proceed" skip the plan
  approval and build straight from the answers.
---

# /qa: resolve the open questions before building

The point of this command is to move every decision that is the user's call OUT of your head and
into one batch of questions, answered before any code is written. No silent defaults, no drip of
ad-hoc questions later.

The common case is small and cheap: a reply just ended with open questions in it, and the user wants
those answered properly instead of letting them evaporate. That is the default. The exhaustive sweep
is a separate, deliberate mode, because it costs real tokens and most invocations do not need it.

## Read the argument first, it selects the mode

`continue`, `proceed` and `deep` are reserved words. Anything else is a topic.

| Invocation | Mode |
|---|---|
| `/qa` | **Ask and hold, last reply.** Enter plan mode (`EnterPlanMode`), gather what your own last reply left open, then present a plan for approval (`ExitPlanMode`). Write nothing until approved. |
| `/qa continue` or `/qa proceed` | **Ask and go.** Identical, minus the confirmation before acting: once the answers land you build straight from them, with no plan written for review. |
| `/qa deep` | **Full sweep.** Step 2's six categories instead of the last-reply scope. Use when starting real work, not when closing out a reply. |
| `/qa deep continue` or `/qa deep proceed` | Full sweep, no approval round. Scope and approval are independent. |
| `/qa <anything else>` | **Scoped.** The trailing text names the subject to focus on. Add `continue` or `proceed` to drop the approval round for it. |

Every mode enters plan mode and holds its read-only discipline until the questions are answered. The
question-asking discipline in step 3 is identical in all of them; only the SCOPE and the approval
round change.

**Order inside plan mode: ask FIRST, then exit.** `AskUserQuestion` carries the questions;
`ExitPlanMode` carries the plan built from the answers. Reaching `ExitPlanMode` with the questions
still unanswered turns an intake into a document review, and an approval of that document is NOT an
answer to anything inside it.

## Step 1: verify before you ask

Never ask what the repository can answer. Check the claims your questions rest on before putting them
to the user, so every question is one that genuinely cannot be resolved without them. A question the
code already answers is noise, and it teaches the user that /qa wastes their time.

In the default mode this is targeted, not a survey: confirm the specific facts behind the items your
last reply raised. A flagged failure may already have its reason recorded somewhere; an offered option
may turn out to be impossible or already done. Verifying first routinely dissolves a question or
changes what it should have been.

## Step 2: what to gather

**Default: your own last reply.** Re-read the reply you just gave and pull out everything you left
open: questions you asked, options you offered, decisions you named as the user's, caveats you
attached, and anything you said you COULD do next. That set is the batch. Do not sweep the codebase.

If the last reply left nothing open, say so plainly and stop. Do not go hunting for work to justify
the invocation.

**Deep (`/qa deep`): the full sweep.** Cover all of these, not just the obvious one:

1. **The request itself.** Scope boundaries, what is deliberately excluded, naming, placement.
2. **The governing doc.** If the work traces to a planning document (a scope of work, a ticket, a
   spec), its open-questions section is the primary source. Pull those forward verbatim.
3. **What the audit surfaced.** Which existing pattern to reuse, where a shared helper lives,
   whether to extend a surface or add one.
4. **Anything you were about to default silently.** If you caught yourself picking, it is a
   question. This is the highest-yield category.
5. **The user's call by nature.** Product and UX behavior, copy, data-shape changes, anything
   irreversible or outward-facing, and anything that costs money or needs provisioning.
6. **Conflicts.** Where the request contradicts an existing convention, the code, or an earlier
   decision, surface the conflict rather than quietly picking a side.

## Step 3: how to ask, AN INTAKE FORM AND NOT AN ESSAY

**Ask with `AskUserQuestion`, in plan mode, as a form the user clicks through.** This is the whole
point of the command. A batch of questions written into prose or into a plan document is not an
intake: it makes the user re-read a wall of text, hold thirteen items in their head, and compose one
long free-text reply. They asked to be asked. Give them a form.

**This rule was reversed on 2026-08-12 and again on 2026-08-18.** The skill used to say "free-form
conversational questions, not multiple-choice pickers", and both times the correction came from the
user noticing the same thing: /qa generated real questions and then failed to present them as an
intake. If you find yourself numbering questions in a markdown response, you are doing the version
that was already rejected twice.

- **`AskUserQuestion`, four questions per call, as many calls as it takes.** Thirteen questions is
  four rounds. That is fine and it is much cheaper for the user than one wall of prose.
- **The recommended option goes FIRST, labelled `(Recommended)`.** State the option you would take,
  so the user can accept the whole round with four clicks and you are still unblocked.
- **Every option gets a description that says what happens if it is chosen**, not a restatement of
  its label. The `description` field is where the stakes and the trade-off live.
- **Order by consequence**, most structural first, and put the most consequential in the first round.
  The user may stop after round one.
- **Do not pre-empt the form with the same content in prose.** A short lead-in naming what the rounds
  cover is useful. Reproducing all thirteen questions above the form is the failure this rule exists
  to stop.
- **Detail that does not fit an option belongs in the plan file or the source document**, referenced
  by name, not pasted into the question text. Keep the question itself to what someone deciding needs.

**Prose is the exception, and it is narrow.** Use it only for a question with no enumerable options
at all: one that needs the user to supply a value you cannot guess (a URL, a name, a piece of copy,
a screenshot). Even then, ask for it in one line, and keep everything else in the form.

- **Say so when there are none.** If verification resolved everything, report that plainly and state
  the assumptions you are proceeding under. Do not manufacture questions to justify the command.

## Step 4: after the answers

- **Do not re-ask.** Answered means settled; carry it forward without relitigating.
- **Record the resolutions where they belong.** If a planning doc raised the question, write the
  answer back into it so it reads as resolved, not still open.
- In ask-and-hold mode, present the plan for approval. In continue/proceed mode, leave plan mode as
  soon as the answers land and build, without composing a plan for review. The harness still
  surfaces a single prompt on the way out of plan mode; that is a formality, not a review round, so
  keep what you write there to a line or two.
- If something genuinely new surfaces mid-build, finish everything that does not depend on it, then
  raise the one question at the right moment.

## Reminders

- Follow the project's own plan-mode and writing conventions throughout.
- The command is about decisions, not permission. Do not turn it into a request to confirm work the
  user already asked for.
