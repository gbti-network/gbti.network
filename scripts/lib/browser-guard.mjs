// sow-288: the shared discipline for the two browser-driven guards (check:csp, check:overflow). Both need a built
// dist and a Chromium, and both used to SKIP GREEN (exit 0) when either was missing, and to print a pass over zero
// pages. A skip that exits green in CI is a permanent silent pass, so:
//
//   - REQUIRE_BROWSER=1 turns every skip into a failure (the friendly local skip survives for anyone without a
//     browser installed). The weekly layout-guards job sets it; check-preview-shell established the pattern.
//   - zero pages checked is NEVER a pass, gate or no gate: a guard that loaded nothing is not evidence.
//   - a page that failed to load is noted locally and FAILS under the gate, because in CI an unreachable page is
//     a broken harness, not a fact about the site.
//
// Pure where it can be (verdict), so the decision is unit-tested; skipOrDie exits, and takes its exit and
// console as injectable deps so a test can observe it without dying.

/** Whether the strict mode is on for this process. Read from the env passed in, so a test can decide. */
export function requireBrowser(env = process.env) { return String(env?.REQUIRE_BROWSER ?? '') === '1'; }

/**
 * Skip (exit 0 with a note) or, under the gate, fail (exit 1 with the reason). Never returns.
 * `name` is the npm script name the message cites (check:csp / check:overflow).
 */
export function skipOrDie(name, msg, { requireBrowser: gate = false, exit = process.exit, log = console.log, error = console.error } = {}) {
  if (gate) {
    error(`✗ ${name} cannot run and REQUIRE_BROWSER is set, so a skip is a failure rather than a pass: ${msg}`);
    exit(1);
  } else {
    log(`· ${name} skipped: ${msg}`);
    exit(0);
  }
}

/**
 * The final decision for a browser guard run. `failures` are the guard's own findings; `loadFailures` are pages
 * the browser could not load; `checked` is the number of pages (or page/viewport renders) that were actually
 * examined. Returns { ok, reason }: `reason` is the sentence to print, on either outcome.
 */
export function verdict({ checked = 0, loadFailures = 0, failures = 0, requireBrowser: gate = false } = {}) {
  const n = Number(checked) || 0;
  const lf = Number(loadFailures) || 0;
  const f = Number(failures) || 0;
  if (n === 0) return { ok: false, reason: 'zero pages were checked, so this result is not evidence of anything; the harness loaded nothing (sow-288). Do not ignore this line.' };
  if (f > 0) return { ok: false, reason: `${f} finding${f === 1 ? '' : 's'} across ${n} checked` };
  if (gate && lf > 0) return { ok: false, reason: `${lf} page${lf === 1 ? '' : 's'} failed to load and REQUIRE_BROWSER is set, so an unreached page is a failure rather than a note` };
  return { ok: true, reason: lf > 0 ? `${lf} page${lf === 1 ? '' : 's'} failed to load (noted, not failed: REQUIRE_BROWSER is unset)` : '' };
}
