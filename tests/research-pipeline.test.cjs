// Everything below is SYNTHETIC. No prices/suppliers/TS matches are live facts.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const c=vm.createContext({});for(const file of ['NationalEvidence.gs','ResearchPipeline.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c);
function fixture(){
 const now='2026-10-12T08:00:00Z',e={status:'CONFIRMED',url:'https://example.invalid/synthetic',sha256:'a'.repeat(64),locator:'SYNTHETIC page 1',observedAt:now};
 const lot={id:'1',lotNumber:'SYNTHETIC-1',announcementId:'2',announcementNumber:'SYNTHETIC-2',statusCode:'OPEN',plannedMethodId:3,actualMethodId:3,revisionHash:'c'.repeat(64),planIds:['3'],verifiedAt:now,isGoods:true,planCoverageVerified:true,active:true,amountKzt:10000,quantity:2,unit:'ea',applicationStart:'2026-10-12T07:00:00Z',deadline:'2026-10-13T08:00:00Z'};
 const nationalProof={kind:'OFFICIAL_PER_LOT',restriction:'NO',adapterId:'SYNTHETIC',url:e.url,sha256:e.sha256,version:'SYNTHETIC-v1',observedAt:now,context:structuredClone(lot),allPlanRowsVerified:true,methodAndExceptionsVerified:true};
 const policy={national:{approved:true,maxAgeMs:3600000,sources:[{approved:true,adapterId:'SYNTHETIC',artifacts:[structuredClone(nationalProof)]}]},maxEvidenceAgeMs:3600000};
 const candidate={brand:'SYNTHETIC BRAND',model:'SYNTHETIC MODEL',partNumber:'SYNTHETIC PN',identityEvidence:e,assessment:[{criterionId:'1',requirement:'SYNTHETIC requirement',tsSha256:e.sha256,candidateIdentitySha256:e.sha256,result:'MATCH',evidence:e}]};
 const quotes=[1,2,3].map(i=>({id:'q'+i,supplierId:'SYNTHETIC supplier '+i,independenceGroup:'SYNTHETIC GROUP '+i,identityEvidence:e,sourceKind:'SUPPLIER_OFFER',priceEvidence:e,validUntil:'2026-10-14T08:00:00Z',brand:candidate.brand,model:candidate.model,partNumber:candidate.partNumber,unit:'ea',currency:'KZT',unitPrice:3000+i-1,stock:'IN_STOCK',stockContradicted:false,availableQuantity:2,stockEvidence:e,leadTimeDays:2,deliveryCompatible:true,deliveryEvidence:e}));
 const input={schemaVersion:1,researchAuthorized:true,lot,nationalProof,ts:{origin:'ORIGINAL_PROCUREMENT_DOCUMENT',fullDocumentReviewed:true,currentVersionVerified:true,version:'v1',lotId:'1',announcementId:'2',evidence:e,criteria:[{id:'1',requirement:'SYNTHETIC requirement',critical:true,evidence:e}]},candidate,quotes,selectedQuoteId:'q1',costs:Array.from(vm.runInContext('TENDER_COST_ITEMS',c),k=>({kind:k,quoteId:'q1',currency:'KZT',amountKzt:k==='DELIVERY'?1000:0,evidence:e})),bid:{basis:'PLANNED_OFFER',totalKzt:10000,evidence:e},profitTax:{model:'PROPORTIONAL',basis:'PROFIT',rate:0.1,evidence:e},taxTreatment:{reviewed:true,evidence:e},competition:{result:'ACCEPTABLE',evidence:e},legal:{result:'ACCEPTABLE',evidence:e}};
 return {input,policy,now,e};
}
const run=f=>c.evaluateTenderResearch(f.input,f.policy,f.now);
test('fully reviewed SYNTHETIC scenario computes batch, total cost, NET margin and conditional GO',()=>{const f=fixture(),r=run(f);assert.equal(r.decision,'GO');assert.equal(r.finance.partyPurchaseCost,6000);assert.equal(r.finance.profitTax,300);assert.equal(r.finance.totalLandedCost,7300);assert.equal(r.finance.netProfit,2700);assert.equal(r.finance.netMarginPercent,27);assert.equal(r.revenueGuaranteed,false);assert.equal(r.compliance,'TS_COMPLIANCE_100_PERCENT');});
for(const scenario of ['HOLD','YES','manual PASS','authorization missing','missing criteria','duplicate criteria','missing source','wrong TS lot','incomplete TS','wrong model','unknown match','failed criterion','weak price','expired quote','old quote','no stock','contradictory stock','missing lead time','one economic group','duplicate supplier','duplicate quote','missing cost','unconfirmed zero cost','missing tax','missing competition','bid over budget','bid missing','missing FX','wrong units'])test('blocks optimism: '+scenario,()=>{
 const f=fixture(),i=f.input;
 if(scenario==='HOLD')i.nationalProof=null;
 if(scenario==='YES'){i.nationalProof.restriction='YES';f.policy.national.sources[0].artifacts[0].restriction='YES';}
 if(scenario==='manual PASS')i.nationalProof={decision:'PASS_TO_TS'};
 if(scenario==='authorization missing')i.researchAuthorized=false;
 if(scenario==='missing criteria')i.ts.criteria=[];
 if(scenario==='duplicate criteria')i.ts.criteria.push({...i.ts.criteria[0]});
 if(scenario==='missing source')i.ts.evidence=null;
 if(scenario==='wrong TS lot')i.ts.lotId='999';
 if(scenario==='incomplete TS')i.ts.fullDocumentReviewed=false;
 if(scenario==='wrong model')i.quotes[0].model='SIMILAR MODEL';
 if(scenario==='unknown match')i.candidate.assessment[0].result='UNKNOWN';
 if(scenario==='failed criterion')i.candidate.assessment[0].result='FAIL';
 if(scenario==='weak price')i.quotes[0].sourceKind='SEARCH_SNIPPET';
 if(scenario==='expired quote')i.quotes[0].validUntil='2026-10-12T07:00:00Z';
 if(scenario==='old quote')i.quotes[0].priceEvidence={...f.e,observedAt:'2020-01-01T00:00:00Z'};
 if(scenario==='no stock')i.quotes[0].stock='UNKNOWN';
 if(scenario==='contradictory stock')i.quotes[0].stockContradicted=true;
 if(scenario==='missing lead time')delete i.quotes[0].leadTimeDays;
 if(scenario==='one economic group')i.quotes.forEach(q=>q.independenceGroup='ONE');
 if(scenario==='duplicate supplier')i.quotes.forEach(q=>q.supplierId='ONE');
 if(scenario==='duplicate quote')i.quotes[1].id=i.quotes[0].id;
 if(scenario==='missing cost')i.costs.pop();
 if(scenario==='unconfirmed zero cost')i.costs[1].evidence=null;
 if(scenario==='missing tax')i.profitTax=null;
 if(scenario==='missing competition')i.competition=null;
 if(scenario==='bid over budget')i.bid.totalKzt=10001;
 if(scenario==='bid missing')i.bid=null;
 if(scenario==='missing FX')i.quotes[0].currency='USD';
 if(scenario==='wrong units')i.quotes[0].unit='PACK';
 const r=run(f);assert.notEqual(r.decision,'GO');if(['HOLD','YES','manual PASS','authorization missing'].includes(scenario)){assert.equal(r.researchAllowed,false);assert.equal(r.finance,null);}
});
test('margin differs from markup and 19.999% never rounds up to GO',()=>{const f=fixture();f.input.profitTax.rate=0;f.input.quotes.forEach(q=>q.unitPrice=3500.05);const r=run(f);assert.equal(r.finance.netProfit,1999.9);assert.ok(r.finance.markupPercent>20);assert.equal(r.decision,'NO-GO');});
test('exact 20% net qualifies, with explicit proof of zero tax and zero additional items',()=>{const f=fixture();f.input.profitTax.rate=0;f.input.quotes.forEach(q=>q.unitPrice=3500);assert.equal(run(f).finance.netMarginPercent,20);assert.equal(run(f).decision,'GO');});
test('real supplied FX rate would be used; no guessed rate or stock',()=>{const f=fixture();f.input.quotes.forEach(q=>{q.currency='USD';q.unitPrice=6;q.fx={rateKztPerUnit:500,spreadReviewed:true,evidence:f.e};});assert.equal(run(f).finance.partyPurchaseCost,6000);});
test('replay and zero mutation, with no Google services or network installed',()=>{const f=fixture(),before=JSON.stringify(f);assert.equal(JSON.stringify(run(f)),JSON.stringify(run(f)));assert.equal(JSON.stringify(f),before);});

test('costs for a different quote never combine with a cheaper product',()=>{const f=fixture();f.input.costs[0].quoteId='q2';assert.equal(run(f).decision,'REVIEW');});
test('selected supplier must have complete, valid quote evidence',()=>{const f=fixture();delete f.input.selectedQuoteId;assert.equal(run(f).decision,'REVIEW');});
test('minimum bid handles tiyn and income tax conservatively at the true net threshold',()=>{const f=fixture(),r=run(f),v=r.finance.minimumBidFor20Percent;f.input.bid.totalKzt=v;assert.equal(run(f).decision,'GO');f.input.bid.totalKzt=Math.round((v-0.01)*100)/100;assert.equal(run(f).decision,'NO-GO');});

test('revenue tax differs from profit tax and changes break-even',()=>{const f=fixture();f.input.profitTax.basis='REVENUE';const r=run(f);assert.equal(r.finance.profitTax,1000);assert.equal(r.finance.netProfit,2000);assert.equal(r.finance.netMarginPercent,20);assert.ok(r.finance.breakEvenBid>7000);});

test('changed requirement cannot reuse an old MATCH assessment',()=>{const f=fixture();f.input.ts.criteria[0].requirement='CHANGED';assert.equal(run(f).decision,'REVIEW');});
test('different original TS hash cannot reuse old assessment evidence',()=>{const f=fixture();f.input.candidate.assessment[0].tsSha256='b'.repeat(64);assert.equal(run(f).decision,'REVIEW');});
test('nonlinear or missing tax model cannot be silently calculated as proportional',()=>{const f=fixture();f.input.profitTax.model='NONLINEAR';assert.equal(run(f).decision,'REVIEW');});
