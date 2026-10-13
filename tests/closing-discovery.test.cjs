const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const ctx=vm.createContext({
    Date,Map,Set,
    safeApiError_: code=>new Error(code),
    Utilities:{formatDate:(d,z,f)=> {
      assert.equal(z,'UTC');
      return f==='yyyy-MM-dd' ? d.toISOString().slice(0,10) :
        d.toISOString().slice(0,19).replace('T',' ');
    }},
    apiDate_:(s,z)=>{assert.equal(z,'UTC');return s.replace(' ','T')+'Z';},
    shortlistTenderSameDay:(rows,selection,policy,at)=>({
      issue:null, items:rows.map(r=>({
        lotId:String(r.id), decision:'SAME_DAY_CANDIDATE',
        nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',reason:'CURRENT_ACCEPTANCE_DEADLINE_TODAY'
      }))
    })
  });
  vm.runInContext(fs.readFileSync('ClosingDiscovery.gs','utf8'),ctx);
  return ctx;
}
const policy={approved:true,timezoneVerified:true,repeatSelectionVerified:true,
  timezoneProofUrl:'https://ows.goszakup.gov.kz/help/',sourceTimezone:'UTC',portalTimezone:'UTC'};
const now='2026-10-13T12:00:00.000Z';
function streams() {
  return ['TrdBuy.publishDate','TrdBuy.lastUpdateDate','Lots.lastUpdateDate','Lots.indexDate',
    'Lots.byTrdBuyId'].map(name=>({name,returned:0,hasMore:false,totalReported:0}));
}
function source(lots=[]) {return {streams:streams(),lots,requests:5};}
const day={date:'2026-10-13',from:'2026-10-13 11:00:00',to:'2026-10-13 12:00:00'};
test('bounded discovery preserves sample-only, read-only and HOLD_NATIONAL',()=>{
  const r=fixture().assembleTenderClosingDiscovery(source([{id:11},{id:12}]),day,policy,now);
  assert.equal(r.mode,'SAME_DAY_SELECTED_IDS_READ_ONLY');
  assert.equal(r.discoveryMode,'OWS_V3_BOUNDED_AUTO');assert.equal(r.coverage,'sample_only');
  assert.equal(r.dailyCoverageVerified,false);assert.equal(r.sheetsChanged,false);
  assert.equal(r.watermarkAdvanced,false);assert.equal(r.items.length,2);
  assert.equal(r.items[0].lotId,'12');assert.equal(r.items[0].nationalDecision,'HOLD_NATIONAL');
});
test('conflicting source observations cannot become eligible',()=>{
  const r=fixture().assembleTenderClosingDiscovery(source([{id:3,amount:1},{id:3,amount:2}]),day,policy,now);
  assert.equal(r.items[0].decision,'REVIEW');assert.equal(r.items[0].reason,'SOURCE_CHANGED_DURING_SAMPLE');
});
test('partial pages are disclosed, never advertised as daily coverage',()=>{
  const s=source([{id:3}]);s.streams[0].hasMore=true;
  const r=fixture().assembleTenderClosingDiscovery(s,day,policy,now);
  assert.equal(r.streams[0].completePage,false);assert.equal(r.dailyCoverageVerified,false);
});
test('no source findings returns empty sample, never nationwide no-lots conclusion',()=>{
  const r=fixture().assembleTenderClosingDiscovery(source(),day,policy,now);
  assert.equal(r.items.length,0);assert.equal(r.coverage,'sample_only');
});
test('invalid dates, policy and source fail closed',()=>{
  const ctx=fixture();
  assert.throws(()=>ctx.closingDiscoveryDatePolicy_({...policy,timezoneVerified:false},{dateTimezone:'UTC'},Date.parse(now)),/UNVERIFIED/);
  assert.throws(()=>ctx.closingDiscoveryDatePolicy_(policy,{dateTimezone:'Asia\/Almaty'},Date.parse(now)),/UNVERIFIED/);
  assert.equal(ctx.assembleTenderClosingDiscovery(source([{id:0}]),day,policy,now).issue,'DISCOVERY_SOURCE_INVALID');
  assert.equal(ctx.assembleTenderClosingDiscovery(source(),{date:'bad'},policy,now).issue,'DISCOVERY_SOURCE_INVALID');
});
test('verified one-hour window uses one exact source timezone',()=>{
  const r=fixture().closingDiscoveryDatePolicy_(policy,{dateTimezone:'UTC'},Date.parse(now));
  assert.equal(r.from,'2026-10-13 11:00:00');assert.equal(r.to,'2026-10-13 12:00:00');
  assert.equal(r.date,'2026-10-13');
});
test('one-page intake checks total, cursor, order, schema and null',()=>{
  const ctx=fixture();const rows=[{id:9},{id:8}];
  const ok=(data,info)=>({
    data:{Lots:data},extensions:{pageInfo:{limitPage:10,totalCount:2,hasNextPage:false,lastId:0,...info}}
  });
  const run=(resp)=>{ctx.graphqlResponse_=()=>resp;return ctx.closingDiscoveryPage_({requestBudget:{}},'Lots',{id:[9,8]},'id');};
  assert.equal(run(ok(rows)).rows.length,2);
  assert.throws(()=>run(ok([{id:8},{id:9},{id:7}],{totalCount:2})),/PAGE_UNVERIFIED/);
  assert.throws(()=>run(ok([{id:8},{id:8}])),/ORDER_INVALID/);
  assert.throws(()=>run(ok(rows,{hasNextPage:true,lastId:99})),/CURSOR_UNVERIFIED/);
  assert.equal(run(ok(null,{totalCount:0})).rows.length,0);
  assert.throws(()=>run(ok(null)),/PAGE_UNVERIFIED/);
  assert.throws(()=>run(ok(rows,{limitPage:20})),/PAGE_INFO_UNVERIFIED/);
  assert.throws(()=>ctx.closingDiscoveryPage_({},'Other',{},'id'),/ROOT_INVALID/);
});
test('out-of-window and malformed dates do not qualify',()=>{
  const ctx=fixture();const low=Date.parse('2026-10-13T11:00:00Z'),high=Date.parse(now);
  assert.equal(ctx.closingDiscoveryInWindow_('2026-10-13 11:30:00','UTC',low,high),true);
  assert.equal(ctx.closingDiscoveryInWindow_('2026-10-13 10:59:59','UTC',low,high),false);
  assert.equal(ctx.closingDiscoveryInWindow_('', 'UTC',low,high),false);
});
