// sow-295: the two deploy workflows call the guard before they install or build anything, deploy the Pages branch the
// guard chose rather than a hardcoded one, and move the content watermark only for main. The decisions themselves are
// tested in deploy-target.test.mjs; this pins the wiring, which is where a later edit would quietly undo them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

const load = (f) => {
  const doc = yaml.load(fs.readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8'));
  return { doc, on: doc.on ?? doc[true], steps: Object.values(doc.jobs)[0].steps };
};
const indexOf = (steps, pred, what) => {
  const i = steps.findIndex(pred);
  assert.ok(i >= 0, `no step found: ${what}`);
  return i;
};

test('deploy.yml: the guard runs before install, build and deploy, with every input passed through env', () => {
  const { on, steps } = load('deploy.yml');
  const inputs = on.workflow_dispatch.inputs;
  assert.deepEqual(inputs.target.options, ['production', 'preview']);
  assert.equal(inputs.target.default, 'production');
  assert.equal(inputs.confirm_branch.type, 'string');

  const guard = indexOf(steps, (s) => s.id === 'target', 'the guard (id: target)');
  assert.equal(steps[guard].run, 'node scripts/deploy-target.mjs guard');
  assert.deepEqual(steps[guard].env, {
    EVENT_NAME: '${{ github.event_name }}', REF_NAME: '${{ github.ref_name }}',
    TARGET: '${{ inputs.target }}', CONFIRM_BRANCH: '${{ inputs.confirm_branch }}',
  });
  assert.ok(guard < indexOf(steps, (s) => s.run === 'npm ci', 'npm ci'));
  assert.ok(guard < indexOf(steps, (s) => s.name === 'Build the site', 'the build'));
  assert.ok(guard < indexOf(steps, (s) => s.id === 'deploy', 'the deploy'));
});

test('deploy.yml: the Pages branch comes from the guard, and nothing hardcodes production any more', () => {
  const { steps } = load('deploy.yml');
  const deploy = steps[indexOf(steps, (s) => s.id === 'deploy', 'the deploy')];
  assert.equal(deploy.with.command, 'pages deploy dist --project-name=gbti-network --branch=${{ steps.target.outputs.deploy_branch }}');
  const raw = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(raw, /--branch=main/, 'a literal --branch=main would send every run, branch or preview, to production');
  assert.ok(indexOf(steps, (s) => s.name === 'Stamp the build', 'the stamp') < steps.indexOf(deploy), 'the stamp is uploaded with the build');
});

test('deploy.yml: only a main deploy marks and clears the content watermark', () => {
  const { steps } = load('deploy.yml');
  const mark = steps[indexOf(steps, (s) => /deploy-status\.mjs mark/.test(s.run || ''), 'mark')];
  const clear = steps[indexOf(steps, (s) => /deploy-status\.mjs clear/.test(s.run || ''), 'clear')];
  assert.equal(mark.if, "steps.target.outputs.mode == 'production'");
  assert.match(clear.if, /steps\.deploy\.outcome == 'success' && steps\.target\.outputs\.mode == 'production'/);
  const announce = steps[indexOf(steps, (s) => /notify-deploy\.mjs announce/.test(s.run || ''), 'announce')];
  assert.equal(announce['continue-on-error'], true, 'an announcement must never red a deploy that succeeded');
});

test('deploy-worker.yml: the guard (--worker) runs before install, tests and deploy', () => {
  const { on, steps } = load('deploy-worker.yml');
  assert.equal(on.workflow_dispatch.inputs.confirm_branch.type, 'string');
  const guard = indexOf(steps, (s) => s.id === 'target', 'the guard (id: target)');
  assert.equal(steps[guard].run, 'node scripts/deploy-target.mjs guard --worker');
  assert.equal(steps[guard].env.REF_NAME, '${{ github.ref_name }}');
  assert.equal(steps[guard].env.CONFIRM_BRANCH, '${{ inputs.confirm_branch }}');
  assert.ok(guard < indexOf(steps, (s) => s.run === 'npm ci', 'npm ci'));
  assert.ok(guard < indexOf(steps, (s) => s.name === 'Deploy', 'the deploy'));
});
