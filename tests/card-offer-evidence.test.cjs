const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const now='2026-10-13T12:00:00.000Z',url='https://www.satu.kz/p1';
function harness(){const c=vm.createContext({Date,Map,Set});for(const f of ['SupplierIntake.gs','ProductCardProbe.gs','CardOfferEvidence.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),c);return c;}
function fixture(){
 const shortlist={mode:'SAME_DAY_SELECTED_IDS_READ_ONLY',coverage:'sample_only',observedAt:now,items:[{lotId:'123',decision:'SAME_DAY_CANDIDATE',deadline:'2026-10-13T18:00:00.000Z',applicationStart:'2026-10-13T09:00:00.000Z',quantity:2,unit:'ea',sourceUrl:'https://old.goszakup.gov.kz/ru/subpriceoffer/index/456/123'}]};
 const requests=[{lotId:'123',url,provider:'SATU',origin:'KZ',expected:{brand:'CNP',model:'M1',partNumber:'P1'}}];
 const card={lotId:'123',productUrl:url,provider:'SATU',origin:'KZ',httpStatus:200,status:'UNREVIEWED_PRODUCT_CARD',contentSha256:'a'.repeat(64),observedAt:now,priceVerified:false,stockVerified:false,deliveryVerified:false,tsCompliance:'UNVERIFIED',identityMatch:'EXACT_FIELDS',product:{brand:'CNP',model:'M1',partNumber:'P1',sku:'P1'},listedOffer:{unitPrice:1500,currency:'KZT',availability:'InStock',priceValidUntil:null}};
 const cards={mode:'PRODUCT_CARD_PROBE_READ_ONLY',coverage:'submitted_exact_urls_only',observedAt:now,nationalDecision:'HOLD_NATIONAL',items:[card]};
 const evidence=kind=>({kind,status:'UNREVIEWED',url:'https://www.example.com/'+kind,sha256:'b'.repeat(64),locator:kind+' line',observedAt:now});
 const details=[{lotId:'123',productUrl:url,offerId:'Q1',supplierId:'SUP1',supplierName:'Satu Seller',provider:'SATU',origin:'KZ',unit:'ea',availableQuantity:2,leadTimeDays:3,stockEvidence:evidence('STOCK'),deliveryEvidence:evidence('DELIVERY')}];
 return {shortlist,requests,cards,details};
}
function run(f){return harness().assembleTenderCardOfferEvidence(f.shortlist,f.requests,f.cards,f.details,{},now);}
test('exact captured JSON-LD price and external stock/delivery yield unreviewed intake only',()=>{
 const f=fixture(),r=run(f);
 assert.equal(r.issue,null);assert.equal(r.observations.length,1);
 assert.equal(r.intake.offers[0].status,'PENDING_REVIEW');
 assert.equal(r.observations[0].evidence[0].sha256,'a'.repeat(64));
 assert.equal(r.observations[0].unitPrice,1500);
 assert.equal(r.verifiedQuotes,0);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
 assert.equal(r.netMarginPercent,null);assert.equal(r.items[0].stockVerified,false);
});
test('missing seller data retains price but never fills invented stock or delivery',()=>{
 const f=fixture();f.details=[];
 const r=run(f);assert.equal(r.observations.length,0);
 assert.equal(r.items[0].priceObservation.unitPrice,1500);
 assert.ok(r.items[0].reasons.includes('SUPPLIER_IDENTITY_REQUIRED'));
});
test('currency/price comparison never crosses currencies or invents KZT rates',()=>{
 const f=fixture(),c=harness();
 const r=c.assembleTenderCardOfferEvidence(f.shortlist,f.requests,f.cards,[],{},now);
 const compare=c.compareTenderCardObservedPrices(r);
 assert.equal(compare.items[0].currency,'KZT');
 assert.equal(compare.items[0].lowestObservedUnitPrice,1500);
 assert.equal(compare.items[0].quotedDeliveredCostKzt,null);
 assert.equal(compare.quotesVerified,0);
});
test('price, product, stock and delivery contradictions all prevent promotion',()=>{
 const mutate=[f=>f.cards.items[0].product.model='WRONG',
 f=>f.cards.items[0].contentSha256='no',
 f=>f.cards.items[0].listedOffer.priceValidUntil='2020-01-01',
 f=>f.details[0].unitPrice=99,
 f=>f.details[0].availableQuantity=1,
 f=>f.details[0].stockEvidence=null,
 f=>f.details[0].deliveryEvidence.observedAt='2020-01-01T00:00:00.000Z'];
 for(const m of mutate){const f=fixture();m(f);assert.equal(run(f).observations.length,0);}
});
test('a duplicate card/request/offer cannot be trusted',()=>{
 const f=fixture();f.requests.push({...f.requests[0]});
 assert.notEqual(run(f).issue,null);
 const g=fixture();g.cards.items.push({...g.cards.items[0]});
 assert.notEqual(run(g).issue,null);
});
test('CSV formula escaping and input immutability',()=>{
 const f=fixture(),c=harness(),before=JSON.stringify(f);
 const r=c.assembleTenderCardOfferEvidence(f.shortlist,f.requests,f.cards,f.details,{},now);
 r.items[0].provider='=HYPERLINK("https://evil.test","x")';
 const csv=c.previewTenderCardOfferEvidenceCsv(r);
 assert.match(csv,/"'=HYPERLINK\(""https:\/\/evil.test"",""x""\)"/);
 assert.equal(JSON.stringify(f),before);
});
