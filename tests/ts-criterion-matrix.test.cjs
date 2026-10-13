const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const at='2026-10-13T08:00:00.000Z';
function setup(){
 const c=vm.createContext({Date,Map,Set,acceptTenderOriginalDocument:()=>({accepted:true,nationalDecision:'PASS_TO_TS',artifact:{lotId:'1',announcementId:'2',sourceUrl:'https://v3bl.goszakup.gov.kz/files/download_file/1/2/',sha256:'a'.repeat(64),version:'v1'}})});
 vm.runInContext(fs.readFileSync('TsCriterionMatrix.gs','utf8'),c);return c;
}
function fixture(){
 const sourceSha='a'.repeat(64),url='https://v3bl.goszakup.gov.kz/files/download_file/1/2/';
 const lines=['Мощность 100 Вт','Напряжение не менее 220 V','Таблица параметров'];
 let offset=0;
 const candidates=lines.map((text,i)=>{const start=offset;offset+=text.length+1;return {id:'p'+(i<2?1:2)+'-'+start,text,verbatimText:text,pageNumber:i<2?1:2,sourceSha256:sourceSha,sourceUrl:url,sourceVersion:'v1',locator:{startIndex:start,endIndex:start+text.length},confirmation:'UNREVIEWED',kind:'REQUIREMENT_CANDIDATE'};});
 const extraction={status:'REVIEW',reason:'OCR_PAGE_TEXT_CAPTURED_SEMANTIC_REVIEW_REQUIRED',allTechnicalRequirementsVerified:false,tsCompliance:'UNVERIFIED',issues:[],pagesRead:[1,2],candidates};
 const input={lot:{id:'1'}},policy={extraction:{approved:true,provider:'GOOGLE_DOCUMENT_AI',expectedPageCount:2,pageCountReviewed:true,pageCountSourceSha256:sourceSha}};
 const review={reviewId:'rev-01',lotId:'1',announcementId:'2',sourceSha256:sourceSha,sourceUrl:url,sourceVersion:'v1',
 assignments:candidates.map((r,i)=>i===2?{candidateId:r.id,disposition:'EXCLUDE',criterionId:null,critical:null,reason:'Table heading, reviewed against original PDF'}:{candidateId:r.id,disposition:'REQUIREMENT',criterionId:'C'+(i+1),critical:true})};
 return {input,policy,extraction,review};
}
test('one candidate per original OCR line with page and unit hints, no TS self-certification',()=>{
 const f=fixture(),r=setup().buildTenderTsCriterionMatrix(f.input,f.policy,at,f.extraction);
 assert.equal(r.entries.length,3);assert.equal(r.entries[0].verbatimText,'Мощность 100 Вт');
 assert.ok(r.entries[0].suggestedReviewFlags.includes('MEASUREMENT_TOKEN'));
 assert.equal(r.reviewComplete,false);assert.equal(r.tsCompliance,'UNVERIFIED');
});
test('explicit exclusions remain review draft if independent registry absent',()=>{
 const f=fixture(),r=setup().finalizeTenderTsCriterionReview(f.input,f.policy,at,f.extraction,f.review);
 assert.equal(r.reason,'INDEPENDENT_ORIGINAL_PAGE_REVIEW_NOT_APPROVED');
 assert.equal(r.ts,null);assert.equal(r.draftCriteria.length,2);
 assert.equal(r.sourceLinesReviewed,3);assert.equal(r.excludedLines,1);
});
test('approved matching registry yields reviewed criterion input but never MATCH or GO',()=>{
 const f=fixture();f.policy.tsReview={approved:true,maxAgeMs:3600000,artifacts:[{approved:true,reviewId:f.review.reviewId,reviewerId:'AUDITOR',lotId:'1',announcementId:'2',sourceUrl:f.review.sourceUrl,sourceSha256:f.review.sourceSha256,sourceVersion:'v1',allOriginalPagesReviewed:true,allNonblankOcrLinesReviewed:true,currentVersionVerified:true,documentLayoutReviewed:true,observedAt:at,assignments:structuredClone(f.review.assignments)}]};
 const r=setup().finalizeTenderTsCriterionReview(f.input,f.policy,at,f.extraction,f.review);
 assert.equal(r.status,'REVIEWED_TS_CRITERIA_READY');assert.equal(r.ts.fullDocumentReviewed,true);
 assert.equal(r.ts.criteria.length,2);assert.equal(r.ts.criteria[0].evidence.sha256,'a'.repeat(64));
 assert.equal(r.tsCompliance,'UNVERIFIED');assert.equal(r.commercialDecision,'REVIEW');
});
test('changing assignment makes trusted record mismatch',()=>{
 const f=fixture();f.policy.tsReview={approved:true,maxAgeMs:3600000,artifacts:[{approved:true,reviewId:f.review.reviewId,reviewerId:'AUDITOR',lotId:'1',announcementId:'2',sourceUrl:f.review.sourceUrl,sourceSha256:f.review.sourceSha256,sourceVersion:'v1',allOriginalPagesReviewed:true,allNonblankOcrLinesReviewed:true,currentVersionVerified:true,documentLayoutReviewed:true,observedAt:at,assignments:structuredClone(f.review.assignments)}]};
 f.review.assignments[0].criterionId='CHANGED';
 assert.equal(setup().finalizeTenderTsCriterionReview(f.input,f.policy,at,f.extraction,f.review).ts,null);
});
test('missing assignments and duplicate OCR IDs cannot proceed',()=>{
 const f=fixture(),c=setup();f.review.assignments.pop();
 assert.equal(c.finalizeTenderTsCriterionReview(f.input,f.policy,at,f.extraction,f.review).reason,'EXHAUSTIVE_LINE_REVIEW_REQUIRED');
 const g=fixture();g.extraction.candidates[1].id=g.extraction.candidates[0].id;
 assert.equal(c.buildTenderTsCriterionMatrix(g.input,g.policy,at,g.extraction).reason,'TS_OCR_ANCHOR_OR_SOURCE_INVALID');
});
test('wrong source SHA and incomplete page coverage blocked',()=>{
 const f=fixture(),c=setup();f.extraction.candidates[0].sourceSha256='b'.repeat(64);
 assert.equal(c.buildTenderTsCriterionMatrix(f.input,f.policy,at,f.extraction).entries.length,0);
 const g=fixture();g.extraction.pagesRead=[1];
 assert.equal(c.buildTenderTsCriterionMatrix(g.input,g.policy,at,g.extraction).reason,'TS_COMPLETE_OCR_CAPTURE_REQUIRED');
});
test('one malformed line, excessive input, or national HOLD fails closed',()=>{
 const c=setup(),f=fixture();f.extraction.candidates[0].locator.endIndex++;
 assert.equal(c.buildTenderTsCriterionMatrix(f.input,f.policy,at,f.extraction).entries.length,0);
 const g=fixture();g.extraction.candidates=Array(501).fill(g.extraction.candidates[0]);
 assert.equal(c.buildTenderTsCriterionMatrix(g.input,g.policy,at,g.extraction).reason,'TS_COMPLETE_OCR_CAPTURE_REQUIRED');
 c.acceptTenderOriginalDocument=()=>({accepted:false,nationalDecision:'HOLD_NATIONAL',reason:'NATIONAL_GATE_BLOCKED'});
 const h=fixture();assert.equal(c.buildTenderTsCriterionMatrix(h.input,h.policy,at,h.extraction).reason,'NATIONAL_GATE_BLOCKED');
});
test('no input mutation and zero network/paid services',()=>{
 const f=fixture(),before=JSON.stringify(f);setup().finalizeTenderTsCriterionReview(f.input,f.policy,at,f.extraction,f.review);
 assert.equal(JSON.stringify(f),before);
});
