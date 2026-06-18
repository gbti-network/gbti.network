#!/usr/bin/env node
// SOW-015 build guard: the member-content epoch key lives ONLY in a Worker secret + SIGNUP_KV, never in the
// repo or the static build. This guard fails the build if key material leaks into dist/, and flags author
// mistakes around .enc assets. Runs in CI (content-check.yml, secret-free part) and in the Pages build (with
// MEMBER_CONTENT_KEY set, for the dist value-scan).
//   node scripts/check-build-secrets.mjs
//   MEMBER_CONTENT_KEY=... SCAN_SECRETS="extra,values" node scripts/check-build-secrets.mjs
//
// SCOPE NOTE: the plaintext-beside-ciphertext check only catches a same-name sibling (<id> next to <id>.enc),
// not an arbitrary plaintext copy committed elsewhere. The envelope-shape check additionally catches a
// plaintext accidentally committed AS `<id>.enc`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// Non-binary files are scanned for leaked secret values (denylist, so new text output types are covered).
// NOTE: .enc is NOT excluded — a .enc envelope is small JSON text, so a key accidentally written into a
// .enc-named file in dist is still value-scanned (it would otherwise evade both this scan and the shape check).
const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|woff2?|ttf|eot|otf|pdf|wasm|mp4|webm|mov|zip|gz|br)$/i;

/**
 * Scan a repo root + its dist for leaked member-content key material and .enc hygiene problems. Pure over the
 * passed root/dist/env, so it is unit-testable. Returns { errors, notes }.
 */
export function checkBuildSecrets({ root, distDir = path.join(root, 'dist'), env = process.env } = {}) {
  const errors = [];
  const notes = [];

  // 1) Known secret VALUES must never appear in the built output: MEMBER_CONTENT_KEY (when the build env has
  //    it) plus any extra values passed via SCAN_SECRETS.
  const needles = [];
  if (env.MEMBER_CONTENT_KEY) needles.push(['MEMBER_CONTENT_KEY value', env.MEMBER_CONTENT_KEY]);
  for (const v of (env.SCAN_SECRETS || '').split(/[\s,]+/).filter(Boolean)) needles.push(['SCAN_SECRETS value', v]);

  if (fs.existsSync(distDir)) {
    for (const f of walk(distDir)) {
      if (BINARY.test(f)) continue;
      const rel = path.relative(root, f);
      const txt = fs.readFileSync(f, 'utf8');
      for (const [label, value] of needles) {
        if (value && value.length >= 8 && txt.includes(value)) errors.push(`leaked ${label} in build output: ${rel}`);
      }
      if (/MEMBER_CONTENT_KEY\s*[:=]\s*["'][A-Za-z0-9+/=]{20,}/.test(txt)) {
        errors.push(`an inlined MEMBER_CONTENT_KEY assignment appears in: ${rel}`);
      }
      // SOW-016: the `<!-- members-only -->` marker is stripped at publish (the gated tail goes to the .enc),
      // so it must NEVER reach the build output. Its presence means a publish leaked the gated section.
      if (txt.includes('<!-- members-only -->')) {
        errors.push(`the members-only marker leaked into build output: ${rel} (a publish failed to split the body; the gated section may be exposed). See SOW-016.`);
      }
    }
  } else {
    notes.push('dist/ not found, skipped the build-output scan (run after `npm run build`).');
  }

  // SOW-016: a Mode A item (visibility: members, no public stub) must have NO public page. Assert none exists
  // in dist for any such item (a backstop if getStaticPaths were reverted to plain isPublic-without-stub).
  if (fs.existsSync(distDir)) {
    const fmField = (txt, key) => {
      const m = new RegExp('^' + key + ':\\s*"?([^"\\n]+?)"?\\s*$', 'm').exec(txt);
      return m ? m[1].trim() : null;
    };
    const SUBS = [['posts', 'blog'], ['products', 'products'], ['prompts', 'prompts']];
    const baseDirs = [path.join(root, 'house')];
    const membersDir = path.join(root, 'members');
    if (fs.existsSync(membersDir)) {
      for (const u of fs.readdirSync(membersDir)) {
        const b = path.join(membersDir, u);
        try { if (fs.statSync(b).isDirectory()) baseDirs.push(b); } catch { /* skip */ }
      }
    }
    for (const baseDir of baseDirs) {
      for (const [sub, distSeg] of SUBS) {
        const dir = path.join(baseDir, sub);
        if (!fs.existsSync(dir)) continue;
        for (const slugDir of fs.readdirSync(dir)) {
          const idx = path.join(dir, slugDir, 'index.md');
          if (!fs.existsSync(idx)) continue;
          const txt = fs.readFileSync(idx, 'utf8');
          // Mode A = members + not a stub. Parse publicStub case-insensitively (YAML accepts true/True/TRUE).
          if (fmField(txt, 'visibility') !== 'members' || /^true$/i.test(String(fmField(txt, 'publicStub') ?? ''))) continue;
          const slug = fmField(txt, 'slug') || slugDir;
          const page = path.join(distDir, distSeg, slug, 'index.html');
          if (fs.existsSync(page)) {
            errors.push(`Mode A item (members, no stub) has a public page in dist: ${path.relative(root, page)} (it must not be built). See SOW-016.`);
          }
        }
      }
    }
  }

  // SOW-018: Shares are EXTENSION-ONLY — they must have NO public website surface. Assert there is no /shares/
  // page in dist and that the public activity index carries no Share entry (the extension reads Shares
  // authenticated; a public surface would publish members-Share stub metadata). A tripwire against a future
  // /shares/ route or a re-added activity-index inclusion.
  if (fs.existsSync(distDir)) {
    if (fs.existsSync(path.join(distDir, 'shares'))) {
      errors.push('a public /shares/ surface exists in dist (dist/shares/) — Shares are extension-only and must have no public page. See SOW-018.');
    }
    const activityIdx = path.join(distDir, 'activity-index.json');
    if (fs.existsSync(activityIdx)) {
      try {
        const entries = JSON.parse(fs.readFileSync(activityIdx, 'utf8'))?.entries ?? [];
        if (entries.some((e) => e?.type === 'share')) {
          errors.push('a Share appears in the public activity-index.json — Shares are extension-only and must be excluded. See SOW-018.');
        }
      } catch { /* a malformed index is caught elsewhere */ }
    }
  }

  // 2) Repo hygiene for committed .enc ciphertext: no same-name plaintext sibling, and every .enc must parse
  //    as a valid v1 envelope (so a plaintext committed AS <id>.enc is caught, not shipped as fake ciphertext).
  for (const base of ['house', 'members']) {
    for (const f of walk(path.join(root, base))) {
      if (!f.endsWith('.enc')) continue;
      const rel = path.relative(root, f);
      const plaintext = f.slice(0, -4); // drop ".enc"
      if (fs.existsSync(plaintext)) {
        errors.push(`plaintext committed beside ciphertext: ${path.relative(root, plaintext)} (remove it; only the .enc belongs in the repo)`);
      }
      try {
        const envlp = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (envlp?.v !== 1 || typeof envlp.iv !== 'string' || typeof envlp.ct !== 'string' || typeof envlp.aad !== 'string') {
          errors.push(`${rel}: not a valid v1 encrypted envelope (looks like plaintext or a malformed .enc; encrypt it via the client)`);
        }
      } catch {
        errors.push(`${rel}: not valid JSON (a .enc must be an encrypted v1 envelope, not raw plaintext)`);
      }
    }
  }

  // SOW-044: comments are members-only + encrypted. A `public` comment is allowed ONLY as a from-the-author intro
  // (authorNote:true) on a post/product/prompt; a discussion reply, and ANY comment on a Share, must be members,
  // with its body in an encrypted envelope (never committed plaintext). This backstops validate-content at BUILD
  // time, because the Pages build runs verify:dist (this guard) but not check:content (validate-content).
  {
    const fmField = (txt, key) => {
      const m = new RegExp('^' + key + ':\\s*"?([^"\\n]+?)"?\\s*$', 'm').exec(txt);
      return m ? m[1].trim() : null;
    };
    const commentDirs = [path.join(root, 'house/comments')];
    const membersDir = path.join(root, 'members');
    if (fs.existsSync(membersDir)) {
      for (const u of fs.readdirSync(membersDir)) {
        try { if (fs.statSync(path.join(membersDir, u)).isDirectory()) commentDirs.push(path.join(membersDir, u, 'comments')); } catch { /* skip */ }
      }
    }
    for (const cd of commentDirs) {
      if (!fs.existsSync(cd)) continue;
      for (const f of fs.readdirSync(cd)) {
        if (!/\.(md|mdx)$/.test(f)) continue;
        const rel = path.relative(root, path.join(cd, f));
        const txt = fs.readFileSync(path.join(cd, f), 'utf8');
        const vis = fmField(txt, 'visibility') ?? 'members';
        const isPublicIntro = /^true$/i.test(String(fmField(txt, 'authorNote') ?? '')) && ['post', 'product', 'prompt'].includes(String(fmField(txt, 'targetType')));
        const body = txt.replace(/^---\n[\s\S]*?\n---/, '').trim();
        if (vis === 'public' && !isPublicIntro) {
          errors.push(`${rel}: a public comment is only allowed as a from-the-author intro (authorNote on a post/product/prompt); a discussion or share comment must be visibility:members. See SOW-044.`);
        }
        if (vis === 'members' && body && !fmField(txt, 'encryptedBody')) {
          errors.push(`${rel}: a members-only comment committed plaintext (no encryptedBody); its body must be encrypted via the client. See SOW-044.`);
        }
      }
    }
  }

  return { errors, notes };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const { errors, notes } = checkBuildSecrets({ root: ROOT });
  for (const n of notes) console.log('· ' + n);
  if (errors.length) {
    console.error(`✗ build-secrets guard failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('✓ build-secrets guard passed (no key material in dist, no plaintext beside ciphertext)');
}
