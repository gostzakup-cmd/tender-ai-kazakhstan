#!/usr/bin/env node
'use strict';
// GitHub Actions orchestration. OAuth and encryption keys are never serialized into artifacts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const acorn = require('./ci/node_modules/acorn');
const upload = require('./apps-script-upload.cjs');
const ROOT = path.resolve(__dirname, '..');
const SETTINGS = require('./ci/deploy-settings.json');
const MAGIC = Buffer.from('TENDER-CI-1\n');
const MAX_BYTES = 64 * 1024 * 1024;
function check(ok, message) { if (!ok) throw new Error(message); }
function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (_) { throw new Error('INVALID_JSON_FILE'); }
}
function writeJson(filename, value) { fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', {mode: 0o600}); }
function initializePaths() {
  check(process.env.RUNNER_TEMP && process.env.GITHUB_ENV && !/[\r\n]/.test(process.env.RUNNER_TEMP), 'RUNNER_TEMP_REQUIRED');
  const folders = {TENDER_WORK_DIR: 'work', TENDER_AUTH_DIR: 'auth', TENDER_BACKUP_DIR: 'backup-artifact',
    TENDER_PLAN_DIR: 'plan-artifact', TENDER_REVIEW_DIR: 'reviewed-artifact', TENDER_REPORT_DIR: 'verification-artifact'};
  for (const [name, suffix] of Object.entries(folders)) {
    fs.appendFileSync(process.env.GITHUB_ENV, name + '=' + path.join(process.env.RUNNER_TEMP, 'tender-apps-script-' + suffix) + '\n');
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function reviewDigest(review) { const {digest: omitted, ...body} = review; return digest(body); }
function context(env = process.env, operation) {
  check(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'MANUAL_DISPATCH_REQUIRED');
  check(env.GITHUB_REPOSITORY === SETTINGS.repository, 'WRONG_REPOSITORY');
  check(env.TENDER_DEFAULT_BRANCH && env.GITHUB_REF === 'refs/heads/' + env.TENDER_DEFAULT_BRANCH, 'DEFAULT_BRANCH_REQUIRED');
  check(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ''), 'COMMIT_REQUIRED');
  check(/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'RUN_ID_REQUIRED');
  check(['prepare', 'publish'].includes(operation), 'INVALID_OPERATION');
  check(SETTINGS.scriptId === upload.SCRIPT_ID, 'WRONG_SCRIPT_ID');
  return {repository: env.GITHUB_REPOSITORY, sourceCommit: env.GITHUB_SHA,
    defaultBranch: env.TENDER_DEFAULT_BRANCH, runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT, operation, scriptId: SETTINGS.scriptId};
}
function privateDirectory(directory, mustBeNew = true) {
  const absolute = path.resolve(directory);
  check(absolute !== ROOT && !absolute.startsWith(ROOT + path.sep), 'PRIVATE_DIRECTORY_MUST_BE_OUTSIDE_CHECKOUT');
  if (mustBeNew) check(!fs.existsSync(absolute), 'PRIVATE_DIRECTORY_EXISTS');
  fs.mkdirSync(absolute, {recursive: true, mode: 0o700});
  return absolute;
}
function encryptionKey(value = process.env.APPS_SCRIPT_BACKUP_KEY) {
  check(typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value), 'BACKUP_KEY_REQUIRED: base64 of 32 random bytes.');
  const key = Buffer.from(value, 'base64');
  check(key.length === 32 && key.toString('base64') === value, 'BACKUP_KEY_INVALID');
  return key;
}
function seal(value, key = encryptionKey()) {
  const plaintext = Buffer.from(JSON.stringify(value));
  check(plaintext.length <= MAX_BYTES, 'BACKUP_TOO_LARGE');
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}
function unseal(bytes, key = encryptionKey()) {
  check(bytes.length <= MAX_BYTES + 128 && bytes.length > MAGIC.length + 28 && bytes.subarray(0, MAGIC.length).equals(MAGIC), 'INVALID_ENCRYPTED_BACKUP');
  try {
    const iv = bytes.subarray(MAGIC.length, MAGIC.length + 12), tag = bytes.subarray(MAGIC.length + 12, MAGIC.length + 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(MAGIC.length + 28)), decipher.final()]).toString('utf8'));
  } catch (_) { throw new Error('BACKUP_DECRYPTION_FAILED'); }
}
function validRelative(filename) {
  check(typeof filename === 'string' && filename && !filename.startsWith('/') && !filename.includes('\\') &&
    !filename.split('/').some(x => !x || x === '.' || x === '..'), 'UNSAFE_BACKUP_PATH');
  const base = path.posix.basename(filename).toLowerCase();
  check(!/clasprc|client_secret|credentials|\.env/.test(base), 'CREDENTIAL_FILE_IN_BACKUP');
  check(/\.(gs|js|html)$/i.test(filename) || filename === 'appsscript.json' || filename === '.clasp.json' || filename === '.claspignore', 'UNSUPPORTED_BACKUP_FILE');
}
function packDirectory(directory) {
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      check(!entry.isSymbolicLink(), 'SYMLINK_IN_BACKUP');
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const filename = path.relative(directory, full).split(path.sep).join('/'); validRelative(filename);
      files.push({name: filename, content: fs.readFileSync(full, 'utf8')});
    }
  }
  walk(directory);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
function unpackDirectory(files, directory) {
  check(Array.isArray(files) && files.length > 0 && files.length <= 10000, 'INVALID_BACKUP_FILES');
  privateDirectory(directory);
  const names = new Set();
  for (const file of files) {
    validRelative(file.name); check(!names.has(file.name), 'DUPLICATE_BACKUP_PATH'); names.add(file.name);
    check(typeof file.content === 'string', 'INVALID_BACKUP_CONTENT');
    const destination = path.join(directory, file.name);
    fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
    fs.writeFileSync(destination, file.content, {mode: 0o600});
  }
}
function materializeAuth(directory) {
  const root = privateDirectory(directory);
  let auth;
  try { auth = JSON.parse(process.env.CLASP_AUTH_JSON || ''); }
  catch (_) { throw new Error('CLASP_AUTH_JSON_REQUIRED'); }
  const credential = auth && auth.tokens && auth.tokens.default;
  check(credential && credential.type === 'authorized_user' &&
    ['client_id', 'client_secret', 'refresh_token'].every(k => typeof credential[k] === 'string' && credential[k].trim()), 'CLASP_V3_DEFAULT_USER_REQUIRED');
  const filename = path.join(root, '.clasprc.json'); writeJson(filename, {tokens: {default: credential}});
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, 'clasp_config_auth=' + filename + '\n');
  console.log('OAuth credentials materialized in a private temporary file.');
}
function stageChecks(stage, plan) {
  const issues = [], globals = new Map(), sources = [];
  function bindings(pattern) {
    if (!pattern) return [];
    if (pattern.type === 'Identifier') return [pattern.name];
    if (pattern.type === 'RestElement') return bindings(pattern.argument);
    if (pattern.type === 'AssignmentPattern') return bindings(pattern.left);
    if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindings);
    if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(p => bindings(p.value || p.argument));
    return [];
  }
  for (const [name, file] of Object.entries(upload.inventory(stage))) {
    if (file.type !== 'SERVER_JS') continue;
    const source = fs.readFileSync(path.join(stage, file.file), 'utf8'); sources.push(source);
    let program;
    try { program = acorn.parse(source, {ecmaVersion: 2022, sourceType: 'script'}); }
    catch (_) { throw new Error('STAGE_SYNTAX_INVALID'); }
    for (const node of program.body) {
      const names = node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' ? bindings(node.id) :
        node.type === 'VariableDeclaration' ? node.declarations.flatMap(d => bindings(d.id)) : [];
      for (const binding of names) {
        if (globals.has(binding)) issues.push('DUPLICATE_GLOBAL_BINDING'); else globals.set(binding, name);
      }
    }
  }
  try { new vm.Script(sources.join('\n;\n')); } catch (_) { throw new Error('STAGE_SYNTAX_INVALID'); }
  const retainedJs = plan.preserved.some(name => plan.before[name].type === 'SERVER_JS');
  if (plan.implicitScopesNeedReview && retainedJs && SETTINGS.legacyImplicitScopes === null) issues.push('LEGACY_IMPLICIT_SCOPES_REVIEW_REQUIRED');
  return [...new Set(issues)];
}
function applyLegacyScopes(stage) {
  const extra = SETTINGS.legacyImplicitScopes;
  check(extra === null || (Array.isArray(extra) && extra.every(s => typeof s === 'string' && /^https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._-]+$/.test(s))), 'INVALID_LEGACY_SCOPES');
  if (extra) {
    const manifestPath = path.join(stage, 'appsscript.json'), manifest = readJson(manifestPath);
    manifest.oauthScopes = [...new Set([...manifest.oauthScopes, ...extra])]; writeJson(manifestPath, manifest);
  }
}
function snapshot(workspace, output, operation) {
  const ctx = context(process.env, operation);
  privateDirectory(workspace, operation === 'prepare'); privateDirectory(output);
  const folder = path.join(workspace, operation === 'prepare' ? 'backup' : 'fresh-backup');
  upload.clone(folder);
  fs.writeFileSync(path.join(output, 'backup.enc'), seal({version: 1, kind: 'backup', context: ctx, files: packDirectory(folder)}), {mode: 0o600});
  console.log('Encrypted full Apps Script backup created; no remote changes.');
}
function preparePlan(workspace, output) {
  const ctx = context(process.env, 'prepare'); privateDirectory(output);
  const plan = upload.buildStage(path.join(workspace, 'backup'), ROOT, path.join(workspace, 'stage'));
  applyLegacyScopes(path.join(workspace, 'stage')); plan.after = upload.inventory(path.join(workspace, 'stage'));
  const review = {version: 1, context: ctx, before: upload.hashes(plan.before), after: upload.hashes(plan.after),
    changes: plan.changed, preserved: plan.preserved, blockingIssues: stageChecks(path.join(workspace, 'stage'), plan),
    manifestBefore: readJson(path.join(workspace, 'backup/appsscript.json')),
    manifestAfter: readJson(path.join(workspace, 'stage/appsscript.json'))};
  // Manifests may contain project-specific configuration: include only a curated public summary.
  const oldManifest = review.manifestBefore, newManifest = review.manifestAfter;
  delete review.manifestBefore; delete review.manifestAfter;
  review.manifestChanges = {timezoneBefore: oldManifest.timeZone || null, timezoneAfter: newManifest.timeZone,
    scopesAdded: newManifest.oauthScopes.filter(s => !(oldManifest.oauthScopes || []).includes(s)),
    existingDependenciesPreserved: true};
  review.digest = reviewDigest(review);
  writeJson(path.join(output, 'review.json'), review);
  fs.writeFileSync(path.join(output, 'prepared.enc'), seal({version: 1, kind: 'plan', review,
    backup: packDirectory(path.join(workspace, 'backup')), stage: packDirectory(path.join(workspace, 'stage')), plan}), {mode: 0o600});
  const summary = '## Apps Script review plan\n\nRun: ' + ctx.runId + ' / attempt ' + ctx.runAttempt +
    '\n\nSource commit: `' + ctx.sourceCommit + '`\n\nPlan SHA-256: `' + review.digest +
    '`\n\nBlocking issues: ' + (review.blockingIssues.join(', ') || 'none') +
    '\n\nNo publication performed. Download the encrypted plan artifact and inspect it before a separate publish dispatch.\n';
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(JSON.stringify({status: 'PREPARED_ONLY', reviewRunId: ctx.runId, reviewRunAttempt: ctx.runAttempt, planSha256: review.digest, blockingIssues: review.blockingIssues}));
}
function validateReviewRun(run, ctx, runId) {
  check(/^[1-9][0-9]*$/.test(runId || ''), 'REVIEW_RUN_ID_REQUIRED');
  check(run && String(run.id) === runId && run.repository && run.repository.full_name === ctx.repository &&
    run.path === SETTINGS.workflowPath && run.event === 'workflow_dispatch' && run.status === 'completed' &&
    run.conclusion === 'success' && run.head_branch === ctx.defaultBranch && run.head_sha === ctx.sourceCommit &&
    Number.isInteger(run.run_attempt) && run.run_attempt > 0, 'REVIEW_RUN_NOT_TRUSTED');
  check(runId !== ctx.runId, 'SEPARATE_MANUAL_REVIEW_REQUIRED');
  return {runId, runAttempt: String(run.run_attempt), sourceCommit: run.head_sha};
}
async function resolveReviewRun() {
  const ctx = context(process.env, 'publish'), runId = process.env.REVIEW_RUN_ID;
  check(/^[1-9][0-9]*$/.test(runId || ''), 'REVIEW_RUN_ID_REQUIRED');
  check(/^[a-f0-9]{64}$/.test(process.env.REVIEW_PLAN_SHA256 || ''), 'REVIEW_PLAN_SHA256_REQUIRED');
  check(process.env.GITHUB_TOKEN, 'GITHUB_TOKEN_REQUIRED');
  const response = await fetch('https://api.github.com/repos/' + SETTINGS.repository + '/actions/runs/' + runId, {
    redirect: 'error', signal: AbortSignal.timeout(30000), headers: {Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}});
  check(response.ok, 'REVIEW_RUN_LOOKUP_FAILED');
  const reviewed = validateReviewRun(await response.json(), ctx, runId);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    'artifact_name=tender-apps-script-plan-' + reviewed.runId + '-' + reviewed.runAttempt + '\n');
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, 'REVIEW_RUN_ATTEMPT=' + reviewed.runAttempt + '\n');
  console.log('Successful preparation run on the same repository, workflow and commit verified.');
}
function validateReview(review, ctx, env = process.env) {
  check(review && review.version === 1 && review.context && review.context.operation === 'prepare', 'PREPARATION_PLAN_REQUIRED');
  const c = review.context;
  check(c.repository === ctx.repository && c.scriptId === ctx.scriptId && c.sourceCommit === ctx.sourceCommit &&
    c.defaultBranch === ctx.defaultBranch && c.runId === env.REVIEW_RUN_ID && c.runAttempt === env.REVIEW_RUN_ATTEMPT && c.runId !== ctx.runId, 'REVIEW_CONTEXT_MISMATCH');
  check(/^[a-f0-9]{64}$/.test(env.REVIEW_PLAN_SHA256 || '') && review.digest === env.REVIEW_PLAN_SHA256 && reviewDigest(review) === review.digest, 'REVIEW_DIGEST_MISMATCH');
  check(Array.isArray(review.blockingIssues) && review.blockingIssues.length === 0, 'PLAN_HAS_BLOCKING_ISSUES');
}
function restoreReviewedPlan(input, workspace) {
  const ctx = context(process.env, 'publish'), review = readJson(path.join(input, 'review.json'));
  validateReview(review, ctx);
  const bundle = unseal(fs.readFileSync(path.join(input, 'prepared.enc')));
  check(bundle.kind === 'plan' && bundle.version === 1 && digest(bundle.review) === digest(review), 'ENCRYPTED_PLAN_MISMATCH');
  privateDirectory(workspace);
  unpackDirectory(bundle.backup, path.join(workspace, 'backup'));
  unpackDirectory(bundle.stage, path.join(workspace, 'stage'));
  check(upload.compare(review.before, upload.inventory(path.join(workspace, 'backup'))) &&
    upload.compare(review.after, upload.inventory(path.join(workspace, 'stage'))), 'PLAN_CONTENT_MISMATCH');
  const recomputed = upload.buildStage(path.join(workspace, 'backup'), ROOT, path.join(workspace, 'recomputed'));
  applyLegacyScopes(path.join(workspace, 'recomputed'));
  check(upload.compare(review.after, upload.inventory(path.join(workspace, 'recomputed'))), 'UNREVIEWED_SOURCE_CHANGES');
  check(stageChecks(path.join(workspace, 'stage'), recomputed).length === 0, 'STAGE_CHECKS_FAILED');
  writeJson(path.join(workspace, 'plan.json'), {scriptId: ctx.scriptId, ...recomputed});
  writeJson(path.join(workspace, 'approved.json'), review);
  console.log('Exact reviewed candidate and unchanged source commit validated; no publication performed.');
}
function publish(workspace, reportDirectory) {
  const ctx = context(process.env, 'publish');
  check(/^[1-9][0-9]*$/.test(process.env.BACKUP_ARTIFACT_ID || ''), 'PERSISTED_BACKUP_ARTIFACT_REQUIRED');
  const review = readJson(path.join(workspace, 'approved.json')); validateReview(review, ctx);
  check(upload.compare(review.before, upload.inventory(path.join(workspace, 'fresh-backup'))), 'REMOTE_CHANGED_SINCE_REVIEW');
  check(upload.compare(review.after, upload.inventory(path.join(workspace, 'stage'))), 'STAGE_CHANGED_SINCE_REVIEW');
  upload.push(workspace, true); // Performs another fresh getContent before updateContent and getContent verification afterwards.
  privateDirectory(reportDirectory);
  const verified = readJson(path.join(workspace, 'verified.json'));
  check(upload.compare(review.after, verified.files), 'POST_PUBLISH_VERIFICATION_FAILED');
  writeJson(path.join(reportDirectory, 'verified.json'), {context: ctx, planSha256: review.digest, ...verified});
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '\n## Publication verified\n\nAll file names, types and content hashes match the reviewed candidate after fresh Apps Script API getContent.\n');
}
function inspect(input, output) {
  const filename = fs.existsSync(path.join(input, 'prepared.enc')) ? 'prepared.enc' : 'backup.enc';
  const bundle = unseal(fs.readFileSync(path.join(input, filename))); privateDirectory(output);
  if (bundle.kind === 'plan') {
    unpackDirectory(bundle.backup, path.join(output, 'backup')); unpackDirectory(bundle.stage, path.join(output, 'stage'));
    writeJson(path.join(output, 'review.json'), bundle.review);
  } else {
    check(bundle.kind === 'backup', 'INVALID_BACKUP_KIND'); unpackDirectory(bundle.files, path.join(output, 'backup'));
  }
  console.log('Decrypted into a private directory. Do not commit or upload plaintext files.');
}
if (require.main === module) {
  process.umask(0o077);
  (async () => {
    const [mode, first, second] = process.argv.slice(2);
    if (mode === 'paths') initializePaths();
    else if (mode === 'guard') { context(process.env, first); console.log('Manual default-branch repository guard passed.'); }
    else if (mode === 'auth') materializeAuth(first);
    else if (mode === 'snapshot') snapshot(first, second, 'prepare');
    else if (mode === 'plan') preparePlan(first, second);
    else if (mode === 'resolve') await resolveReviewRun();
    else if (mode === 'restore') restoreReviewedPlan(first, second);
    else if (mode === 'snapshot-publish') snapshot(first, second, 'publish');
    else if (mode === 'publish') publish(first, second);
    else if (mode === 'inspect') inspect(first, second);
    else throw new Error('UNKNOWN_CI_COMMAND');
  })().catch(error => { console.error(error.message && /^[A-Z_]+(?::[^\r\n]*)?$/.test(error.message) ? error.message : 'CI_OPERATION_FAILED'); process.exitCode = 1; });
}
module.exports = {context, seal, unseal, digest, reviewDigest, validRelative, packDirectory, unpackDirectory,
  validateReviewRun, validateReview, stageChecks, materializeAuth, preparePlan, restoreReviewedPlan, snapshot, publish};
