const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const ctx=vm.createContext({Set,Map});
for(const f of ['TsProductSearch.gs','ManufacturerParameterParser.gs','PassportTsMappingWorklist.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const sha='a'.repeat(64),url='https://manufacturer.example.com/manual.pdf';
const ocr={mode:'MANUFACTURER_PDF_FACT_CANDIDATES',reason:'OCR_LINES_CAPTURED_FACTS_AND_IDENTITY_NOT_VERIFIED',
 source:{sha256:sha,url},lines:[{id:'p1-0',pageNumber:1,startIndex:0,endIndex:9,verbatimText:'Head 42 m',sourceSha256:sha,sourceUrl:url,reviewStatus:'UNREVIEWED'}]};
const ts={origin:'ORIGINAL_PROCUREMENT_DOCUMENT',criteria:[{id:'C1',requirement:'Head >= 40 m'}],evidence:{sha256:'b'.repeat(64)}};
const req=[{id:'C1',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'}];
test('OCR parameter becomes unreviewed criterion mapping only',()=>{
 const r=ctx.planTenderPassportTsMappings(ocr,ts,req);
 assert.equal(r.issue,null);assert.equal(r.items.length,1);
 assert.equal(r.items[0].factCandidates[0].proposedValue,'42');
 assert.equal(r.items[0].mappingStatus,'SUGGESTED_MAPPING_REVIEW_REQUIRED');
 assert.equal(r.items[0].result,'UNKNOWN');
 assert.equal(r.manufacturerFactsVerified,0);assert.equal(r.certificateGate,false);
});
test('missing criterion and forged source hash fail closed',()=>{
 assert.equal(ctx.planTenderPassportTsMappings(ocr,ts,[{...req[0],id:'X'}]).issue,'TS_CRITERIA_NOT_EXHAUSTIVELY_BOUND');
 const altered=structuredClone(ocr);altered.lines[0].sourceSha256='c'.repeat(64);
 assert.equal(ctx.planTenderPassportTsMappings(altered,ts,req).issue,'OCR_ANCHOR_OR_SOURCE_INVALID');
});
test('ambiguous unknown does not become TS match',()=>{
 const changed=structuredClone(ocr);changed.lines[0].verbatimText='Head 42-48 m';
 changed.lines[0].endIndex=changed.lines[0].verbatimText.length;
 const r=ctx.planTenderPassportTsMappings(changed,ts,req);
 assert.equal(r.items[0].mappingStatus,'UNKNOWN');assert.equal(r.tsCompliance,'UNVERIFIED');
});
