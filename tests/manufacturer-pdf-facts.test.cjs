const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({Date,Map,Set});
c.mfrSiteModelTerm_=s=>typeof s==='string'&&s.length>1?s:null;
vm.runInContext(fs.readFileSync('ManufacturerPdfFacts.gs','utf8'),c);
const at='2026-10-13T12:00:00.000Z',hash='a'.repeat(64),url='https://manufacturer.example.com/passport.pdf';
function fixture(){
 const capture={mode:'MANUFACTURER_PDF_INTEGRITY_READ_ONLY',status:'BYTES_HASHED_UNREVIEWED',
 observedAt:at,sha256:hash,sizeBytes:100};
 const candidate={status:'PENDING_PDF_BYTES_AND_MANUFACTURER_IDENTITY_REVIEW',
 pdfUrl:url,brand:'CNP',model:'CDLF32-80',partNumber:'CDLF32-80-F'};
 const policy={manufacturerOcr:{approved:true,ocrResultReviewed:true,pdfSha256:hash,expectedPageCount:2}};
 const text='Напор 42 м\nМощность 5 кВт\n';
 const cut='Напор 42 м\n'.length;
 const receipt={requestSourceSha256:hash,sourceUrl:url,providerResponse:{document:{text,pages:[
 {pageNumber:1,layout:{textAnchor:{textSegments:[{startIndex:'0',endIndex:String(cut)}]}}},
 {pageNumber:2,layout:{textAnchor:{textSegments:[{startIndex:String(cut),endIndex:String(text.length)}]}}}
 ]}}};
 return {capture,candidate,policy,receipt};
}
test('manufacturer OCR source and page anchors yield only unreviewed lines',()=>{
 const f=fixture(),r=c.mfrPdfTextReviewCandidates(f.capture,f.candidate,f.receipt,f.policy,at);
 assert.equal(r.reason,'OCR_LINES_CAPTURED_FACTS_AND_IDENTITY_NOT_VERIFIED');
 assert.equal(r.lines.length,2);assert.equal(r.lines[0].pageNumber,1);
 assert.equal(r.lines[1].sourceSha256,hash);
 assert.equal(r.technicalFactsVerified,0);assert.equal(r.tsCompliance,'UNVERIFIED');
 assert.equal(r.manufacturerIdentityVerified,false);assert.equal(r.nationalDecision,'HOLD_NATIONAL');
 const work=c.mfrPdfTextFactWorklist(r);
 assert.equal(work[0].value,null);assert.equal(work[0].unit,null);
});
test('wrong PDF receipt, source URL or hash blocks all candidate text',()=>{
 for(const change of [f=>f.receipt.requestSourceSha256='b'.repeat(64),
  f=>f.receipt.sourceUrl='https://evil.example.com/different.pdf',
  f=>f.policy.manufacturerOcr.pdfSha256='b'.repeat(64)]){
 const f=fixture();change(f);
 const r=c.mfrPdfTextReviewCandidates(f.capture,f.candidate,f.receipt,f.policy,at);
 assert.equal(r.lines.length,0);
 }
});
test('missing page, duplicate page and unassigned tail must not pass',()=>{
 const f=fixture();f.receipt.providerResponse.document.pages.pop();
 assert.equal(c.mfrPdfTextReviewCandidates(f.capture,f.candidate,f.receipt,f.policy,at).lines.length,0);
 const g=fixture();g.receipt.providerResponse.document.pages[1].pageNumber=1;
 assert.equal(c.mfrPdfTextReviewCandidates(g.capture,g.candidate,g.receipt,g.policy,at).lines.length,0);
 const h=fixture();h.receipt.providerResponse.document.pages[1].layout.textAnchor.textSegments[0].endIndex=String(h.receipt.providerResponse.document.text.length-3);
 assert.equal(c.mfrPdfTextReviewCandidates(h.capture,h.candidate,h.receipt,h.policy,at).lines.length,0);
});
test('stale capture or unapproved policy cannot infer facts',()=>{
 const f=fixture();f.policy.manufacturerOcr.approved=false;
 assert.equal(c.mfrPdfTextReviewCandidates(f.capture,f.candidate,f.receipt,f.policy,at).lines.length,0);
 const g=fixture();g.capture.observedAt='2026-10-12T12:00:00.000Z';
 assert.equal(c.mfrPdfTextReviewCandidates(g.capture,g.candidate,g.receipt,g.policy,at).lines.length,0);
});
test('OCR text is not certified parameter value, model or a technical MATCH',()=>{
 const f=fixture(),r=c.mfrPdfTextReviewCandidates(f.capture,f.candidate,f.receipt,f.policy,at);
 assert.equal(r.technicalDecision,'TECHNICAL_REVIEW');
 assert.equal(r.commercialDecision,'REVIEW');
 assert.equal(r.source.documentVersion,'UNVERIFIED');
 assert.equal(r.lines[0].verbatimText,'Напор 42 м');
 assert.equal(r.lines[0].value,undefined);
});
