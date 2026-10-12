const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../NationalEvidence.gs'),'utf8'),context);
function fixture(){
 const now='2026-10-12T08:00:00Z';
 const lot={id:'1',lotNumber:'SYNTHETIC-1',announcementId:'2',announcementNumber:'SYNTHETIC-2',statusCode:'OPEN',plannedMethodId:3,actualMethodId:3,revisionHash:'c'.repeat(64),planIds:['3'],verifiedAt:now,isGoods:true,planCoverageVerified:true,active:true,amountKzt:10000000,quantity:2,applicationStart:'2026-10-12T07:00:00Z',deadline:'2026-10-13T08:00:00Z'};
 const proof={kind:'OFFICIAL_PER_LOT',restriction:'NO',adapterId:'SYNTHETIC_ONLY',url:'https://example.invalid/proof',sha256:'a'.repeat(64),version:'SYNTHETIC-v1',observedAt:now,context:structuredClone(lot),allPlanRowsVerified:true,methodAndExceptionsVerified:true};
 const policy={approved:true,maxAgeMs:3600000,sources:[{approved:true,adapterId:proof.adapterId,artifacts:[structuredClone(proof)]}]};
 return {lot,proof,policy,now};
}
const run=f=>context.assessTenderNationalEvidence(f.lot,f.proof,f.policy,f.now);
test('synthetic reviewed, current and fully bound absence passes; restriction skips',()=>{const f=fixture();assert.equal(run(f).decision,'PASS_TO_TS');f.proof.restriction='YES';f.policy.sources[0].artifacts[0].restriction='YES';assert.equal(run(f).decision,'SKIP');});
for(const key of ['id','lotNumber','announcementId','announcementNumber','statusCode','plannedMethodId','actualMethodId','revisionHash'])test('changed '+key+' holds',()=>{const f=fixture();f.lot[key]='CHANGED';assert.equal(run(f).decision,'HOLD_NATIONAL');});
for(const scenario of ['missing proof','manual PASS','unknown flag','unapproved source','changed hash','stale proof','future proof','stale lot','mixed plans','unknown exception','missing policy','closed','over budget'])test('fails closed: '+scenario,()=>{
 const f=fixture();if(scenario==='missing proof')f.proof=null;if(scenario==='manual PASS')f.proof={decision:'PASS_TO_TS'};if(scenario==='unknown flag')f.proof.restriction='UNKNOWN';if(scenario==='unapproved source')f.policy.sources=[];if(scenario==='changed hash')f.proof.sha256='b'.repeat(64);if(scenario==='stale proof')f.proof.observedAt='2020-01-01';if(scenario==='future proof')f.proof.observedAt='2030-01-01';if(scenario==='stale lot')f.lot.verifiedAt='2020-01-01';if(scenario==='mixed plans')f.lot.planIds.push('4');if(scenario==='unknown exception')f.proof.methodAndExceptionsVerified=false;if(scenario==='missing policy')f.policy=null;if(scenario==='closed')f.lot.active=false;if(scenario==='over budget')f.lot.amountKzt=10000000.01;assert.equal(run(f).decision,'HOLD_NATIONAL');
});
test('replay is deterministic and inputs untouched; no Google services exist in VM',()=>{const f=fixture(),before=JSON.stringify(f);assert.equal(JSON.stringify(run(f)),JSON.stringify(run(f)));assert.equal(JSON.stringify(f),before);});

test('approved YES artifact cannot be relabelled NO using the same hash',()=>{const f=fixture();f.policy.sources[0].artifacts[0].restriction='YES';assert.equal(run(f).decision,'HOLD_NATIONAL');});

for(const key of ['amountKzt','quantity','applicationStart','deadline','isGoods','planCoverageVerified','active'])test('current commercial state '+key+' cannot change under the same approved revision',()=>{const f=fixture();f.lot[key]=key==='amountKzt'?9000000:'CHANGED';assert.equal(run(f).decision,'HOLD_NATIONAL');});
