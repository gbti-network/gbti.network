// sow-313: no workflow may interpolate an attacker-supplied value into a `run` script BODY.
//
// `${{ ... }}` inside a `run:` block is TEXTUAL SUBSTITUTION into the shell source before bash ever parses
// it, so a value carrying a quote or `$(...)` executes with everything that step can reach. Passing the same
// value through `env:` makes it a variable, which is data.
//
// This guard exists because the defect was real and sitting in the highest-value workflow in the repository:
// rotate-member-key.yml interpolated a free-text `new_kid` dispatch input into six shell commands, including
// `git commit -m` and `gh pr create --body`, in a job holding MEMBER_CONTENT_KEY, MEMBER_CONTENT_KEY_NEW and
// GH_BOT_TOKEN. It was found while hardening a NEW workflow, not by anyone auditing that one, which is the
// argument for a check rather than care.
//
// WHAT IS AND IS NOT ALLOWED, because a blanket ban would be unusable:
//   - `secrets.*` is fine: a secret's VALUE is chosen by the repo owner, and masking makes env no safer.
//   - `inputs.*` / `github.event.inputs.*` / `client_payload.*` are NOT, when free-text. These are supplied
//     at dispatch time.
//   - a `type: choice` input IS allowed inline: GitHub validates it server-side against the declared
//     options, so it cannot carry arbitrary text. publish-extension.yml relies on this and is correct.
//   - `github.event.*` fields written by a contributor (issue titles, PR branch names) are NOT.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

/** Every `${{ ... }}` expression inside a string. */
const exprs = (s) => [...String(s).matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1].trim());

/** Contexts an outsider or a dispatcher controls the TEXT of. */
const UNTRUSTED = [
  /(^|\W)inputs\./,
  /github\.event\.inputs\./,
  /github\.event\.client_payload\./,
  /github\.event\.issue\./,
  /github\.event\.pull_request\.(title|body|head\.(ref|label))/,
  /github\.event\.comment\./,
  /github\.head_ref/,
];

/** The declared `type: choice` inputs per workflow: GitHub validates these against their options list. */
function choiceInputs(doc) {
  const on = doc?.on ?? doc?.[true]; // js-yaml parses the bare key `on:` as boolean true
  const ins = on?.workflow_dispatch?.inputs ?? {};
  return new Set(Object.entries(ins).filter(([, v]) => v?.type === 'choice').map(([k]) => k));
}

/** Walk a workflow's steps, yielding { file, step, run }. */
function* runSteps(doc, file) {
  for (const job of Object.values(doc?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.run === 'string') yield { file, name: step.name || step.uses || '(unnamed)', run: step.run };
    }
  }
}

test('no workflow interpolates an untrusted value into a run script body', () => {
  const findings = [];
  let stepsScanned = 0;
  for (const file of FILES) {
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
    let doc;
    try { doc = yaml.load(raw); } catch (e) { assert.fail(`${file} is not valid YAML: ${e.message}`); }
    const choices = choiceInputs(doc);
    for (const { name, run } of runSteps(doc, file)) {
      stepsScanned++;
      for (const e of exprs(run)) {
        if (!UNTRUSTED.some((re) => re.test(e))) continue;
        // A choice input is server-validated against its options, so its text cannot be arbitrary.
        const m = /(?:^|\W)(?:github\.event\.)?inputs\.([A-Za-z0-9_-]+)/.exec(e);
        if (m && choices.has(m[1])) continue;
        findings.push(`${file} :: step "${name}" :: \${{ ${e} }}`);
      }
    }
  }

  // ZERO SUBJECTS IS A FAILURE. A guard that scanned nothing and exited green reports an assurance nobody
  // holds, which is a shape this repository has shipped before.
  assert.ok(FILES.length >= 10, `only ${FILES.length} workflow files found: this check is broken, not the repo`);
  assert.ok(stepsScanned >= 20, `only ${stepsScanned} run steps scanned: this check is broken, not the repo`);

  assert.deepEqual(findings, [],
    'these workflows substitute an untrusted value into shell SOURCE. Pass it through `env:` and use "$VAR":\n  ' + findings.join('\n  '));
});

test('the guard can actually FIND the defect it claims to prevent', () => {
  // The positive control, and it is the reason the assertion above is trustworthy. Without it, an over-narrow
  // regex or a walker that never reaches `run` blocks would report a clean repository forever.
  const vulnerable = yaml.load(`
name: x
on:
  workflow_dispatch:
    inputs:
      free: { type: string }
      picked: { type: choice, options: [a, b] }
jobs:
  j:
    steps:
      - name: bad
        run: echo "\${{ inputs.free }}"
      - name: fine
        run: echo "\${{ inputs.picked }}"
      - name: also fine
        run: echo "\${{ secrets.TOKEN }}"
`);
  const choices = choiceInputs(vulnerable);
  assert.deepEqual([...choices], ['picked'], 'the choice-input reader is broken, so the exemption is untested');

  const hits = [];
  for (const { name, run } of runSteps(vulnerable, 'fixture')) {
    for (const e of exprs(run)) {
      if (!UNTRUSTED.some((re) => re.test(e))) continue;
      const m = /(?:^|\W)(?:github\.event\.)?inputs\.([A-Za-z0-9_-]+)/.exec(e);
      if (m && choices.has(m[1])) continue;
      hits.push(name);
    }
  }
  assert.deepEqual(hits, ['bad'], 'the guard must flag the free-text input, and ONLY it');
});

test('rotate-member-key still constrains its epoch id to digits', () => {
  // The env fix makes the value data; this makes it the RIGHT data. Two independent layers, so neither is
  // load-bearing alone, and the weaker one going missing is caught here rather than discovered later.
  const raw = fs.readFileSync(path.join(DIR, 'rotate-member-key.yml'), 'utf8');
  assert.match(raw, /\*\[!0-9\]\*/, 'the digits-only validation on new_kid is gone');
  const doc = yaml.load(raw);
  // It must precede every OTHER step that uses the value. Two earlier versions of this assertion were wrong
  // about correct code before this one was right: index 0 failed because `npm ci` is legitimately the first
  // run step, and then "before every user" failed because the guard step reads $NEW_KID itself. Recorded
  // because on this repository the CHECK is wrong more often than the subject, and both failures looked
  // exactly like a real finding.
  const steps = [...runSteps(doc, 'rotate-member-key.yml')];
  const guard = steps.findIndex((s) => /\[!0-9\]/.test(s.run));
  assert.ok(guard >= 0, 'the validation step was not found');
  const users = steps.map((s, i) => (/\$NEW_KID/.test(s.run) ? i : -1)).filter((i) => i >= 0 && i !== guard);
  assert.ok(users.length >= 3, `expected the epoch id to be used downstream, found ${users.length} step(s)`);
  assert.ok(Math.min(...users) > guard, 'validation must run before every step that uses the epoch id');
});
