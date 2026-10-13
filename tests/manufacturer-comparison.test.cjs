const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const now='2026-10-13T08:00:00.000Z',tsSha='a'.repeat(64),mfrSha='b'.repeat(64);
const mfrUrl='https://www.manufacturer.example.com/datasheets/pump.pdf';
function setup(){
 const c=vm.createContext({Date,Map,Set});
 vm.runInContext(fs.readFileSync('ManufacturerComparison.gs','utf8'),c);return c;
}
function fixture(){
 const ts={origin:'ORIGINAL_PROCUREMENT_DOCUMENT',fullDocumentReviewed:true,currentVersionVerified:true,
  lotId:'123',announcementId:'456',version:'v1',
  evidence:{status:'CONFIRMED',url:'https://v3bl.goszakup.gov.kz/files/download_file/1/2/',
    sha256:tsSha,observedAt:now,locator:'original PDF'},
  criteria:[
   {id:'C1',requirement:'Напор не менее 40 м',critical:true,evidence:{sha256:tsSha,locator:'p1'}},
   {id:'C2',requirement:'Мощность не более 5 кВт',critical:true,evidence:{sha256:tsSha,locator:'p2'}}
  ]};
 const product={brand:'CNP',model:'CDLF32-80',partNumber:'CDLF32-80-F',
  source:{kind:'OFFICIAL_MANUFACTURER_DATASHEET',url:mfrUrl,sha256:mfrSha,version:'rev1',observedAt:now,
   productIdentity:{brand:'CNP',model:'CDLF32-80',partNumber:'CDLF32-80-F'}},
  facts:[
   {id:'F1',parameterCode:'HEAD',value:'41.5',unit:'m',pageNumber:1,
    locator:'table row 3',verbatimText:'Head 41.5 m',sourceSha256:mfrSha},
   {id:'F2',parameterCode:'POWER',value:'5.000',unit:'kW',pageNumber:2,
    locator:'table row 1',verbatimText:'Power 5.000 kW',sourceSha256:mfrSha}
  ]};
 const mappings=[
  {criterionId:'C1',requirement:ts.criteria[0].requirement,kind:'NUMERIC',factId:'F1',
   constraint:{parameterCode:'HEAD',operator:'GE',unit:'m',target:'40'}},
  {criterionId:'C2',requirement:ts.criteria[1].requirement,kind:'NUMERIC',factId:'F2',
   constraint:{parameterCode:'POWER',operator:'LE',unit:'kW',target:'5'}}
 ];
 const review={reviewId:'review-1',lotId:'123',announcementId:'456',tsSha256:tsSha,
  sourceUrl:mfrUrl,sourceSha256:mfrSha,sourceVersion:'rev1',
  assignments:mappings.map((m,i)=>({criterionId:m.criterionId,requirement:m.requirement,
   factId:m.factId,sourceSuggestion:'SUGGEST_MATCH',result:'MATCH',reason:'Original manufacturer PDF reviewed, page '+(i+1)}))};
 const policy={manufacturerReview:{approved:true,maxAgeMs:3600000,artifacts:[{
  approved:true,reviewId:review.reviewId,lotId:review.lotId,announcementId:review.announcementId,
  tsSha256:review.tsSha256,sourceUrl:review.sourceUrl,sourceSha256:review.sourceSha256,
  sourceVersion:review.sourceVersion,brand:product.brand,model:product.model,
  partNumber:product.partNumber,reviewerId:'REVIEWER-EXAMPLE',
  officialManufacturerVerified:true,originalDatasheetBytesVerified:true,
  currentDatasheetVersionVerified:true,productIdentityVerified:true,
  everyCriterionReviewed:true,everySourceFactReviewed:true,observedAt:now,
  assignments:structuredClone(review.assignments),mappings:structuredClone(mappings)
 }]}};
 return {ts,product,mappings,review,policy};
}
test('exact-unit numeric facts yield suggestions, never confirmed MATCH',()=>{
 const f=fixture(),r=setup().proposeTenderManufacturerMatches(f.ts,f.product,f.mappings,now);
 assert.equal(r.status,'SUGGESTIONS_ONLY');
 assert.equal(r.proposals.length,2);
 assert.deepEqual(Array.from(r.proposals.map(x=>x.result)),['SUGGEST_MATCH','SUGGEST_MATCH']);
 assert.equal(r.manufacturerDocumentVerified,false);
 assert.equal(r.technicalCompliance,'UNVERIFIED');
 assert.equal(r.nationalDecision,'HOLD_NATIONAL');
 assert.equal(r.proposals[0].datasheetPage,1);
});
test('review registry gates CONFIRMED assessment output bound to original TS and manufacturer SHA',()=>{
 const f=fixture(),r=setup().finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now);
 assert.equal(r.status,'REVIEWED_ASSESSMENTS_READY');assert.equal(r.candidate.brand,'CNP');
 assert.equal(r.candidate.assessment.length,2);
 assert.equal(r.candidate.assessment[0].result,'MATCH');
 assert.equal(r.candidate.assessment[0].tsSha256,tsSha);
 assert.equal(r.candidate.assessment[0].candidateIdentitySha256,mfrSha);
 assert.equal(r.candidate.assessment[0].evidence.sha256,mfrSha);
 assert.equal(r.commercialDecision,'REVIEW');assert.equal(r.tsCompliance,'UNVERIFIED');
});
test('unreviewed or forged registry cannot issue MATCH evidence',()=>{
 const f=fixture(),c=setup();
 delete f.policy.manufacturerReview;
 let r=c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now);
 assert.equal(r.candidate,null);assert.equal(r.reason,'INDEPENDENT_MANUFACTURER_REVIEW_NOT_APPROVED');
 const g=fixture();g.policy.manufacturerReview.artifacts[0].originalDatasheetBytesVerified=false;
 r=c.finalizeTenderManufacturerAssessment(g.ts,g.product,g.mappings,g.review,g.policy,now);
 assert.equal(r.candidate,null);
});
test('changed source SHA or TS requirement invalidates approval',()=>{
 const c=setup(),f=fixture();
 f.product.source.sha256='c'.repeat(64);
 assert.equal(c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now).candidate,null);
 const g=fixture();g.ts.criteria[0].requirement='50 m';assert.equal(
  c.finalizeTenderManufacturerAssessment(g.ts,g.product,g.mappings,g.review,g.policy,now).candidate,null);
});
test('different unit or parameter can never become MATCH by naive number comparison',()=>{
 const f=fixture(),c=setup();
 f.product.facts[0].unit='cm';
 const r=c.proposeTenderManufacturerMatches(f.ts,f.product,f.mappings,now);
 assert.equal(r.proposals[0].result,'UNKNOWN');assert.equal(r.proposals[0].reason,'PARAMETER_OR_UNIT_MISMATCH');
 assert.equal(c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now).candidate,null);
});
test('failed boundary is only suggested FAIL until reviewer independently approves',()=>{
 const f=fixture(),c=setup();
 f.product.facts[0].value='39.999';
 f.review.assignments[0].result='FAIL';f.review.assignments[0].sourceSuggestion='SUGGEST_FAIL';
 let r=c.proposeTenderManufacturerMatches(f.ts,f.product,f.mappings,now);
 assert.equal(r.proposals[0].result,'SUGGEST_FAIL');
 r=c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now);
 assert.equal(r.candidate,null); // reviewed record still bound to original data
 f.policy.manufacturerReview.artifacts[0].assignments=structuredClone(f.review.assignments);
 r=c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now);
 assert.equal(r.candidate.assessment[0].result,'FAIL');
});
test('unknown or unmapped criteria cannot be promoted to MATCH',()=>{
 const f=fixture(),c=setup();
 f.mappings[1]={criterionId:'C2',requirement:f.ts.criteria[1].requirement,kind:'UNMAPPED',factId:null,constraint:null};
 let p=c.proposeTenderManufacturerMatches(f.ts,f.product,f.mappings,now);
 assert.equal(p.proposals[1].result,'UNKNOWN');
 assert.equal(c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now).candidate,null);
});
test('exact signed decimal threshold, no locale conversion or exponent parsing',()=>{
 const c=setup();assert.equal(c.tenderMfrScaled_('-40.125'),-40125);
 assert.equal(c.tenderMfrScaled_('5.000'),5000);
 for(const x of ['1,000','1e3','1 000','10000000','0.0001','+5','-00.2']){
  assert.equal(c.tenderMfrScaled_(x),null,x);
 }
 const f=fixture();f.product.facts[1].value='5.001';
 assert.equal(c.proposeTenderManufacturerMatches(f.ts,f.product,f.mappings,now).proposals[1].result,'SUGGEST_FAIL');
});
test('manufacturer product identity mismatch remains REVIEW regardless of numeric values',()=>{
 const f=fixture(),c=setup();f.product.source.productIdentity.partNumber='SIMILAR';
 const p=c.proposeTenderManufacturerMatches(f.ts,f.product,f.mappings,now);
 assert.equal(p.identityMatch,'MISMATCH');
 assert.equal(p.proposals[0].result,'UNKNOWN');
 assert.equal(c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now).candidate,null);
});
test('duplicate facts, mappings or source issues cannot create reviewed candidate',()=>{
 const c=setup(),f=fixture();
 f.product.facts.push(f.product.facts[0]);assert.equal(c.proposeTenderManufacturerMatches(f.ts,f.product,f.mappings,now).reason,'DATASHEET_FACT_INVALID');
 const g=fixture();g.mappings[1]=g.mappings[0];
 assert.equal(c.proposeTenderManufacturerMatches(g.ts,g.product,g.mappings,now).reason,'MAPPING_NOT_EXHAUSTIVE_OR_UNBOUND');
 const h=fixture();h.product.source.url='http://127.0.0.1/private';
 assert.equal(c.proposeTenderManufacturerMatches(h.ts,h.product,h.mappings,now).status,'REVIEW');
});
test('stale reviewer proof and unsupported override block issuance',()=>{
 const c=setup(),f=fixture();
 f.policy.manufacturerReview.artifacts[0].observedAt='2020-01-01T00:00:00Z';
 assert.equal(c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now).candidate,null);
 const g=fixture();g.review.assignments[0].result='FAIL';
 assert.equal(c.finalizeTenderManufacturerAssessment(g.ts,g.product,g.mappings,g.review,g.policy,now).reason,'MANUFACTURER_REVIEW_OVERRIDES_UNSUPPORTED');
});
test('no input mutations, no network dependencies and no synthetic profit',()=>{
 const f=fixture(),before=JSON.stringify(f),c=setup();
 const r=c.finalizeTenderManufacturerAssessment(f.ts,f.product,f.mappings,f.review,f.policy,now);
 assert.equal(JSON.stringify(f),before);
 assert.equal(r.candidate.assessment[0].evidence.status,'CONFIRMED');
 assert.equal(r.profitKzt,undefined);
 assert.equal(r.commercialDecision,'REVIEW');
});
