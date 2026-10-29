// The house/*.yml settings checks, run by scripts/validate-content.mjs.
//
// Moved out of validate-content.mjs unchanged when that file passed the 900-line rule (sow-109, 2026-09-29). These
// check the curated settings files, not member content: role and ban grants against the members index, the channel
// maps, the digest settings, the AI-tool, install-step and licence lists, blocked words, coupons, the topic map,
// content flags, membership tiers and the CTA registry. Each function is the one that lived there, run in the same
// order, pushing into the same error list the content checks use, so the output and the exit code did not change.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { topicVocabKeys } from '../../membership/topics-vocab.mjs'; // SOW-080: the flat house/topics.yml topic vocabulary
import { aiToolEntries } from '../../membership/ai-tools.mjs'; // sow-368: the controlled AI-tool list
import { skillInstallProblems } from '../../membership/skill-install.mjs'; // sow-109: the install steps per tool
import { licenseEntries } from '../../membership/licenses.mjs'; // sow-305: the controlled license list
import { membersIndexFromParsed, overrideConsistencyErrors } from '../../membership/overrides-core.mjs';
import { validateNewsChannels } from '../../membership/news-channels.mjs'; // SOW-043: the news-category -> Discord channel map
import { validateCoupons } from '../../membership/coupons.mjs'; // SOW-119: the coupon registry
import { validateTopicMap } from '../../membership/topic-map.mjs'; // SOW-054: the followed-topic -> news-category map
import { normalizeBanword, BANWORD_LIMIT, BANWORD_MIN, BANWORD_MAX } from '../../membership/news-banwords.mjs'; // sow-372: the blocked-word list
import { validateTierDisplay } from '../../membership/tiers-display.mjs'; // sow-185: the membership tier display data
import { PAID_GRANT_TIERS } from '../../membership/tier-gate.mjs'; // sow-185: the paid tiers a grandfather grant may name
import { CATEGORY_NAMES } from '../../workers/signup/news/config/categories.mjs'; // SOW-054: the canonical news category labels
import { validateCtas } from '../../membership/cta-edits.mjs'; // sow-281: the CTA registry rules
import { assignmentsOf } from '../../src/lib/ctas.mjs'; // sow-281
import { ctaItemExists, ctaImageInfo } from './ctas-store.mjs'; // sow-281; sow-337 the card image check
import { ctaWarnings, buildDigestConfigMirror } from '../../membership/digest-config.mjs'; // sow-266: the digest pitch + sponsor slot

// Set by validateHouseConfig before any check runs, so each function below reads the same names it read in
// validate-content.mjs.
let ROOT = '';
let errors = [];
let AI_TOOLS_DOC = null;
let LICENSES_DOC = null;
const has = (p) => fs.existsSync(p);

// Override grants (bans / grandfathered / roles) must reference github_ids consistent with members-index.yml.
// A typo'd or swapped github_id<->login otherwise FAILS CLOSED silently (the wrong id never matches the member,
// so a comp/ban grant just does nothing). Skips ids/logins not in the index (folderless grants + the bot).
function validateOverrideConsistency() {
  const load = (rel) => {
    try { return yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')) ?? {}; } catch { return {}; }
  };
  const idx = membersIndexFromParsed(load('house/members-index.yml'));
  if (!idx.size) return; // no members-index yet (pre-M0) -> nothing to check against
  const gf = load('house/grandfathered.yml');
  const bn = load('house/bans.yml');
  const rl = load('house/roles.yml');
  const tag = (list, src) => (Array.isArray(list) ? list : []).map((e) => ({ ...e, _src: src }));
  const entries = [
    ...tag(gf.grandfathered, 'grandfathered.yml'),
    ...tag(bn.bans, 'bans.yml'),
    ...tag(rl.superadmins, 'roles.yml superadmins'),
    ...tag(rl.admins, 'roles.yml admins'),
    ...tag(rl.moderators, 'roles.yml moderators'),
  ];
  for (const err of overrideConsistencyErrors(idx, entries)) errors.push(err);
}

// sow-185: a grandfather grant may carry an optional `tier` naming the membership tier it confers. When
// present it MUST be one of the paid tiers (member / creator); anything else (a typo, or `none`) is rejected,
// because a bad value would silently fall back to the default tier in tier-gate.grantTier (member since owner
// Q15) instead of the tier the editor intended.
function validateGrandfatherTiers() {
  const rel = 'house/grandfathered.yml';
  if (!has(path.join(ROOT, rel))) return; // optional file
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  // Guard the shape: a `grandfathered:` mapping (missing the list dashes) parses to a non-array, which `?? []`
  // does not catch, so iterating it would throw an uncaught TypeError and crash the validator. Coerce cleanly.
  for (const e of Array.isArray(parsed?.grandfathered) ? parsed.grandfathered : []) {
    if (e?.tier === undefined || e?.tier === null) continue; // no tier -> defaults to member (owner Q15), allowed
    if (!PAID_GRANT_TIERS.includes(e.tier)) {
      errors.push(`${rel}: grant for github_id ${e.github_id ?? '(unknown)'} has tier "${e.tier}"; allowed: ${PAID_GRANT_TIERS.join(', ')}`);
    }
  }
}

// SOW-043: the news-category -> Discord channel map (house/news-channels.yml). Absent is fine; when present, it
// must be a list of { category, numeric channelId } with no duplicate category (a bad map would silently misroute
// or drop a heart-publish). Pure validation lives in membership/news-channels.mjs.
function validateNewsChannelsConfig() {
  const rel = 'house/news-channels.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  for (const err of validateNewsChannels(parsed)) errors.push(err);
}

// sow-266: house/digest-config.yml. SHAPE is an error, COPY is a warning.
//
// The split is the owner's ruling of 2026-09-19: the three pitch rules warn and do not block, so they must
// not red a build either. A structural problem is different: a `cta:` that parses to a list, or a sponsor
// switch that is the string "false" rather than the boolean, would be read as absent and silently revert to
// the compiled default, which is exactly the failure a validator is for.
function validateDigestConfig() {
  const rel = 'house/digest-config.yml';
  if (!has(path.join(ROOT, rel))) return; // optional: absent means every field falls back to the shipped copy
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { errors.push(`${rel}: must be a mapping with cta and sponsor blocks`); return; }

  for (const block of ['cta', 'sponsor']) {
    const v = parsed[block];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) errors.push(`${rel}: ${block}: must be a mapping, not ${Array.isArray(v) ? 'a list' : typeof v}`);
  }
  const cta = parsed.cta && typeof parsed.cta === 'object' && !Array.isArray(parsed.cta) ? parsed.cta : {};
  const sponsor = parsed.sponsor && typeof parsed.sponsor === 'object' && !Array.isArray(parsed.sponsor) ? parsed.sponsor : {};
  for (const [block, obj] of [['cta', cta], ['sponsor', sponsor]]) {
    if ('enabled' in obj && typeof obj.enabled !== 'boolean') {
      errors.push(`${rel}: ${block}.enabled must be true or false, not ${JSON.stringify(obj.enabled)}. A quoted "false" reads as absent and the setting silently reverts.`);
    }
  }
  for (const [block, obj, fields] of [['cta', cta, ['body', 'link_label', 'link_url']], ['sponsor', sponsor, ['html']]]) {
    for (const f of fields) {
      if (f in obj && obj[f] !== null && typeof obj[f] !== 'string') errors.push(`${rel}: ${block}.${f} must be text`);
    }
  }
  // The mirror must build, because an exception here would surface at the next sync with no build to blame.
  try { buildDigestConfigMirror(parsed, new Date()); } catch (e) { errors.push(`${rel}: cannot be mirrored: ${e?.message || 'unknown'}`); }

  // The pitch rules, as WARNINGS on stderr, not errors. The owner ruled on 2026-09-19 that these warn and do
  // not block, so they must not red a build either. Printed here so the warning reaches whoever merges the
  // edit as well as whoever typed it, using the same `!` convention as the taxonomy gap notice below.
  const copyWarnings = ctaWarnings({ body: cta.body, linkLabel: cta.link_label, linkUrl: cta.link_url });
  if (copyWarnings.length) {
    console.warn(`! ${rel}: the digest pitch breaks ${copyWarnings.length} of its own rules. Saved anyway, by design:`);
    for (const w of copyWarnings) console.warn(`  - ${w}`);
  }
}

// sow-368 + sow-245: the AI-tool vocabulary has to be READABLE for the per-prompt check in validate-content.mjs to
// mean anything. Without this, deleting or breaking house/ai-tools.yml turns every targets check into a silent
// pass and the validator still prints a green tick.
function validateAiToolsVocabulary() {
  const rel = 'house/ai-tools.yml';
  if (!has(path.join(ROOT, rel))) { errors.push(`${rel}: missing, so no prompt's targets were checked against anything`); return; }
  if (!AI_TOOLS_DOC || typeof AI_TOOLS_DOC !== 'object') { errors.push(`${rel}: not valid YAML, so no prompt's targets were checked`); return; }
  const entries = aiToolEntries(AI_TOOLS_DOC);
  if (!entries.length) { errors.push(`${rel}: lists no usable tools (every entry needs a label), so no prompt's targets were checked`); return; }
  const seen = new Map();
  for (const { key, label } of entries) {
    const lower = label.toLowerCase();
    if (seen.has(lower)) errors.push(`${rel}: "${label}" (${key}) and "${seen.get(lower)}" differ only by case, which is the drift this list exists to prevent`);
    else seen.set(lower, label);
    if (/[\u2014\u2013]/.test(label)) errors.push(`${rel}: "${label}" carries a dash our writing conventions do not use`);
  }
}

// sow-109: the install steps a skill page shows, per tool (house/skill-install.yml). Every key must be a tool in
// house/ai-tools.yml, every folder must hold {name}, and every entry needs a run step. Unreadable is an error, not a
// pass: a skill page with no steps file would show none, and nothing else would say why.
function validateSkillInstall() {
  const rel = 'house/skill-install.yml';
  if (!has(path.join(ROOT, rel))) { errors.push(`${rel}: missing, so no skill page can show install steps`); return; }
  let doc = null;
  try { doc = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { /* reported below */ }
  if (!doc || typeof doc !== 'object') { errors.push(`${rel}: not valid YAML, so no skill page can show install steps`); return; }
  for (const problem of skillInstallProblems(doc, AI_TOOLS_DOC)) errors.push(`${rel}: ${problem}`);
}

// sow-305 + sow-245: the licence list has to be READABLE for the per-project check in validate-content.mjs to mean
// anything.
function validateLicenseVocabulary() {
  const rel = 'house/licenses.yml';
  if (!has(path.join(ROOT, rel))) { errors.push(`${rel}: missing, so no project's license was checked against anything`); return; }
  if (!LICENSES_DOC || typeof LICENSES_DOC !== 'object') { errors.push(`${rel}: not valid YAML, so no project's license was checked`); return; }
  const entries = licenseEntries(LICENSES_DOC);
  if (!entries.length) { errors.push(`${rel}: lists no licenses, so no project's license was checked`); return; }
  const seen = new Map();
  for (const { id, url } of entries) {
    const lower = id.toLowerCase();
    if (seen.has(lower)) errors.push(`${rel}: "${id}" and "${seen.get(lower)}" differ only by case, which is the drift this list exists to prevent`);
    else seen.set(lower, id);
    if (/[\u2014\u2013]/.test(id)) errors.push(`${rel}: "${id}" carries a dash our writing conventions do not use`);
    // Proprietary and Custom have no public page by design; everything else should link somewhere.
    if (!url && id !== 'Proprietary' && id !== 'Custom') errors.push(`${rel}: "${id}" has no https url, so its row would have nothing to link to`);
  }
}

// sow-372: the blocked-word list (house/news-banwords.yml). The runtime cores DROP a malformed entry rather
// than throwing, because they run inside the hourly ingest and the feed read where the only alternatives are
// blocking everything or blocking nothing. That is right there and wrong here: a word silently dropped is a
// word the superadmin believes is blocking and is not. So the build is where a bad entry is an ERROR.
function validateNewsBanwords() {
  const rel = 'house/news-banwords.yml';
  if (!has(path.join(ROOT, rel))) return; // optional: absent means nothing is blocked, which is where a fork starts
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { errors.push(`${rel}: must be a mapping with a words list`); return; }
  const raw = parsed.words;
  if (raw === undefined || raw === null) return; // an empty file blocks nothing, which is a legitimate state
  if (!Array.isArray(raw)) { errors.push(`${rel}: words must be a list`); return; }
  if (raw.length > BANWORD_LIMIT) errors.push(`${rel}: ${raw.length} words, over the limit of ${BANWORD_LIMIT}`);
  const seen = new Set();
  for (const entry of raw) {
    const word = normalizeBanword(entry);
    if (!word) {
      errors.push(`${rel}: ${JSON.stringify(entry)} is not a blocked word. Use ${BANWORD_MIN} to ${BANWORD_MAX} characters, lowercase letters and digits with at least one letter, single spaces or hyphens between them.`);
      continue;
    }
    if (word !== String(entry)) errors.push(`${rel}: write ${JSON.stringify(entry)} as "${word}". It is stored lowercase and matched case-insensitively, so two spellings are one word and only one of them is readable here.`);
    if (seen.has(word)) errors.push(`${rel}: "${word}" is listed twice`);
    seen.add(word);
  }
}

// SOW-119: the coupon registry (house/coupons.yml). A malformed coupon fails CI rather than silently
// granting nothing at signup (the runtime core also fails closed, but the author should know).
function validateCouponsConfig() {
  const rel = 'house/coupons.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  for (const err of validateCoupons(parsed, { file: rel })) errors.push(err);
}

// SOW-087: the content/share category -> Discord channel map (house/content-channels.yml). The same shape and
// rules as the news map (a list of { category, numeric channelId }, no duplicate category), validated by the
// same pure core with the file label swapped.
function validateContentChannelsConfig() {
  const rel = 'house/content-channels.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  for (const err of validateNewsChannels(parsed, { file: 'content-channels.yml' })) errors.push(err);
}

// SOW-054 + SOW-080: the followed-topic -> news-category map (house/topic-map.yml). Absent is fine; when present,
// every topic must be a real topic in house/topics.yml (the flat vocabulary, no longer the content taxonomy) and
// every mapped news category must be canonical. Pure validation lives in membership/topic-map.mjs.
function validateTopicMapConfig() {
  const rel = 'house/topic-map.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  let topicsParsed = {};
  try { topicsParsed = yaml.load(fs.readFileSync(path.join(ROOT, 'house/topics.yml'), 'utf8')); } catch { /* absent -> no topics */ }
  const opts = { topicKeys: topicVocabKeys(topicsParsed), newsCategories: CATEGORY_NAMES };
  for (const err of validateTopicMap(parsed, opts)) errors.push(err);
}

// sow-189: the superadmin content-flags registry (house/content-flags.yml). Every key must be <type>:<slug> and
// name a content file that exists, so a typo cannot flag nothing silently; every value must carry at least one
// of the two flags. The file may be absent or empty (nothing flagged).
function validateContentFlags() {
  const rel = 'house/content-flags.yml';
  const file = path.join(ROOT, rel);
  if (!has(file)) return;
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(file, 'utf8')); } catch { errors.push(`${rel}: not valid YAML`); return; }
  const flags = parsed && typeof parsed === 'object' ? parsed.flags : null;
  if (flags == null || (typeof flags === 'object' && !Array.isArray(flags) && Object.keys(flags).length === 0)) return;
  if (typeof flags !== 'object' || Array.isArray(flags)) { errors.push(`${rel}: flags must be a map of "<type>:<slug>" entries`); return; }
  const dirOf = { post: 'posts', project: 'projects', prompt: 'prompts' };
  const exists = (type, slug) => {
    const dir = dirOf[type];
    if (has(path.join(ROOT, 'house', dir, slug, 'index.md'))) return true;
    const members = path.join(ROOT, 'members');
    if (!has(members)) return false;
    return fs.readdirSync(members).some((u) => has(path.join(members, u, dir, slug, 'index.md')));
  };
  for (const [key, v] of Object.entries(flags)) {
    const m = /^(post|project|prompt):([a-z0-9][a-z0-9-]*)$/.exec(key);
    if (!m) { errors.push(`${rel}: key "${key}" is not <post|project|prompt>:<slug>`); continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`${rel}: "${key}" must be a map with stale and/or unindexed`); continue; }
    if (v.stale !== true && v.unindexed !== true) errors.push(`${rel}: "${key}" sets neither stale nor unindexed; remove the entry`);
    if (!exists(m[1], m[2])) errors.push(`${rel}: "${key}" names no content file (members/*/${dirOf[m[1]]}/${m[2]}/index.md or house/${dirOf[m[1]]}/${m[2]}/index.md)`);
  }
}

// sow-185: the membership tier data (house/membership-tiers.yml), the single source of truth for the homepage
// pricing accordion + the tier gating. REQUIRED: the site build (src/lib/tiers.ts) reads it directly. A missing
// tier, a purchasable tier with no price env var, or any malformed field fails CI. Pure validation lives in
// membership/tiers-display.mjs, the same parser the build uses.
function validateTiersConfig() {
  const rel = 'house/membership-tiers.yml';
  if (!has(path.join(ROOT, rel))) { errors.push(`${rel}: the required membership tier data file is missing`); return; }
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  const r = validateTierDisplay(parsed);
  if (!r.ok) errors.push(`${rel}: ${r.error}`);
}

// sow-281: the CTA registry (house/ctas.yml). Every CTA must pass the shared rules (the Amazon rule included) and
// every assignment must name a content item that exists, so a superadmin's PR with a wrong slug fails HERE, at PR
// time, with the slug in the message. The build itself does not refuse a wrong slug (it marks the assignment
// unresolved so the manager can show it), which is why this check has to. A missing file is a fork with no CTAs.
function validateCtaRegistry() {
  const rel = 'house/ctas.yml';
  if (!has(path.join(ROOT, rel))) return;
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  if (parsed === null || parsed === undefined) parsed = { ctas: [] };
  const problems = validateCtas(parsed);
  for (const p of problems) errors.push(`${rel}: ${p}`);
  if (problems.length) return;
  // sow-337: a card's image must be committed, a still WebP, and free of camera, location or profile data (the same
  // check the Worker runs on an upload, so a hand-made PR meets the rule the admin does).
  for (const c of parsed.ctas || []) {
    if (typeof c?.image !== 'string') continue;
    const info = ctaImageInfo(ROOT, c.image);
    if (!info.ok) errors.push(`${rel}: CTA "${c.id}" image ${c.image}: ${info.problem}`);
  }
  for (const a of assignmentsOf(parsed)) {
    if (!ctaItemExists(ROOT, a.type, a.ref)) {
      errors.push(`${rel}: CTA "${a.ctaId}" is assigned to ${a.type}:${a.ref}, which names no content item (a ${a.type === 'share' ? 'members/<author>/shares/<id>.md' : `members/*/${a.type}s/<slug>/index.md or house/${a.type}s/<slug>/index.md`} file). Fix the ref or unassign it in Admin, CTAs.`);
    }
  }
}

/**
 * Runs every house settings check, in the order validate-content.mjs always ran them.
 * @param {{ root: string, errors: string[], aiToolsDoc: unknown, licensesDoc: unknown }} ctx
 */
export function validateHouseConfig(ctx) {
  ({ root: ROOT, errors, aiToolsDoc: AI_TOOLS_DOC, licensesDoc: LICENSES_DOC } = ctx);
  validateOverrideConsistency();
  validateGrandfatherTiers();
  validateNewsChannelsConfig();
  validateDigestConfig();
  validateAiToolsVocabulary();
  validateSkillInstall();
  validateLicenseVocabulary();
  validateNewsBanwords();
  validateCouponsConfig();
  validateContentChannelsConfig();
  validateTopicMapConfig();
  validateContentFlags();
  validateTiersConfig();
  validateCtaRegistry();
}
