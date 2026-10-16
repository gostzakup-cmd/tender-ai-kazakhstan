const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Set,Map});
vm.runInContext(fs.readFileSync('PassportCriteriaSummary.gs','utf8'),c);
const hash='a'.repeat(64);
const ts={evidence:{sha256:hash},criteria:[{id:'C1',requirement:'Head >= 40 m'},{id:'C2',requirement:'Power <= 5 kW'}]};
const preview={mode:'PASSPORT_TS_COMPARISON_PREVIEW',issue:null,comparison:{
 status:'SUGGESTIONS_ONLY',proposals:[
 {criterionId:'C1',requirement:'Head >= 40 m',tsSha256:hash,result:'SUGGEST_MATCH',manufacturerSha256:'b'.repeat(64),datasheetPage:1,datasheetLocator:'row1',reason:'UNIT_EXACT'},
 {criterionId:'C2',requirement:'Power <= 5 kW',tsSha256:hash,result:'UNKNOWN',manufacturerSha256:'b'.repeat(64),datasheetPage:null,datasheetLocator:null,reason:'NO_FACT'}
 ]}};
test('exhaustive preview summary preserves UNKNOWN and never asserts TS compliance',()=>{
 const r=c.summarizeTenderPassportCriteria(ts,preview);
 assert.equal(r.issue,null);assert.equal(r.totalCriteria,2);
 assert.equal(r.counts.suggestMatch,1);assert.equal(r.counts.unknown,1);
 assert.equal(r.tsCompliancePercent,null);assert.equal(r.allCriteriaVerified,false);
 assert.equal(r.technicalDecision,'TECHNICAL_REVIEW');assert.equal(r.certificateGate,false);
});
test('even all suggestions MATCH is not 100% verified',()=>{
 const x=structuredClone(preview);x.comparison.proposals[1].result='SUGGEST_MATCH';
 const r=c.summarizeTenderPassportCriteria(ts,x);
 assert.equal(r.counts.suggestMatch,2);assert.equal(r.allCriteriaVerified,false);
});
test('forged criterion source hash fails closed',()=>{
 const x=structuredClone(preview);x.comparison.proposals[0].tsSha256='c'.repeat(64);
 assert.equal(c.summarizeTenderPassportCriteria(ts,x).issue,'PASSPORT_CRITERIA_SUMMARY_BINDING_INVALID');
});
