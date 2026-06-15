#!/usr/bin/env node
// Defense-in-depth secret guard. Scans the files that WOULD be committed (it mirrors .gitignore by
// skipping the same paths) for credential patterns, so a real key can never reach git even if a key is
// pasted into a tracked file or .gitignore is weakened. The real secret files (.env, **/.dev.vars) are
// gitignored and skipped here, as are *.example placeholders. Node builtins only (no deps), so it runs
// anywhere: `npm run check:secrets`, the .githooks/pre-commit hook, and .github/workflows/secret-scan.yml.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const SELF = fileURLToPath(import.meta.url);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.data', '.snapshots', '.wrangler']);
const isSkippedFile = (rel) =>
  rel.endsWith('.example') ||
  /(^|\/)\.env(\..*)?$/.test(rel) ||
  /(^|\/)\.dev\.vars$/.test(rel) ||
  path.join(ROOT, rel) === SELF;

const TEXT_EXT = new Set(['.mjs', '.js', '.ts', '.astro', '.json', '.yml', '.yaml', '.md', '.toml', '.txt', '.csv', '.css', '.html', '.sh', '']);

// Credential shapes, each long enough that short placeholders (rk_test_xxx) do not match.
const PATTERNS = [
  { name: 'Stripe secret/restricted key', re: /\b[rs]k_(live|test)_[A-Za-z0-9]{24,}\b/ },
  { name: 'Stripe webhook secret', re: /\bwhsec_[A-Za-z0-9]{24,}\b/ },
  { name: 'GitHub PAT (classic)', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'GitHub OAuth/server token', re: /\bgh[ousr]_[A-Za-z0-9]{36}\b/ },
  { name: 'Discord bot token', re: /\b[MNO][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{20,}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

const findings = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
      continue;
    }
    const rel = path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/');
    if (isSkippedFile(rel)) continue;
    if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
    let txt;
    try {
      txt = fs.readFileSync(path.join(dir, e.name), 'utf8');
    } catch {
      continue;
    }
    txt.split('\n').forEach((line, i) => {
      for (const p of PATTERNS) if (p.re.test(line)) findings.push({ rel, line: i + 1, name: p.name });
    });
  }
}
walk(ROOT);

if (findings.length) {
  console.error(`✗ secret scan FAILED: ${findings.length} possible credential(s) in committable files:`);
  for (const f of findings) console.error(`  - ${f.rel}:${f.line}  (${f.name})`);
  console.error('Move the value into a gitignored .env / .dev.vars or a platform secret store, never into git.');
  process.exit(1);
}
console.log('✓ secret scan passed (no credential patterns in committable files)');
