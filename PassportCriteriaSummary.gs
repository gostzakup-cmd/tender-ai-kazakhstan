/**
 * Issue #30: complete, source-bound criterion coverage report for passport
 * comparison suggestions. No OCR suggestion can become 100% verified TS match.
 */
function summarizeTenderPassportCriteria(ts,preview){
 const out={mode:'PASSPORT_TS_CRITERIA_SUMMARY',issue:null,
  rows:[],counts:{suggestMatch:0,suggestFail:0,unknown:0},
  totalCriteria:0,allCriteriaVerified:false,technicalDecision:'TECHNICAL_REVIEW',
  tsCompliancePercent:null,certificateGate:false,nationalDecision:'HOLD_NATIONAL',
  commercialDecision:'REVIEW',sheetsChanged:false};
 if(!ts||!Array.isArray(ts.criteria)||ts.criteria.length<1||
   ts.criteria.length>200||!ts.evidence||
   !preview||preview.issue||preview.mode!=='PASSPORT_TS_COMPARISON_PREVIEW'||
   !preview.comparison||preview.comparison.status!=='SUGGESTIONS_ONLY'||
   !Array.isArray(preview.comparison.proposals)||
   preview.comparison.proposals.length!==ts.criteria.length){
  out.issue='PASSPORT_CRITERIA_SUMMARY_INPUT_INVALID';return out;
 }
 const seen=new Set();
 for(const criterion of ts.criteria){
  const matches=preview.comparison.proposals.filter(p=>p.criterionId===criterion.id);
  if(matches.length!==1||seen.has(criterion.id)||
     matches[0].requirement!==criterion.requirement||
     matches[0].tsSha256!==ts.evidence.sha256||
     !['SUGGEST_MATCH','SUGGEST_FAIL','UNKNOWN'].includes(matches[0].result)){
   out.issue='PASSPORT_CRITERIA_SUMMARY_BINDING_INVALID';out.rows=[];return out;
  }
  seen.add(criterion.id);
  const p=matches[0];
  const bucket=p.result==='SUGGEST_MATCH'?'suggestMatch':
   p.result==='SUGGEST_FAIL'?'suggestFail':'unknown';
  out.counts[bucket]++;
  out.rows.push({criterionId:criterion.id,requirement:criterion.requirement,
   proposal:p.result,manufacturerSha256:p.manufacturerSha256,
   datasheetPage:p.datasheetPage,datasheetLocator:p.datasheetLocator,
   reason:p.reason,evidenceStatus:'UNREVIEWED'});
 }
 out.totalCriteria=out.rows.length;
 return out;
}
