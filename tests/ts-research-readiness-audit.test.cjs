const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Set,Map});
c.TS_CARD_BRIDGE={maxCards:5};
c.productCardHost_=u=>typeof u==='string'&&/^https:\/\/(?:www\.)?satu\.kz\//.test(u)?'satu.kz':null;
for(const f of ['TsProductSearch.gs','TsResearchReadinessAudit.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
const u='https://www.satu.kz/pump';
function row(){return {market:'KZ',productUrl:u,brand:'CNP',model:'CDLF32',partNumber:'P1',
 discoveryStatus:'UNREVIEWED',technicalDecision:'TECHNICAL_REVIEW',tsCompliancePercent:null,
 criteria:[{id:'H',parameterCode:'HEAD',operator:'GE',unit:'m',value:'40',minimum:null,maximum:null}],
 hints:[{criterionId:'H',status:'SUGGEST_MATCH',evidenceStatus:'UNREVIEWED',sourceUrl:u}]};}
test('complete product identity is ready only for manufacturer passport investigation',()=>{
 const r=c.auditTenderTsResearchReadiness({mode:'IMPORTED_TS_RESEARCH_PREVIEW',issue:null,products:[row()]});
 assert.equal(r.issue,null);assert.equal(r.completeIdentities,1);
 assert.equal(r.reviewable[0].status,'PASSPORT_REQUIRED_FOR_TECHNICAL_CONFIRMATION');
 assert.equal(r.technicalMatchesVerified,0);assert.equal(r.certificateGate,false);
});
test('missing exact part number is rejected without technical MATCH',()=>{
 const x=row();x.partNumber=null;
 const r=c.auditTenderTsResearchReadiness({mode:'TS_RESEARCH_PIPELINE_PREVIEW',issue:null,products:[x]});
 assert.equal(r.issue,null);assert.equal(r.reviewable.length,0);assert.equal(r.rejected.length,1);
});
test('forged 100 percent match and mismatched hint URL are rejected',()=>{
 let x=row();x.technicalDecision='TECHNICAL_MATCH';x.tsCompliancePercent=100;
 assert.equal(c.auditTenderTsResearchReadiness({mode:'TS_RESEARCH_PIPELINE_PREVIEW',issue:null,products:[x]}).issue,'TS_RESEARCH_AUDIT_BINDING_INVALID');
 x=row();x.hints[0].sourceUrl='https://www.satu.kz/other';
 assert.equal(c.auditTenderTsResearchReadiness({mode:'TS_RESEARCH_PIPELINE_PREVIEW',issue:null,products:[x]}).issue,'TS_RESEARCH_AUDIT_BINDING_INVALID');
});
test('replayed same card is rejected as duplicate',()=>{
 const r=c.auditTenderTsResearchReadiness({mode:'TS_RESEARCH_PIPELINE_PREVIEW',issue:null,products:[row(),row()]});
 assert.equal(r.issue,'TS_RESEARCH_AUDIT_DUPLICATE');
});
