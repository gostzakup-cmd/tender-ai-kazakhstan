#!/usr/bin/env node
'use strict';
// Local deployment helper, not part of the Apps Script application.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const SCRIPT_ID = '1_UmAJ7xfIks7b2Q_PjDt_xUoEzovUIh5V5e_leuiJW2O9MGA9maQGL-y';
const FILES = ['Config.gs', 'Sheets.gs', 'Api.gs', 'V3.gs', 'Pilot.gs', 'Sync.gs', 'Diagnostics.gs', 'SelfTests.gs'];
const ROOT = path.resolve(__dirname, '..');
const IGNORE = '**/**\n!**/*.gs\n!**/*.js\n!**/*.html\n!appsscript.json\n';
function check(condition, message) { if (!condition) throw new Error(message); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600}); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function hash(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function inventory(directory) {
  const result = {};
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const full = path.join(folder, entry.name);
      check(!entry.isSymbolicLink(), 'SYMLINK_NOT_ALLOWED');
      if (entry.isDirectory()) { walk(full); continue; }
      const relative = path.relative(directory, full).split(path.sep).join('/');
      const extension = path.extname(relative).toLowerCase();
      let type;
      if (['.js', '.gs'].includes(extension)) type = 'SERVER_JS';
      else if (extension === '.html') type = 'HTML';
      else if (relative === 'appsscript.json') type = 'JSON';
      else continue;
      const name = relative.slice(0, -extension.length);
      check(!Object.hasOwn(result, name), 'DUPLICATE_REMOTE_FILE_NAME');
      const content = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
      result[name] = {file: relative, type, hash: hash(type === 'JSON' ? JSON.stringify(canonical(JSON.parse(content))) : content)};
    }
  }
  walk(directory);
  check(result.appsscript && result.appsscript.type === 'JSON', 'MANIFEST_MISSING');
  return result;
}
function hashes(files) { return canonical(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, {type: v.type, hash: v.hash}]))); }
function compare(expected, actual) { return JSON.stringify(hashes(expected)) === JSON.stringify(hashes(actual)); }
function runClasp(args, cwd) {
  const executable = process.env.CLASP_BIN || 'clasp';
  const environment = {...process.env, NO_COLOR: '1', DEBUG: ''};
  delete environment.clasp_config_project;
  delete environment.clasp_config_ignore;
  const result = spawnSync(executable, args, {cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: environment});
  check(!result.error, 'CLASP_NOT_AVAILABLE: install @google/clasp@3.4.1 or set CLASP_BIN.');
  if (result.status !== 0) {
    // Never relay raw OAuth/server error bodies or credentials.
    const text = String(result.stdout || '') + String(result.stderr || '');
    const reason = /No credentials found/i.test(text) ? 'GOOGLE_OAUTH_REQUIRED' :
      /CONNECT.*403|tunnel.*403/i.test(text) ? 'PROXY_CONNECT_403' :
      /403|PERMISSION_DENIED|insufficient.*permission/i.test(text) ? 'GOOGLE_ACCESS_DENIED_OR_API_DISABLED' : 'CLASP_COMMAND_FAILED';
    throw new Error(reason + ': ' + args[0]);
  }
}
function clone(directory) {
  check(!fs.existsSync(directory), 'CLONE_DESTINATION_EXISTS');
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  runClasp(['clone', SCRIPT_ID], directory);
  check(json(path.join(directory, '.clasp.json')).scriptId === SCRIPT_ID, 'WRONG_SCRIPT_ID');
  return inventory(directory);
}
function buildStage(snapshot, repository, stage) {
  const before = inventory(snapshot);
  check(!fs.existsSync(stage), 'STAGE_EXISTS');
  fs.cpSync(snapshot, stage, {recursive: true});
  const changed = [];
  for (const filename of FILES) {
    const name = path.basename(filename, '.gs');
    if (before[name]) {
      check(before[name].type === 'SERVER_JS', 'FILE_TYPE_CONFLICT');
      fs.unlinkSync(path.join(stage, before[name].file)); // Same remote name is replaced, never deleted from remote.
    }
    fs.copyFileSync(path.join(repository, filename), path.join(stage, filename));
    changed.push({name, action: before[name] ? 'update' : 'add'});
  }
  const original = json(path.join(snapshot, 'appsscript.json'));
  const required = json(path.join(repository, 'appsscript.json'));
  const manifest = {...original, ...required,
    dependencies: {...original.dependencies, ...required.dependencies},
    oauthScopes: [...new Set([...(original.oauthScopes || []), ...required.oauthScopes])]};
  writeJson(path.join(stage, 'appsscript.json'), manifest);
  const config = json(path.join(snapshot, '.clasp.json'));
  writeJson(path.join(stage, '.clasp.json'), {...config, scriptId: SCRIPT_ID, rootDir: '.',
    scriptExtensions: ['.js', '.gs'], htmlExtensions: ['.html'], jsonExtensions: ['.json'], skipSubdirectories: false});
  // Exactly the cloned file set plus the MVP sources and manifest.
  fs.writeFileSync(path.join(stage, '.claspignore'), IGNORE, {mode: 0o600});
  const after = inventory(stage);
  for (const [name, file] of Object.entries(before)) {
    if (name !== 'appsscript' && !FILES.includes(name + '.gs')) {
      check(after[name] && after[name].hash === file.hash, 'UNRELATED_FILE_CHANGED');
    }
  }
  return {before, after, changed,
    preserved: Object.keys(before).filter(name => name !== 'appsscript' && !FILES.includes(name + '.gs')),
    implicitScopesNeedReview: !original.oauthScopes};
}
function prepare(workspace) {
  check(!fs.existsSync(workspace), 'WORKSPACE_EXISTS: choose a new private directory outside the repository.');
  check(!workspace.startsWith(ROOT + path.sep) && workspace !== ROOT, 'WORKSPACE_MUST_BE_OUTSIDE_REPOSITORY');
  fs.mkdirSync(workspace, {recursive: true, mode: 0o700});
  clone(path.join(workspace, 'backup'));
  const plan = buildStage(path.join(workspace, 'backup'), ROOT, path.join(workspace, 'stage'));
  writeJson(path.join(workspace, 'plan.json'), {scriptId: SCRIPT_ID, preparedAt: new Date().toISOString(), ...plan});
  fs.writeFileSync(path.join(workspace, 'REVIEW.md'),
    '# Apps Script upload review\n\nScript ID: ' + SCRIPT_ID + '\n\n' +
    'Full original project: backup/. Proposed project: stage/.\n' +
    'Compare both folders before upload, especially appsscript.json and existing MVP names.\n' +
    'Unrelated files retained: ' + plan.preserved.join(', ') + '\n\n' +
    'Check duplicate global functions/variables (especially onOpen) in retained files.\n' +
    'Existing explicit OAuth scopes/dependencies are retained. If original scopes were implicit, add the scopes needed by retained code to stage/appsscript.json before upload.\n' +
    'Script Properties are not fetched or changed. No deployments/triggers are created.\n', {mode: 0o600});
  console.log(JSON.stringify({status: 'PREPARED_ONLY', scriptId: SCRIPT_ID, workspace,
    changes: plan.changed, preserved: plan.preserved, implicitScopesNeedReview: plan.implicitScopesNeedReview}));
}
function push(workspace, reviewed) {
  check(reviewed, 'REVIEW_REQUIRED: compare backup/stage and pass --reviewed.');
  const plan = json(path.join(workspace, 'plan.json'));
  check(plan.scriptId === SCRIPT_ID, 'WRONG_SCRIPT_ID');
  const stage = path.join(workspace, 'stage');
  const config = json(path.join(stage, '.clasp.json'));
  check(config.scriptId === SCRIPT_ID, 'WRONG_SCRIPT_ID');
  check(config.rootDir === '.' && config.skipSubdirectories === false &&
    JSON.stringify(config.scriptExtensions) === JSON.stringify(['.js', '.gs']) &&
    JSON.stringify(config.htmlExtensions) === JSON.stringify(['.html']) &&
    JSON.stringify(config.jsonExtensions) === JSON.stringify(['.json']), 'STAGE_CONFIG_CHANGED');
  check(fs.readFileSync(path.join(stage, '.claspignore'), 'utf8') === IGNORE, 'STAGE_IGNORE_CHANGED');
  const expected = inventory(stage);
  // Reviewed changes may include extra scopes; existing unmanaged content must still be preserved.
  for (const name of plan.preserved) check(expected[name] && expected[name].hash === plan.before[name].hash, 'UNRELATED_FILE_CHANGED');
  for (const filename of FILES) check(expected[path.basename(filename, '.gs')], 'MVP_FILE_MISSING');
  const stamp = crypto.randomUUID();
  const current = clone(path.join(workspace, 'preflight-' + stamp));
  check(compare(plan.before, current), 'REMOTE_CHANGED: prepare a new snapshot before upload.');
  runClasp(['status'], stage);
  runClasp(['push', '--force'], stage);
  const actual = clone(path.join(workspace, 'verified-' + stamp));
  check(compare(expected, actual), 'UPLOAD_NOT_VERIFIED: keep the backup and inspect remote content; do not claim success.');
  writeJson(path.join(workspace, 'verified.json'), {scriptId: SCRIPT_ID, verifiedAt: new Date().toISOString(), files: hashes(actual)});
  console.log(JSON.stringify({status: 'UPLOAD_VERIFIED', scriptId: SCRIPT_ID, files: Object.keys(actual).sort(), backup: path.join(workspace, 'backup')}));
}
if (require.main === module) {
  process.umask(0o077);
  try {
    const [mode, folder, flag] = process.argv.slice(2);
    check(['prepare', 'push'].includes(mode) && folder, 'Usage: node tools/apps-script-upload.cjs prepare|push <private-folder> [--reviewed]');
    if (mode === 'prepare') prepare(path.resolve(folder)); else push(path.resolve(folder), flag === '--reviewed');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {SCRIPT_ID, FILES, inventory, hashes, compare, buildStage, prepare, push, clone};
