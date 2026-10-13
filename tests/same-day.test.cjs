const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const now = '2026-10-13T05:00:00.000Z';
function harness() {
  let calls = 0, claims = 0, unlocks = 0, fail = false, late = false;
  const ctx = vm.createContext({ Date, Map, Set, Utilities: {
    formatDate: (d,zone) => { assert.equal(zone, 'Asia/Qyzylorda'); return new Date(+d + 18000000).toISOString().slice(0,10); }
  }, apiDate_: (value, zone) => { assert.equal(zone, 'Asia/Qyzylorda'); if (!value) throw Error(); return new Date(value).toISOString(); },
  LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock: () => unlocks++})},
  safeApiError_: s => Error(s), v3Config_: () => ({endpoint: 'official', fields: {id:'id'}}),
  TENDER: {v3Endpoint:'official'}, V3_FIELDS: {id:'id'},
  pilotBudget_: () => ({used: () => claims, claim: () => claims++}),
  selection_: () => 'id', nationalSafeReport_: r => r,
  graphqlResponse_: (c,q,v) => {
    calls++; c.requestBudget.claim(); assert.deepEqual(Object.keys(v.filter), ['id']);
    assert.ok(v.filter.id.length <= 10); assert.equal(v.limit, v.filter.id.length);
    if (fail) throw Error('secret body');
    return {data:{Lots:v.filter.id.map(id => ({...lot(),id}))}};
  }});
  vm.runInContext(fs.readFileSync('SameDay.gs','utf8'),ctx);
  return {ctx, stats: () => ({calls,claims,unlocks}), fail: () => {fail = true;}};
}
function lot() { return {id:1,lotNumber:'881-ЗЦП1',trdBuyNumberAnno:'177-1',trdBuyId:177,
  amount:10000000,count:5,isDeleted:0,pointList:[881],Plans:[{id:881,refSubjectTypeId:1}],
  refTradeMethodsId:3,refBuyTradeMethodsId:6,RefLotsStatus:{code:'PublishedOfferAccept'},
  TrdBuy:{id:177,startDate:'2026-10-13T01:00:00Z',endDate:'2026-10-13T08:00:00Z',repeatStartDate:null,repeatEndDate:null}}; }
function policy() { return {approved:true,timezoneVerified:true,timezoneProofUrl:'https://official.example/proof',
  sourceTimezone:'Asia/Qyzylorda',portalTimezone:'Asia/Qyzylorda',repeatSelectionVerified:true,
  methodStatuses:[{approved:true,actualMethodId:6,codes:['PublishedOfferAccept']}]}; }
function run(row=lot(),p=policy(),stamp=now, ids=[1]) {
  return harness().ctx.shortlistTenderSameDay(Array.isArray(row)?row:[row],{date:'2026-10-13',ids},p,stamp);
}
test('inclusive budget and current effective deadline, never GO or national PASS',()=>{
  const r = run(); assert.equal(r.coverage,'sample_only'); assert.equal(r.items[0].decision,'SAME_DAY_CANDIDATE');
  assert.equal(r.items[0].nationalDecision,'HOLD_NATIONAL'); assert.equal(r.items[0].commercialDecision,'REVIEW');
  assert.equal(r.items[0].actualMethodId,6); assert.equal(r.items[0].plannedMethodId,3);
  assert.equal(r.items[0].sourceUrl,null);
});
test('timezone independent proof required',()=>{ for (const key of ['approved','timezoneVerified','repeatSelectionVerified']) {
  const p=policy(); p[key]=false; assert.equal(run(lot(),p).items[0].decision,'REVIEW_DATE');
}});
test('missing deadline, mismatched method and incomplete repeat stay REVIEW_DATE',()=>{
  for (const mutate of [r=>r.TrdBuy.endDate=null,r=>r.refBuyTradeMethodsId=3,r=>r.TrdBuy.repeatEndDate='2026-10-13T09:00:00Z']) {
    const r=lot(); mutate(r); assert.equal(run(r).items[0].decision,'REVIEW_DATE');
  }
});
test('repeat deadline supersedes ordinary expired deadline',()=>{
  const r=lot(); r.TrdBuy.endDate='2026-10-12T01:00:00Z'; r.TrdBuy.repeatStartDate='2026-10-13T01:00:00Z';
  r.TrdBuy.repeatEndDate='2026-10-13T09:00:00Z'; const item=run(r).items[0];
  assert.equal(item.decision,'SAME_DAY_CANDIDATE'); assert.equal(item.deadlineOrigin,'TrdBuy.repeatEndDate');
});
test('local midnight boundary and expired bids shown explicitly',()=>{
  const r=lot(); r.TrdBuy.endDate='2026-10-13T19:00:00Z'; assert.equal(run(r).items[0].decision,'NOT_SAME_DAY');
  r.TrdBuy.endDate=now; assert.equal(run(r).items[0].decision,'EXPIRED');
  assert.equal(run(lot(),policy(),'2026-10-13T10:00:00.000Z').items[0].decision,'EXPIRED');
});
test('not yet started does not claim open',()=>{const r=lot();r.TrdBuy.startDate='2026-10-13T06:00:00Z';assert.equal(run(r).items[0].decision,'REVIEW_DATE');});
test('Plans, quantity, deletion, identity and per-lot budget fail closed',()=>{
  for(const mutate of [r=>r.Plans=[],r=>r.amount=10000001,r=>r.count=0,r=>r.isDeleted=1,r=>r.TrdBuy.id=2,
    r=>r.Plans.push(r.Plans[0]),r=>r.Plans[0].refSubjectTypeId=2]) {const r=lot(); mutate(r); assert.equal(run(r).items[0].decision,'REVIEW');}
});
test('duplicate identity is quarantined and missing IDs reported',()=>{
  assert.equal(run([lot(),lot()],policy(),now,[1,2]).items[0].reason,'DUPLICATE_ID');
  assert.equal(run([],policy(),now).items[0].reason,'LOT_NOT_RETURNED');
  assert.equal(run([{...lot(),id:2}]).issue,'RESPONSE_SCOPE_INVALID');
});
test('bounded adapter makes at most 3 batches and shares retry quota; releases lock',()=>{
  const h=harness();const r=h.ctx.inspectTenderSameDay({date:'2026-10-13',ids:Array.from({length:30},(_,i)=>i+1)},policy());
  assert.equal(r.items.length,30);assert.equal(h.stats().calls,3);assert.equal(h.stats().claims,3);assert.equal(h.stats().unlocks,1);
});
test('source failures redact error bodies and no partial results',()=>{
  const h=harness();h.fail();const r=h.ctx.inspectTenderSameDay({date:'2026-10-13',ids:[1]},policy());
  assert.equal(r.items.length,0);assert.equal(r.issue,'SAME_DAY_SOURCE_OR_QUOTA_BLOCKED');assert.ok(!JSON.stringify(r).includes('secret'));assert.equal(h.stats().unlocks,1);
});
test('invalid ID scope prevents all API calls',()=>{const h=harness();const r=h.ctx.inspectTenderSameDay({date:'2026-10-13',ids:[1,1]},policy());assert.equal(r.issue,'SELECTION_INVALID');assert.equal(h.stats().calls,0);});
test('immutable inputs and no storage dependencies in pure view',()=>{
 const r=lot(),p=policy(),before=JSON.stringify([r,p]);run(r,p);assert.equal(JSON.stringify([r,p]),before);
});
test('retry attempts cannot exceed the four-attempt cap or expose partial results',()=>{
 const h=harness();let used=0;h.ctx.pilotBudget_=()=>({used:()=>used,claim:()=>used++});
 h.ctx.graphqlResponse_=(config)=>{for(let i=0;i<5;i++)config.requestBudget.claim();return {data:{Lots:[]}};};
 const r=h.ctx.inspectTenderSameDay({date:'2026-10-13',ids:[1]},policy());
 assert.equal(used,4);assert.equal(r.issue,'SAME_DAY_SOURCE_OR_QUOTA_BLOCKED');assert.equal(r.items.length,0);
});
test('a response arriving after the soft runtime cap is discarded',()=>{
 const h=harness();let elapsed=0;const RealDate=Date;
 h.ctx.Date=class extends RealDate{static now(){return RealDate.now()+elapsed;}};
 h.ctx.graphqlResponse_=(config)=>{config.requestBudget.claim();elapsed=31000;return {data:{Lots:[lot()]}};};
 const r=h.ctx.inspectTenderSameDay({date:'2026-10-13',ids:[1]},policy());
 assert.equal(r.issue,'SAME_DAY_SOURCE_OR_QUOTA_BLOCKED');assert.equal(r.items.length,0);assert.equal(h.stats().unlocks,1);
});
