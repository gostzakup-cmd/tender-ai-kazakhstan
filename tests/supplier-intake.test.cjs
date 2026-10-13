const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({Map,Set,Date});vm.runInContext(fs.readFileSync('SupplierIntake.gs','utf8'),c);
const now='2026-10-13T12:00:00.000Z';
function shortlist(){return {items:[{lotId:'43550274',decision:'SAME_DAY_CANDIDATE',quantity:4,sourceUrl:'https://old.goszakup.gov.kz/ru/subpriceoffer/index/17760680/43550274'}]};}
function offer(id='q1') {
 const e=kind=>({kind,status:'UNREVIEWED',url:'https://www.example.com/product/abc',
    locator:kind+' line',sha256:'b'.repeat(64),observedAt:now});
 return {lotId:'43550274',offerId:id,provider:'DISTRIBUTOR',origin:'KZ',sourceKind:'OFFICIAL_CATALOG',
 productUrl:'https://www.example.com/product/abc',supplierId:id,supplierName:'Supplier '+id,
 brand:'BRAND',model:'M1',partNumber:'P1',unit:'ea',unitPrice:1000,currency:'KZT',
 availableQuantity:4,leadTimeDays:5,evidence:['PRICE','STOCK','DELIVERY'].map(e)};
}
function run(offers=[offer()],lot=shortlist()){return c.intakeTenderSupplierOffers(lot,offers,now);}
test('valid observations remain PENDING_REVIEW, never trusted supplier quote',()=>{
 const r=run([offer('q1'),offer('q2'),offer('q3')]);
 assert.equal(r.offers.length,3);assert.equal(r.offers[0].status,'PENDING_REVIEW');
 assert.equal(r.verifiedQuotes,0);assert.equal(r.authorizedResearch,false);
 assert.equal(r.lotCoverage[0].uniqueSupplierIds,3);assert.equal(r.lotCoverage[0].independenceVerified,false);
 assert.equal(r.lotCoverage[0].nationalDecision,'HOLD_NATIONAL');
 assert.equal(r.offers[0].source.productUrl,'https://www.example.com/product/abc');
 assert.equal(r.sheetsChanged,false);
});
test('product price only is never a complete evidence capture',()=>{
 const o=offer();o.evidence=o.evidence.slice(0,1);
 assert.equal(run([o]).offers[0].status,'REVIEW');
});
test('unknown lot or expired status cannot be assigned to an offer',()=>{
 const s=shortlist();s.items[0].decision='EXPIRED';
 assert.equal(run([offer()],s).offers[0].reasons[0],'CURRENT_LOT_CANDIDATE_REQUIRED');
});
test('insufficient stock is clearly flagged without inventing availability',()=>{
 const o=offer();o.availableQuantity=1;
 assert.ok(run([o]).offers[0].reasons.includes('INSUFFICIENT_STOCK'));
});
test('duplicate IDs and unsupported providers fail closed',()=>{
 assert.equal(run([offer(),offer()]).offers[1].reasons[0],'OFFER_ID_INVALID_OR_DUPLICATE');
 const o=offer();o.provider='RANDOM';
 assert.equal(run([o]).offers[0].reasons[0],'SOURCE_NOT_VERIFIABLE');
});
test('unsafe URL and fake test host rejected; https product page allowed',()=>{
 for(const u of ['http://www.example.com/p','https://localhost/a','https://127.0.0.1/a',
  'https://x.invalid/p','https://user:pass@example.com/p','https://a.com/#secret']){
  assert.equal(c.supplierIntakeUrl_(u),false,u);
 }
 assert.equal(c.supplierIntakeUrl_('https://www.example.com/product/abc'),true);
});
test('raw source cannot assert CONFIRMED by itself',()=>{
 const o=offer();o.evidence[0].status='CONFIRMED';
 assert.equal(run([o]).offers[0].reasons[0],'EVIDENCE_SNAPSHOT_INCOMPLETE');
});
test('stale snapshots and invalid monetary values rejected',()=>{
 const o=offer();o.evidence[0].observedAt='2026-10-01T12:00:00.000Z';
 assert.equal(run([o]).offers[0].status,'REVIEW');
 const q=offer();q.unitPrice=NaN;assert.equal(run([q]).offers[0].status,'REVIEW');
});
test('safe CSV preview is read-only, quotes spreadsheet formula cells',()=>{
 const o=offer();o.supplierName='=HYPERLINK("https://evil.com","x")';
 const r=run([o]); const csv=c.previewTenderSupplierIntakeCsv(r);
 assert.match(csv,/"'=HYPERLINK\(""https:\/\/evil.com"",""x""\)"/);
 assert.match(csv,/PENDING_REVIEW/);
 assert.equal(c.previewTenderSupplierIntakeCsv({issue:'BLOCKED'}),null);
});
test('no input mutation or network dependency',()=>{
 const o=offer(),s=shortlist(),before=JSON.stringify([o,s]);run([o],s);
 assert.equal(JSON.stringify([o,s]),before);
});
