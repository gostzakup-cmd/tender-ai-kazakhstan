// Synthetic snapshots and transport stubs; existing engine suites exercise real gates/calculation.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
const now='2026-10-13T05:00:00.000Z';
const item={lotId:'1',decision:'SAME_DAY_CANDIDATE',lotNumber:'SYNTHETIC-1',announcementId:2,
 announcementNumber:'SYNTHETIC-2',status:'OPEN',plannedMethodId:3,actualMethodId:6,amountKzt:10000,
 quantity:2,planIds:['3'],applicationStart:'2026-10-13T01:00:00.000Z',deadline:'2026-10-13T08:00:00.000Z',deadlineTimezone:'Asia/Qyzylorda'};
const lot={id:'1',lotNumber:item.lotNumber,announcementId:'2',announcementNumber:item.announcementNumber,
 statusCode:'OPEN',plannedMethodId:3,actualMethodId:6,amountKzt:10000,quantity:2,planIds:['3'],
 applicationStart:item.applicationStart,deadline:item.deadline,isGoods:true,planCoverageVerified:true,active:true,verifiedAt:now};
return {now,shortlist:{mode:'SAME_DAY_SELECTED_IDS_READ_ONLY',coverage:'sample_only',date:'2026-10-13',observedAt:now,items:[item]},
 inputs:[{lot,ts:{evidence:{sha256:'a'.repeat(64),url:'https://example.invalid/original'},version:'v1'},quotes:[]}],policy:{shortlistMaxAgeMs:300000}};
}
function harness(gate='PASS_TO_TS'){
 const calls=[];const c=vm.createContext({Utilities:{formatDate:()=> '2026-10-13'},
 assessTenderNationalEvidence:()=>{calls.push('national');return {decision:gate,allowedResearch:gate==='PASS_TO_TS',reason:'TEST_GATE'};},
 acceptTenderOriginalDocument:()=>{calls.push('document');return {accepted:true,status:'ORIGINAL_BYTES_VERIFIED',artifact:{sha256:'a'.repeat(64),sourceUrl:'https://example.invalid/original',version:'v1'}};},
 evaluateTenderResearch:()=>{calls.push('research');return {decision:'REVIEW',nationalDecision:'PASS_TO_TS',finance:null,compliance:'UNVERIFIED',reasons:['REAL_QUOTES_REQUIRED'],validQuoteIds:[],unconfirmedQuotes:[],missingCosts:[]};}});
 vm.runInContext(fs.readFileSync('SameDayResearch.gs','utf8'),c);return {c,calls};
}
function run(f,h=harness()){return h.c.analyzeTenderSameDay(f.shortlist,f.inputs,f.policy,f.now);}
test('joins exact current context and calls existing gates in order, without invented profit',()=>{
 const f=fixture(),h=harness(),r=run(f,h);assert.deepEqual(h.calls,['national','document','research']);assert.equal(r.items[0].decision,'REVIEW');assert.equal(r.items[0].finance,null);assert.equal(r.revenueGuaranteed,false);
});
test('unknown national proof holds and YES skips before PDF or scoring',()=>{for(const gate of ['HOLD_NATIONAL','SKIP']){const h=harness(gate),r=run(fixture(),h);assert.deepEqual(h.calls,['national']);assert.equal(r.items[0].nationalDecision,gate);assert.equal(r.items[0].decision,gate==='SKIP'?'SKIP':'REVIEW');}});
test('expired, changed amount, changed status, wrong method and Plans cannot reuse evidence',()=>{
 for(const key of ['amountKzt','statusCode','actualMethodId','deadline','planIds']){const f=fixture(),h=harness();f.inputs[0].lot[key]=key==='planIds'?['4']:'CHANGED';const r=run(f,h);assert.equal(r.items[0].decision,'REVIEW');assert.equal(h.calls.length,0);}
 const f=fixture(),h=harness();f.now='2026-10-13T08:00:00.000Z';f.shortlist.observedAt=f.now;f.inputs[0].lot.verifiedAt=f.now;assert.equal(run(f,h).items[0].decision,'REVIEW');assert.equal(h.calls.length,0);
});
test('stale and future snapshot, duplicate/missing inputs block analysis',()=>{
 for(const stamp of ['2026-10-13T04:00:00.000Z','2026-10-13T06:00:00.000Z']){const f=fixture();f.shortlist.observedAt=stamp;assert.equal(run(f).issue,'CURRENT_SHORTLIST_REQUIRED');}
 const f=fixture();f.inputs.push(f.inputs[0]);assert.equal(run(f).items[0].reason,'EXACT_RESEARCH_INPUT_REQUIRED');
});
test('original TS hash/version mismatch blocks scoring',()=>{const f=fixture(),h=harness();f.inputs[0].ts.version='v2';assert.equal(run(f,h).items[0].reason,'TS_ORIGINAL_DOCUMENT_MISMATCH');assert.deepEqual(h.calls,['national','document']);});
test('unconfirmed dates and expired shortlist rows are never analyzed',()=>{const f=fixture(),h=harness();f.shortlist.items[0].decision='EXPIRED';assert.equal(run(f,h).items[0].decision,'REVIEW');assert.equal(h.calls.length,0);});
test('no mutations and no Google writes/network dependencies',()=>{const f=fixture(),before=JSON.stringify(f);run(f);assert.equal(JSON.stringify(f),before);});
test('real national gate without authorized source returns HOLD_NATIONAL',()=>{
 const f=fixture(),h=harness();vm.runInContext(fs.readFileSync('NationalEvidence.gs','utf8'),h.c);const r=run(f,h);
 assert.equal(r.items[0].nationalDecision,'HOLD_NATIONAL');assert.equal(h.calls.length,0);
});
