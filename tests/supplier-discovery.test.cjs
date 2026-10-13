const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const ctx=vm.createContext({Date,Map,Set,encodeURIComponent,Utilities:{formatDate:(d,z)=>{assert.equal(z,'UTC');return d.toISOString().slice(0,10);}}});
 for(const f of ['SupplierIntake.gs','ProductCardProbe.gs','SupplierDiscovery.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
 return ctx;
}
const stamp=new Date().toISOString(),date=stamp.slice(0,10);
function shortlist(){return {mode:'SAME_DAY_SELECTED_IDS_READ_ONLY',coverage:'sample_only',date,observedAt:new Date(Date.now()-1000).toISOString(),
 items:[{lotId:'123',decision:'SAME_DAY_CANDIDATE',deadline:new Date(Date.now()+180000).toISOString(),
 applicationStart:new Date(Date.now()-60000).toISOString(),deadlineTimezone:'UTC'}]};}
function targets(){return [{lotId:'123',provider:'SATU',origin:'KZ',expected:{brand:'CNP',model:'CDLF32-80',partNumber:'CDLF32-80-F'}}];}
function plan(){return setup().planTenderSupplierDiscovery(shortlist(),targets(),{},new Date().toISOString());}
test('plans canonical exact brand/model/PN search with fixed source domain',()=>{
 const r=plan();assert.equal(r.issue,null);assert.equal(r.queries.length,1);
 assert.equal(r.queries[0].domain,'satu.kz');
 assert.equal(r.queries[0].query,'"CNP" "CDLF32-80" "CDLF32-80-F" site:satu.kz');
 assert.equal(r.supplierOffersVerified,0);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
});
test('no invented dates, domain, national proof or unpublished lot',()=>{
 const c=setup();const s=shortlist();s.items[0].decision='EXPIRED';
 assert.equal(c.planTenderSupplierDiscovery(s,targets(),{},new Date().toISOString()).issue,'SEARCH_LOT_NOT_CURRENT');
 const t=targets();t[0].domain='malicious.kz';
 assert.equal(c.planTenderSupplierDiscovery(shortlist(),t,{},new Date().toISOString()).issue,'SEARCH_IDENTITY_OR_DOMAIN_UNVERIFIED');
 const noDate=shortlist();noDate.items[0].deadlineTimezone='unknown';
 assert.equal(c.planTenderSupplierDiscovery(noDate,targets(),{},new Date().toISOString()).issue,'SEARCH_LOT_NOT_CURRENT');
});
test('query injection and duplicates cannot generate unbounded or arbitrary searches',()=>{
 const c=setup(),t=targets();t[0].expected.model='bad" OR site:evil.com';
 assert.equal(c.planTenderSupplierDiscovery(shortlist(),t,{},new Date().toISOString()).issue,'SEARCH_IDENTITY_OR_DOMAIN_UNVERIFIED');
 assert.equal(c.planTenderSupplierDiscovery(shortlist(),[...targets(),...targets()],{},new Date().toISOString()).issue,'SEARCH_DUPLICATE_DOMAIN');
 assert.equal(c.planTenderSupplierDiscovery(shortlist(),Array(7).fill(targets()[0]),{},new Date().toISOString()).issue,'SUPPLIER_SEARCH_INPUT_INVALID');
});
test('unapproved API/billing requires zero network calls or quota claims',()=>{
 const c=setup();let fetch=0,claims=0;
 c.UrlFetchApp={fetch:()=>{fetch++;throw Error('should not fetch');}};
 c.pilotBudget_=()=>({claim:()=>claims++});
 const r=c.inspectTenderSupplierDiscovery(shortlist(),targets(),{});
 assert.equal(r.issue,'SEARCH_SUBSCRIPTION_AND_BILLING_APPROVAL_REQUIRED');
 assert.equal(fetch,0);assert.equal(claims,0);
});
test('search results are links, not trusted product or supplier evidence',()=>{
 const c=setup(),p=plan().queries[0];
 const parsed=c.parseTenderSupplierSearch_({query:{original:p.query},
 web:{results:[{url:'https://www.satu.kz/p100.html',title:'CNP CDLF32-80-F',description:'test'},
 {url:'https://satu.kz.evil.com/p100.html',title:'evil'},{url:'http://www.satu.kz/p101',title:'insecure'}]}},p);
 assert.equal(parsed.length,1);assert.equal(parsed[0].verification,'PENDING_PRODUCT_CARD');
 assert.equal(parsed[0].offerPriceKzt,null);assert.equal(parsed[0].stockVerified,false);
 assert.equal(parsed[0].nationalDecision,'HOLD_NATIONAL');
});
test('schema mismatch and excessive results are blocked before unsafe promotion',()=>{
 const c=setup(),p=plan().queries[0];
 assert.throws(()=>c.parseTenderSupplierSearch_({web:{results:[]}},p),/SCHEMA/);
 assert.throws(()=>c.parseTenderSupplierSearch_({query:{original:p.query},web:{results:Array(6).fill({url:'https://satu.kz/p',title:'t'})}},p),/SCHEMA/);
});
test('read-only opt-in API uses one request and strips secrets from result',()=>{
 const c=setup();let calls=0,claims=0,unlocks=0;
 c.PropertiesService={getScriptProperties:()=>({getProperty:()=> '123456789012345678901234'})};
 c.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>unlocks++})};
 c.pilotBudget_=()=>({claim:()=>claims++});
 c.UrlFetchApp={fetch:(url,opts)=>{calls++;assert.ok(url.startsWith('https://api.search.brave.com/res/v1/web/search?'));
 assert.equal(opts.followRedirects,false);assert.equal(opts.headers['X-Subscription-Token'],'123456789012345678901234');
 const payload=JSON.stringify({query:{original:plan().queries[0].query},web:{results:[{url:'https://satu.kz/p22',title:'CNP CDLF32-80-F'}]}});
 return {getResponseCode:()=>200,getAllHeaders:()=>({'content-type':'application/json'}),getContent:()=>Array.from(Buffer.from(payload)),getContentText:()=>payload};}};
 const pol={approved:true,allowSearchApiCall:true,apiProvider:'BRAVE_SEARCH',billingApproved:true,maxApprovedRequests:1};
 const r=c.inspectTenderSupplierDiscovery(shortlist(),targets(),pol);
 assert.equal(r.issue,null);assert.equal(r.items.length,1);
 assert.equal(r.supplierOffersVerified,0);assert.equal(r.queriesAttempted,1);
 assert.equal(calls,1);assert.equal(claims,1);assert.equal(unlocks,1);
 assert.ok(!JSON.stringify(r).includes('123456789012345678901234'));
});
