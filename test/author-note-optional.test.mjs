// 2026-10-29 (owner): the from-the-author note is OPTIONAL on a published project or prompt.
//
// WHY. The editor offers the note as an optional box and publish never refused without one, so a member's project
// went live, the owner was told about it, and a minute later the post-publish check drafted it again, telling
// nobody. LetsGather (2026-10-29) was the third time: SurfacedBy (2026-09-28) and a prompt (2026-09-29) went first.
// The owner chose to drop the rule rather than enforce it up front. What is still checked: a target carries at most
// one note per author, so a re-publish can never leave two.
//
// Run for real, on a throwaway tree: the validator copied, everything else linked, the two member folders copied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LETSGATHER = 'members/gbarrionuevo/projects/letsgather/index.md';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-notefix-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  for (const d of ['client', 'client-ui', 'membership', 'house', 'src', 'node_modules', 'workers']) fs.symlinkSync(path.join(ROOT, d), path.join(dir, d));
  fs.mkdirSync(path.join(dir, 'members'));
  for (const m of ['gbarrionuevo', 'atwellpub']) fs.cpSync(path.join(ROOT, 'members', m), path.join(dir, 'members', m), { recursive: true });
  return dir;
}
const run = (dir, changed) => spawnSync(process.execPath, [path.join(dir, 'scripts/validate-content.mjs')], {
  encoding: 'utf8', env: { ...process.env, CHANGED_FILES: changed.join(' '), CHANGED_BASE: '' },
});
const note = (author, slug, id) => `---\nid: ${id}\ntargetType: project\ntargetSlug: ${slug}\ncreatedAt: '2026-10-29T00:00:00.000Z'\nstatus: published\nvisibility: public\nauthorNote: true\ntype: comment\nauthor: ${author}\n---\n\nA note.\n`;

test('a published project with no author note passes, and two notes on one target still fail', { timeout: 120000 }, () => {
  const dir = fixture();
  try {
    const text = fs.readFileSync(path.join(dir, LETSGATHER), 'utf8');
    assert.match(text, /^status: published$/m, 'LetsGather is restored as published');
    assert.equal(fs.existsSync(path.join(dir, 'members/gbarrionuevo/comments')), false, 'and it has no note, which is the case under test');
    const ok = run(dir, [LETSGATHER]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.doesNotMatch(ok.stdout + ok.stderr, /requires a from-the-author note/);

    // Two notes by the same author on one target: still refused, so a re-publish can never leave two.
    fs.mkdirSync(path.join(dir, 'members/gbarrionuevo/comments'));
    const a = 'members/gbarrionuevo/comments/intro-letsgather.md';
    const b = 'members/gbarrionuevo/comments/intro-letsgather-2.md';
    fs.writeFileSync(path.join(dir, a), note('gbarrionuevo', 'letsgather', 'intro-letsgather'));
    assert.equal(run(dir, [LETSGATHER, a]).status, 0, 'one note is fine');
    fs.writeFileSync(path.join(dir, b), note('gbarrionuevo', 'letsgather', 'intro-letsgather-2'));
    const dup = run(dir, [b]);
    assert.notEqual(dup.status, 0);
    assert.match(dup.stdout + dup.stderr, /more than one from-the-author note/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the exemption list is retired with the rule it excused', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'house/author-note-exempt.yml')), false);
  for (const f of ['scripts/validate-content.mjs', 'scripts/lib/validate-house-config.mjs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /author-note-exempt|AUTHOR_NOTE_EXEMPT|validateAuthorNoteExempt/, f);
  }
});
