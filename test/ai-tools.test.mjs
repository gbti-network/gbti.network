// sow-368: the controlled list of AI tools a prompt may say it runs on.
//
// PREVENTIVE, NOT CORRECTIVE, and the tests say so because the reason gets forgotten first. Measured
// 2026-09-19: 26 prompt files carry 5 values between them, every one spelled consistently. Nothing was
// broken. The moment somebody writes "claude code" beside "Claude Code", the prompts directory grows two
// filter buttons for one tool, each showing half the prompts, and nothing anywhere reports it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { aiToolEntries, aiToolLabels, targetProblems } from '../membership/ai-tools.mjs';

const ROOT = new URL('../', import.meta.url);
const doc = yaml.load(fs.readFileSync(new URL('house/ai-tools.yml', ROOT), 'utf8'));

/** Every prompt's targets, parsed from frontmatter rather than grepped. */
function promptTargets() {
  const out = [];
  const members = new URL('members/', ROOT);
  for (const m of fs.readdirSync(members)) {
    const dir = path.join(members.pathname, m, 'prompts');
    if (!fs.existsSync(dir)) continue;
    for (const slug of fs.readdirSync(dir)) {
      const file = path.join(dir, slug, 'index.md');
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const fm = text.split('---')[1];
      if (!fm) continue;
      let parsed;
      try { parsed = yaml.load(fm); } catch { continue; }
      if (Array.isArray(parsed?.targets)) out.push({ file: `members/${m}/prompts/${slug}`, targets: parsed.targets });
    }
  }
  return out;
}

test('sow-368: every prompt we ship already names a tool from the list', () => {
  // The migration test. If this ever needed a content change it would be visible here rather than as a red
  // build on somebody else's pull request.
  const prompts = promptTargets();
  assert.ok(prompts.length >= 20, `only ${prompts.length} prompts carry targets, so this proves little`);
  for (const { file, targets } of prompts) {
    assert.deepEqual(targetProblems(targets, doc), [], file);
  }
});

test('sow-368: the list itself is well formed and carries no two spellings of one name', () => {
  const entries = aiToolEntries(doc);
  assert.ok(entries.length >= 5);
  const lower = entries.map((t) => t.label.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, 'two entries differ only by case, which is the drift this list prevents');
  for (const { key, label } of entries) {
    assert.match(key, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${key} should be kebab-case`);
    assert.equal(label, label.trim());
    assert.doesNotMatch(label, /[—–]/, `${label} carries a dash our conventions do not use`);
  }
});

test('sow-368: the exact spelling passes and a near miss is refused with the right spelling', () => {
  // The whole point: "claude code" is not accepted, and the author is told what to write instead rather than
  // being sent to read a file.
  assert.deepEqual(targetProblems(['Claude Code'], doc), []);
  const near = targetProblems(['claude code'], doc);
  assert.equal(near.length, 1);
  assert.match(near[0], /spelled differently/);
  assert.match(near[0], /write "Claude Code"/);
  for (const bad of ['CLAUDE CODE', 'Claude code', ' claude Code ']) {
    // A leading or trailing space is trimmed and then judged on case alone.
    const r = targetProblems([bad], doc);
    assert.equal(r.length, bad.trim() === 'Claude Code' ? 0 : 1, bad);
  }
});

test('sow-368: a tool nobody listed is refused, and the message lists what is allowed', () => {
  const r = targetProblems(['Grok'], doc);
  assert.equal(r.length, 1);
  assert.match(r[0], /not in house\/ai-tools\.yml/);
  assert.match(r[0], /Add it there/);
  for (const label of aiToolLabels(doc).slice(0, 3)) assert.ok(r[0].includes(label), `the message should name ${label}`);
});

test('sow-368: an empty entry, a repeat, and a non-list are each reported', () => {
  assert.match(targetProblems(['Claude Code', ''], doc)[0], /empty entry/);
  assert.match(targetProblems(['Claude Code', 'Claude Code'], doc)[0], /twice/);
  assert.match(targetProblems('Claude Code', doc)[0], /must be a list/);
  assert.deepEqual(targetProblems(undefined, doc), [], 'a prompt that names no tool is fine');
  assert.deepEqual(targetProblems([], doc), []);
});

test('sow-368: with no vocabulary the core reports NOTHING, because the caller reports the missing file', () => {
  // Deliberate split. If this returned "everything is wrong" on a missing file, a deleted vocabulary would
  // bury the real message under one error per prompt. The validator has its own guard for the file itself,
  // and that guard is what fails.
  for (const empty of [null, undefined, {}, { tools: {} }, { tools: 'nonsense' }]) {
    assert.deepEqual(targetProblems(['Anything At All'], empty), [], JSON.stringify(empty));
  }
  assert.deepEqual(aiToolEntries({ tools: { x: {} } }), [], 'an entry with no label is dropped, not defaulted to its key');
});

test('sow-368: the validator checks PROMPTS, in the branch where a prompt actually is', () => {
  // The defect this pins: the check was first written beside the share-category check, which a prompt never
  // reaches, so all three controls passed green while nothing was being checked. A guard in the wrong branch
  // is indistinguishable from a guard that works, until you try to make it fail.
  const src = fs.readFileSync(new URL('scripts/validate-content.mjs', ROOT), 'utf8');
  const check = src.indexOf("type === 'prompt' && fm && fm.targets");
  assert.ok(check > -1, 'the targets check must read a prompt frontmatter, not a share one');
  const branch = src.lastIndexOf("if (type === 'post' || type === 'project' || type === 'prompt'", check);
  const shareBranch = src.lastIndexOf('const fmc = frontmatter(txt)', check);
  assert.ok(branch > -1 && branch > shareBranch, 'the check must sit inside the post/project/prompt branch');
});
