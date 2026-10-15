const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Date,Map,Set});
for(const f of ['TsProductSearch.gs','ManufacturerParameterParser.gs','PassportTsMappingWorklist.gs','ManufacturerComparison.gs','PassportComparisonPreview.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
const at='2026-10-15T12:00:00.000Z',hash='b'.repeat(64),tsHash='a'.repeat(64),url='https://manufacturer.example.com/model.pdf';
const ts={origin:'ORIGINAL_PROCUREMENT_DOCUMENT',lotId:'123',announcementId:'456',fullDocumentReviewed:true,currentVersionVerified:true,
 evidence:{sha256:tsHash,url:'https://goszakup.example.com/ts.pdf',observedAt:at},
 criteria:[{id:'H',requirement:'Напор >= 40м',evidence:{sha256:tsHash,locator:'page1'}}]};
const ocr={mode:'MANUFACTURER_PDF_FACT_CANDIDATES',reason:'OCR_LINES_CAPTURED_FACTS_AND_IDENTITY_NOT_VERIFIED',
 source:{sha256:hash,url},lines:[{id:'line1',pageNumber:1,startIndex:0,endIndex:9,verbatimText:'Head 42 m',sourceSha256:hash,sourceUrl:url,reviewStatus:'UNREVIEWED'}]};
const req=[{id:'H',parameterCode:'HEAD',operator:'GE',value:'40',unit:'m'}];
const w=c.planTenderPassportTsMappings(ocr,ts,req);
const product={brand:'CNP',model:'CDLF32',partNumber:'P1',source:{kind:'OFFICIAL_MANUFACTURER_DATASHEET',url,sha256:hash,version:'v1',observedAt:at,productIdentity:{brand:'CNP',model:'CDLF32',partNumber:'P1'}},
 facts:[{id:'line1',parameterCode:'HEAD',value:'42',unit:'m',pageNumber:1,locator:'0-9',verbatimText:'Head 42 m',sourceSha256:hash}]};
test('passport values compare via existing numeric engine, suggestions only',()=>{
 const r=c.previewTenderPassportComparison(ts,w,product,at);
 assert.equal(r.issue,null);assert.equal(r.mappings[0].kind,'NUMERIC');
 assert.equal(r.comparison.proposals[0].result,'SUGGEST_MATCH');
 assert.equal(r.technicalDecision,'TECHNICAL_REVIEW');assert.equal(r.verifiedTechnicalMatches,0);
});
test('changed fact never maps to original OCR anchor',()=>{
 const p=structuredClone(product);p.facts[0].value='50';
 const r=c.previewTenderPassportComparison(ts,w,p,at);
 assert.equal(r.mappings[0].kind,'UNMAPPED');
 assert.equal(r.comparison.proposals[0].result,'UNKNOWN');
});
test('mismatched source is blocked',()=>{
 const p=structuredClone(product);p.source.sha256='c'.repeat(64);
 assert.equal(c.previewTenderPassportComparison(ts,w,p,at).issue,'PASSPORT_COMPARISON_INPUT_INVALID');
});
