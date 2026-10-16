'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const uploader=require('../tools/apps-script-upload.cjs');
const root=path.resolve(__dirname,'..');
test('every root .gs file is included in deploy inventory',()=>{
 const actual=fs.readdirSync(root).filter(n=>/^[A-Za-z][A-Za-z0-9_-]*\.gs$/.test(n)).sort();
 assert.ok(actual.length>8,'must include extended modules, not only legacy MVP files');
 assert.deepEqual(uploader.FILES,actual);
 for(const n of ['TsResearchPipeline.gs','ManufacturerComparison.gs','TechnicalSelection.gs','ClosingDiscovery.gs','PassportProductReportBridge.gs'])
  assert.ok(uploader.FILES.includes(n),n+' must deploy');
});
test('deployment only includes root Apps Script sources and no fixtures or secrets',()=>{
 for(const n of uploader.FILES){
  assert.equal(path.dirname(n),'.');
  assert.match(n,/\.gs$/);
  assert.ok(fs.statSync(path.join(root,n)).isFile());
 }
 assert.ok(!uploader.FILES.some(n=>n.includes('tests')||n.includes('secret')));
});
