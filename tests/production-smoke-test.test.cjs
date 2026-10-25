const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Date});vm.runInContext(fs.readFileSync('ProductionSmokeTest.gs','utf8'),c);
const at='2026-10-25T12:00:00.000Z';
function fixture(){return {mode:'PUBLIC_PORTAL_TODAY_MVP',issue:null,date:'2026-10-25',pages:[{}],portalReportedTotal:182,parsedRows:50,items:[{lotId:'100',detailChecked:true,decision:'NOT_OPEN'},{lotId:'101',detailChecked:false,decision:'REVIEW_DATE'}]};}
test('realistic sampled portal run is never a claim of full daily coverage or GO',()=>{
 const r=c.summarizeTenderProductionSmokeTest(fixture(),at);
 assert.equal(r.status,'READ_ONLY_SAMPLE_COMPLETED');assert.equal(r.detailChecked,1);
 assert.equal(r.confirmedNotOpen,1);assert.equal(r.unverified,1);
 assert.equal(r.openVerified,0);assert.equal(r.autonomousGo,false);assert.equal(r.dailyCoverageVerified,false);
});
test('collector errors block production smoke readiness',()=>{
 const f=fixture();f.issue='PORTAL_SOURCE_SCHEMA_OR_QUOTA_BLOCKED';
 assert.equal(c.summarizeTenderProductionSmokeTest(f,at).status,'BLOCKED');
});
test('duplicate lot IDs and forged OPEN decisions blocked',()=>{
 let f=fixture();f.items[1].lotId='100';
 assert.equal(c.summarizeTenderProductionSmokeTest(f,at).issue,'PUBLIC_LOT_ID_OR_DECISION_INVALID');
 f=fixture();f.items[1].decision='GO';
 assert.equal(c.summarizeTenderProductionSmokeTest(f,at).issue,'PUBLIC_LOT_ID_OR_DECISION_INVALID');
});
test('run entry point delegates only to bounded existing collector',()=>{
 c.inspectTenderTodayMvp=()=>fixture();
 const result=c.runTenderProductionSmokeTest();assert.equal(result.status,'READ_ONLY_SAMPLE_COMPLETED');
});
