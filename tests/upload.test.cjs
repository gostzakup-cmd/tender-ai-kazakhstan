'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const helper = require('../tools/apps-script-upload.cjs');
const helperPath = path.resolve(__dirname, '../tools/apps-script-upload.cjs');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tender-upload-test-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const remote = path.join(base, 'fake-remote.json'), log = path.join(base, 'calls.json');
  const files = {Code: {type: 'SERVER_JS', source: 'function oldFunction() {}\n'},
    ExistingView: {type: 'HTML', source: '<p>KEEP TEST ONLY</p>\n'},
    Config: {type: 'SERVER_JS', source: '// OLD TEST CONFIG\n'},
    appsscript: {type: 'JSON', source: JSON.stringify({runtimeVersion: 'V8',
      oauthScopes: ['https://www.googleapis.com/auth/drive.readonly'],
      dependencies: {enabledAdvancedServices: [{userSymbol: 'Drive', serviceId: 'drive', version: 'v3'}]},
      webapp: {access: 'MYSELF', executeAs: 'USER_DEPLOYING'}})}};
  fs.writeFileSync(remote, JSON.stringify(files)); fs.writeFileSync(log, '[]');
  const bin = path.join(base, 'fake-clasp.cjs');
  fs.writeFileSync(bin, '#!' + process.execPath + '\n' + `
const fs=require('node:fs'),path=require('node:path');
const helper=require(${JSON.stringify(helperPath)});
const mode=process.argv[2], remote=process.env.TEST_REMOTE, log=process.env.TEST_CALLS;
const calls=JSON.parse(fs.readFileSync(log));calls.push(mode);fs.writeFileSync(log,JSON.stringify(calls));
if(mode==='clone'){
 const files=JSON.parse(fs.readFileSync(remote));
 for(const [name,file] of Object.entries(files)) {
  const ext=file.type==='SERVER_JS'?'.js':file.type==='HTML'?'.html':'.json';
  fs.writeFileSync(path.join(process.cwd(),name+ext),file.source);
 }
 fs.writeFileSync('.clasp.json',JSON.stringify({scriptId:helper.SCRIPT_ID,rootDir:'.'}));
}else if(mode==='push'){
 const files={};for(const [name,file] of Object.entries(helper.inventory(process.cwd()))) {
  files[name]={type:file.type,source:fs.readFileSync(file.file,'utf8')};
 }
 if(process.env.TEST_DROP_FILE)delete files.ExistingView;
 fs.writeFileSync(remote,JSON.stringify(files));
}else if(mode!=='status'){process.exit(1);}
`, {mode: 0o700});
  function cli(mode, reviewed = false, extra = {}) {
    return spawnSync(process.execPath, [helperPath, mode, path.join(base, 'work'), ...(reviewed ? ['--reviewed'] : [])],
      {encoding: 'utf8', env: {...process.env, CLASP_BIN: bin, TEST_REMOTE: remote, TEST_CALLS: log, ...extra}});
  }
  return {base, remote, log, files, cli, stage: path.join(base, 'work/stage'), backup: path.join(base, 'work/backup')};
}
test('upload preparation clones a backup, retains unrelated JS/HTML and replaces same remote names', t => {
  const f = fixture(t); const result = f.cli('prepare'); assert.equal(result.status, 0, result.stderr);
  const before = helper.inventory(f.backup), after = helper.inventory(f.stage);
  assert.equal(before.Code.hash, after.Code.hash);
  assert.equal(before.ExistingView.hash, after.ExistingView.hash);
  assert.notEqual(before.Config.hash, after.Config.hash);
  assert.ok(fs.existsSync(path.join(f.stage, 'Config.gs')));
  assert.ok(!fs.existsSync(path.join(f.stage, 'Config.js')));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.log)), ['clone']);
});
test('manifest update preserves dependencies, explicit scopes and unrelated settings', t => {
  const f = fixture(t); assert.equal(f.cli('prepare').status, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.stage, 'appsscript.json')));
  assert.equal(manifest.dependencies.enabledAdvancedServices[0].userSymbol, 'Drive');
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.readonly'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.equal(manifest.webapp.access, 'MYSELF');
});
test('remote push is refused without local review', t => {
  const f = fixture(t); assert.equal(f.cli('prepare').status, 0);
  const result = f.cli('push'); assert.equal(result.status, 1); assert.match(result.stderr, /REVIEW_REQUIRED/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.log)), ['clone']);
});
test('reviewed push verifies all eight MVP files and retained remote files by fresh clone', t => {
  const f = fixture(t); assert.equal(f.cli('prepare').status, 0);
  const result = f.cli('push', true); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.status, 'UPLOAD_VERIFIED');
  assert.equal(report.files.length, 10); // seven scripts, manifest, two preserved files
  assert.deepEqual(JSON.parse(fs.readFileSync(f.log)), ['clone', 'clone', 'status', 'push', 'clone']);
  const actual = JSON.parse(fs.readFileSync(f.remote));
  assert.equal(actual.ExistingView.source, f.files.ExistingView.source);
  assert.equal(actual.Code.source, f.files.Code.source);
});
test('concurrent remote edit stops upload before push', t => {
  const f = fixture(t); assert.equal(f.cli('prepare').status, 0);
  const files = JSON.parse(fs.readFileSync(f.remote)); files.Code.source += '// NEW REMOTE EDIT\n';
  fs.writeFileSync(f.remote, JSON.stringify(files));
  const result = f.cli('push', true); assert.equal(result.status, 1); assert.match(result.stderr, /REMOTE_CHANGED/);
  assert.ok(!JSON.parse(fs.readFileSync(f.log)).includes('push'));
});
test('modified unrelated staged file stops before remote write', t => {
  const f = fixture(t); assert.equal(f.cli('prepare').status, 0);
  fs.writeFileSync(path.join(f.stage, 'ExistingView.html'), 'CHANGED');
  const result = f.cli('push', true); assert.equal(result.status, 1); assert.match(result.stderr, /UNRELATED_FILE_CHANGED/);
  assert.ok(!JSON.parse(fs.readFileSync(f.log)).includes('push'));
});
test('verification detects missing remote file and never reports uploaded success', t => {
  const f = fixture(t); assert.equal(f.cli('prepare').status, 0);
  const result = f.cli('push', true, {TEST_DROP_FILE: '1'}); assert.equal(result.status, 1);
  assert.match(result.stderr, /UPLOAD_NOT_VERIFIED/); assert.ok(!result.stdout.includes('UPLOAD_VERIFIED'));
});
test('inventory rejects symlinks and duplicate server names', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tender-inventory-test-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  fs.writeFileSync(path.join(base, 'appsscript.json'), '{}');
  fs.writeFileSync(path.join(base, 'Code.js'), '// test'); fs.writeFileSync(path.join(base, 'Code.gs'), '// test');
  assert.throws(() => helper.inventory(base), /DUPLICATE_REMOTE_FILE_NAME/);
  fs.unlinkSync(path.join(base, 'Code.gs')); fs.symlinkSync(path.join(base, 'Code.js'), path.join(base, 'Link.js'));
  assert.throws(() => helper.inventory(base), /SYMLINK_NOT_ALLOWED/);
});
