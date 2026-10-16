const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Set,Map});
vm.runInContext(fs.readFileSync('PassportProductReportBridge.gs','utf8'),c);
const ts={criteria:[{id:'C1',requirement:'Head >= 40m'}]};
const identity={brand:'CNP',model:'CDLF32',partNumber:'P1'};
function summary(){return {identity,summary:{mode:'PASSPORT_TS_CRITERIA_SUMMARY',issue:null,rows:[{criterionId:'C1',requirement:'Head >= 40m',proposal:'SUGGEST_MATCH',evidenceStatus:'UNREVIEWED'}],counts:{suggestMatch:1,suggestFail:0,unknown:0}}};}
function shortlist(decision){return {mode:'TECHNICAL_PRODUCT_SHORTLIST',issue:null,tsSourceVerified:true,products:[{...identity,decision,tsCompliancePercent:decision==='TECHNICAL_MATCH'?100:null,datasheetUrl:'https://manufacturer.example.com/a.pdf'}]};}
test('unreviewed passport suggestion cannot upgrade independent review',()=>{
 const r=c.buildTenderPassportProductReviewReport(ts,[summary()],shortlist('TECHNICAL_REVIEW'));
 assert.equal(r.issue,null);assert.equal(r.products[0].technicalDecision,'TECHNICAL_REVIEW');
 assert.equal(r.products[0].tsCompliancePercent,null);assert.equal(r.technicalMatchesVerified,0);
 assert.equal(r.products[0].passportSuggestions.suggestMatch,1);assert.equal(r.certificateGate,false);
});
test('independently verified technical match survives passport report bridge',()=>{
 const r=c.buildTenderPassportProductReviewReport(ts,[summary()],shortlist('TECHNICAL_MATCH'));
 assert.equal(r.products[0].technicalDecision,'TECHNICAL_MATCH');assert.equal(r.products[0].tsCompliancePercent,100);
 assert.equal(r.technicalMatchesVerified,1);assert.equal(r.commercialDecision,'REVIEW');
});
test('source mismatch and duplicate identities fail closed',()=>{
 const bad=summary();bad.summary.rows[0].requirement='different';
 assert.equal(c.buildTenderPassportProductReviewReport(ts,[bad],shortlist('TECHNICAL_REVIEW')).issue,'PASSPORT_REPORT_CRITERION_UNBOUND');
 assert.equal(c.buildTenderPassportProductReviewReport(ts,[summary(),summary()],shortlist('TECHNICAL_REVIEW')).issue,'DUPLICATE_PASSPORT_PRODUCT');
});
