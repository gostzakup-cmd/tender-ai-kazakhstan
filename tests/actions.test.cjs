'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const ci = require('../tools/actions-deploy.cjs');
const upload = require('../tools/apps-script-upload.cjs');
const YAML = require('../tools/ci/node_modules/yaml');
const ROOT = path.resolve(__dirname, '..');
const CI_PATH = path.join(ROOT, 'tools/actions-deploy.cjs');
const SETTINGS = require('../tools/ci/deploy-settings.json');
const BASE_ENV = {GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: SETTINGS.repository,
  TENDER_DEFAULT_BRANCH: 'main', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1'};
function fixture(t, {implicit = false, duplicate = false} = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tender-actions-test-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const remote = path.join(base, 'remote.json'), calls = path.join(base, 'calls.json'), bin = path.join(base, 'clasp.cjs');
  const files = {Legacy: {type: 'SERVER_JS', source: 'function ' + (duplicate ? 'onOpen' : 'legacyFeature') + '() { return "PRIVATE_SERVER_SOURCE_TEST_ONLY"; }\n'},
    ExistingView: {type: 'HTML', source: '<p>KEEP_PRIVATE_TEST_ONLY</p>\n'},
    Config: {type: 'SERVER_JS', source: '// OLD CONFIG TEST ONLY\n'},
    appsscript: {type: 'JSON', source: JSON.stringify({runtimeVersion: 'V8', ...(implicit ? {} : {
      oauthScopes: ['https://www.googleapis.com/auth/drive.readonly']}),
      dependencies: {enabledAdvancedServices: [{userSymbol: 'Drive', serviceId: 'drive', version: 'v3'}]}})}};
  fs.writeFileSync(remote, JSON.stringify(files)); fs.writeFileSync(calls, '[]');
  fs.writeFileSync(bin, '#!' + process.execPath + '\n' + `
const fs=require('fs'),path=require('path'),upload=require(${JSON.stringify(path.join(ROOT, 'tools/apps-script-upload.cjs'))});
const mode=process.argv[2],calls=JSON.parse(fs.readFileSync(process.env.TEST_CALLS));calls.push(mode);fs.writeFileSync(process.env.TEST_CALLS,JSON.stringify(calls));
if(mode==='clone'){
 for(const [name,file] of Object.entries(JSON.parse(fs.readFileSync(process.env.TEST_REMOTE)))){
  const ext=file.type==='SERVER_JS'?'.js':file.type==='HTML'?'.html':'.json';fs.writeFileSync(name+ext,file.source);
 }
 fs.writeFileSync('.clasp.json',JSON.stringify({scriptId:upload.SCRIPT_ID,rootDir:'.'}));
}else if(mode==='push'){
 const files={};for(const [name,file] of Object.entries(upload.inventory(process.cwd())))files[name]={type:file.type,source:fs.readFileSync(file.file,'utf8')};
 if(process.env.TEST_DROP_FILE)delete files.ExistingView;
 fs.writeFileSync(process.env.TEST_REMOTE,JSON.stringify(files));
}else if(mode!=='status')process.exit(1);
`, {mode: 0o700});
  const key = crypto.randomBytes(32).toString('base64');
  const prep = path.join(base, 'prepare'), pub = path.join(base, 'publish'), plan = path.join(base, 'plan');
  function cli(mode, first, second, extra = {}) {
    const env = {...process.env, ...BASE_ENV, CLASP_BIN: bin, TEST_CALLS: calls, TEST_REMOTE: remote,
      APPS_SCRIPT_BACKUP_KEY: key, ...(mode === 'restore' || mode === 'snapshot-publish' || mode === 'publish' ? {
        GITHUB_RUN_ID: '200', REVIEW_RUN_ID: '100', REVIEW_RUN_ATTEMPT: '1',
        REVIEW_PLAN_SHA256: fs.existsSync(path.join(plan, 'review.json')) ? JSON.parse(fs.readFileSync(path.join(plan, 'review.json'))).digest : '',
        BACKUP_ARTIFACT_ID: '999'} : {}), ...extra};
    return spawnSync(process.execPath, [CI_PATH, mode, ...[first, second].filter(Boolean)], {encoding: 'utf8', env});
  }
  function prepare() {
    let result = cli('snapshot', prep, path.join(base, 'backup-artifact')); assert.equal(result.status, 0, result.stderr);
    result = cli('plan', prep, plan); assert.equal(result.status, 0, result.stderr);
    return JSON.parse(fs.readFileSync(path.join(plan, 'review.json')));
  }
  function restore() { const result = cli('restore', plan, pub); assert.equal(result.status, 0, result.stderr); }
  return {base, remote, calls, key, prep, pub, plan, cli, prepare, restore, files};
}
test('workflow is manual-only, read-only GitHub token and all actions pinned to commits', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(ROOT, '.github/workflows/apps-script-publish.yml'), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.operation.default, 'prepare');
  assert.deepEqual(workflow.permissions, {contents: 'read', actions: 'read'});
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.publish.environment, 'apps-script-production');
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  assert.match(workflow.jobs.publish.steps.find(s => s.name.startsWith('Download only')).with.name, /reviewed\.outputs\.artifact_name/);
  const steps = workflow.jobs.publish.steps;
  assert.ok(steps.findIndex(s => s.id === 'persist_fresh_backup') < steps.findIndex(s => s.name.startsWith('Publish exact')));
  assert.ok(steps.at(-1).if.includes('always()'));
});
test('manual default-branch guard rejects wrong repository, push event and non-default ref', () => {
  assert.equal(ci.context(BASE_ENV, 'prepare').repository, SETTINGS.repository);
  for (const extra of [{GITHUB_REPOSITORY: 'other/repo'}, {GITHUB_EVENT_NAME: 'push'}, {GITHUB_REF: 'refs/heads/unreviewed'}]) {
    assert.throws(() => ci.context({...BASE_ENV, ...extra}, 'prepare'));
  }
});
test('AES-GCM backup is opaque, round-trips and rejects wrong key or tampering', () => {
  const key = crypto.randomBytes(32), other = crypto.randomBytes(32), value = {source: 'PRIVATE_SERVER_SOURCE_TEST_ONLY'};
  const encoded = ci.seal(value, key);
  assert.ok(!encoded.includes(Buffer.from(value.source)));
  assert.deepEqual(ci.unseal(encoded, key), value);
  assert.throws(() => ci.unseal(encoded, other), /BACKUP_DECRYPTION_FAILED/);
  const corrupt = Buffer.from(encoded); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => ci.unseal(corrupt, key), /BACKUP_DECRYPTION_FAILED/);
});
test('backup extraction rejects traversal and credential filenames', () => {
  for (const name of ['../escape.gs', '/absolute.gs', 'sub\\escape.gs', '.clasprc.json', 'client_secret.json', '.env']) assert.throws(() => ci.validRelative(name));
  assert.doesNotThrow(() => ci.validRelative('.clasp.json'));
  assert.doesNotThrow(() => ci.validRelative('nested/Extra.gs'));
});
test('successful reviewed-run metadata must match workflow, repository, commit and branch', () => {
  const ctx = ci.context({...BASE_ENV, GITHUB_RUN_ID: '200'}, 'publish');
  const run = {id: 100, repository: {full_name: SETTINGS.repository}, path: SETTINGS.workflowPath,
    event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: BASE_ENV.GITHUB_SHA, run_attempt: 1};
  assert.equal(ci.validateReviewRun(run, ctx, '100').runAttempt, '1');
  for (const extra of [{head_sha: 'b'.repeat(40)}, {conclusion: 'failure'}, {event: 'pull_request'},
    {path: '.github/workflows/untrusted.yml'}, {head_branch: 'fork'}, {repository: {full_name: 'other/repo'}}]) {
    assert.throws(() => ci.validateReviewRun({...run, ...extra}, ctx, '100'), /REVIEW_RUN_NOT_TRUSTED/);
  }
});
test('preparation encrypts source snapshots and never writes to the remote project', t => {
  const f = fixture(t), review = f.prepare();
  assert.deepEqual(review.blockingIssues, []);
  assert.equal(review.context.operation, 'prepare');
  assert.equal(review.digest, ci.reviewDigest(review));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.calls)), ['clone']);
  const publicReview = fs.readFileSync(path.join(f.plan, 'review.json'), 'utf8');
  assert.ok(!publicReview.includes('PRIVATE_SERVER_SOURCE_TEST_ONLY'));
  const encrypted = fs.readFileSync(path.join(f.plan, 'prepared.enc'));
  assert.ok(!encrypted.includes(Buffer.from('PRIVATE_SERVER_SOURCE_TEST_ONLY')));
  const bundle = ci.unseal(encrypted, Buffer.from(f.key, 'base64'));
  assert.ok(bundle.backup.some(file => file.content.includes('PRIVATE_SERVER_SOURCE_TEST_ONLY')));
  assert.ok(!bundle.backup.concat(bundle.stage).some(file => /clasprc/.test(file.name)));
});
test('duplicate globals and implicit legacy scopes produce a blocked review plan', t => {
  for (const options of [{duplicate: true}, {implicit: true}]) {
    const f = fixture(t, options), review = f.prepare();
    assert.ok(review.blockingIssues.includes(options.duplicate ? 'DUPLICATE_GLOBAL_BINDING' : 'LEGACY_IMPLICIT_SCOPES_REVIEW_REQUIRED'));
    const result = f.cli('restore', f.plan, f.pub); assert.equal(result.status, 1); assert.match(result.stderr, /PLAN_HAS_BLOCKING_ISSUES/);
    assert.ok(!JSON.parse(fs.readFileSync(f.calls)).includes('push'));
  }
});
test('publish rejects missing or incorrect manually reviewed digest', t => {
  const f = fixture(t); f.prepare();
  for (const hash of ['', 'f'.repeat(64)]) {
    const result = f.cli('restore', f.plan, f.pub, {REVIEW_PLAN_SHA256: hash});
    assert.equal(result.status, 1); assert.match(result.stderr, /REVIEW_DIGEST_MISMATCH/);
  }
});
test('a changed commit or review run cannot reuse another plan', t => {
  const f = fixture(t); f.prepare();
  for (const extra of [{GITHUB_SHA: 'b'.repeat(40)}, {REVIEW_RUN_ID: '101'}, {REVIEW_RUN_ATTEMPT: '2'}]) {
    const result = f.cli('restore', f.plan, f.pub, extra); assert.equal(result.status, 1); assert.match(result.stderr, /REVIEW_CONTEXT_MISMATCH/);
  }
});
test('candidate inconsistent with reviewed source commit is rejected even with a recomputed digest', t => {
  const f = fixture(t), review = f.prepare(), key = Buffer.from(f.key, 'base64');
  const bundle = ci.unseal(fs.readFileSync(path.join(f.plan, 'prepared.enc')), key);
  const source = bundle.stage.find(x => x.name === 'Config.gs'); source.content += '\n// UNREVIEWED TEST CHANGE\n';
  review.after.Config.hash = crypto.createHash('sha256').update(source.content).digest('hex');
  review.digest = ci.reviewDigest(review); bundle.review = review;
  fs.writeFileSync(path.join(f.plan, 'review.json'), JSON.stringify(review));
  fs.writeFileSync(path.join(f.plan, 'prepared.enc'), ci.seal(bundle, key));
  const result = f.cli('restore', f.plan, f.pub); assert.equal(result.status, 1); assert.match(result.stderr, /UNREVIEWED_SOURCE_CHANGES/);
});
test('publish requires backup artifact receipt before any remote write', t => {
  const f = fixture(t); f.prepare(); f.restore();
  const result = f.cli('publish', f.pub, path.join(f.base, 'verification'), {BACKUP_ARTIFACT_ID: ''});
  assert.equal(result.status, 1); assert.match(result.stderr, /PERSISTED_BACKUP_ARTIFACT_REQUIRED/);
  assert.ok(!JSON.parse(fs.readFileSync(f.calls)).includes('push'));
});
test('remote changes since human review block publication after fresh encrypted backup', t => {
  const f = fixture(t); f.prepare(); f.restore();
  const files = JSON.parse(fs.readFileSync(f.remote)); files.ExistingView.source += 'changed'; fs.writeFileSync(f.remote, JSON.stringify(files));
  let result = f.cli('snapshot-publish', f.pub, path.join(f.base, 'fresh-backup-artifact')); assert.equal(result.status, 0, result.stderr);
  result = f.cli('publish', f.pub, path.join(f.base, 'verification')); assert.equal(result.status, 1); assert.match(result.stderr, /REMOTE_CHANGED_SINCE_REVIEW/);
  assert.ok(fs.existsSync(path.join(f.base, 'fresh-backup-artifact/backup.enc')));
  assert.ok(!JSON.parse(fs.readFileSync(f.calls)).includes('push'));
});
test('reviewed publication preserves unrelated files and verifies a fresh API read', t => {
  const f = fixture(t); f.prepare(); f.restore();
  let result = f.cli('snapshot-publish', f.pub, path.join(f.base, 'fresh-backup-artifact')); assert.equal(result.status, 0, result.stderr);
  result = f.cli('publish', f.pub, path.join(f.base, 'verification')); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UPLOAD_VERIFIED/);
  const actual = JSON.parse(fs.readFileSync(f.remote));
  assert.equal(actual.Legacy.source, f.files.Legacy.source); assert.equal(actual.ExistingView.source, f.files.ExistingView.source);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.calls)), ['clone', 'clone', 'clone', 'status', 'push', 'clone']);
  assert.ok(fs.existsSync(path.join(f.base, 'verification/verified.json')));
});
test('missing file after publication fails verification without a success report', t => {
  const f = fixture(t); f.prepare(); f.restore();
  let result = f.cli('snapshot-publish', f.pub, path.join(f.base, 'fresh-backup-artifact')); assert.equal(result.status, 0, result.stderr);
  result = f.cli('publish', f.pub, path.join(f.base, 'verification'), {TEST_DROP_FILE: '1'});
  assert.equal(result.status, 1); assert.match(result.stderr, /UPLOAD_NOT_VERIFIED/);
  assert.ok(!fs.existsSync(path.join(f.base, 'verification/verified.json')));
});
test('OAuth materialization writes a private temporary file and never logs credentials', t => {
  const f = fixture(t), secret = {tokens: {default: {type: 'authorized_user', client_id: 'TEST_CLIENT',
    client_secret: 'TEST_CLIENT_SECRET', refresh_token: 'TEST_REFRESH_TOKEN'}}};
  const auth = path.join(f.base, 'auth'), result = f.cli('auth', auth, null, {CLASP_AUTH_JSON: JSON.stringify(secret)});
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('TEST_REFRESH_TOKEN'));
  assert.equal(fs.statSync(path.join(auth, '.clasprc.json')).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(auth, '.clasprc.json'))), secret);
});
