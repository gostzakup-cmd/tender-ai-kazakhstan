/**
 * Issue #30: bind OCR passport parameter suggestions to TS criterion review
 * tasks. Never promote unreviewed OCR to approved manufacturer evidence.
 */
function planTenderPassportTsMappings(ocr,ts,requirements){
 const out={mode:'PASSPORT_TS_MAPPING_WORKLIST',issue:null,items:[],
  technicalDecision:'TECHNICAL_REVIEW',tsCompliance:'UNVERIFIED',
  manufacturerFactsVerified:0,certificateGate:false,
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW'};
 if(!ocr||ocr.mode!=='MANUFACTURER_PDF_FACT_CANDIDATES'||
    ocr.reason!=='OCR_LINES_CAPTURED_FACTS_AND_IDENTITY_NOT_VERIFIED'||
    !ocr.source||!/^[a-f0-9]{64}$/.test(ocr.source.sha256||'')||
    !ts||ts.origin!=='ORIGINAL_PROCUREMENT_DOCUMENT'||
    !Array.isArray(ts.criteria)||ts.criteria.length<1||ts.criteria.length>200||
    !Array.isArray(requirements)||requirements.length!==ts.criteria.length||
    new Set(requirements.map(x=>x&&x.id)).size!==requirements.length||
    !requirements.every(tsProductSearchCriterion_)){
  out.issue='PASSPORT_TS_INPUT_INVALID';return out;
 }
 const byId=new Map(ts.criteria.map(c=>[c.id,c]));
 if(byId.size!==ts.criteria.length||requirements.some(r=>!byId.has(r.id))){
  out.issue='TS_CRITERIA_NOT_EXHAUSTIVELY_BOUND';return out;
 }
 const params=proposeTenderManufacturerOcrParameters(ocr);
 if(params.issue){out.issue=params.issue;return out;}
 for(const req of requirements){
  const criterion=byId.get(req.id);
  const candidates=params.items.filter(x=>x.proposal&&x.proposal.parameterCode===req.parameterCode);
  out.items.push({criterionId:req.id,requirement:criterion.requirement,
   tsSha256:ts.evidence&&ts.evidence.sha256||null,
   parameterCode:req.parameterCode,operator:req.operator,unit:req.unit,
   target:req.value||null,minimum:req.minimum||null,maximum:req.maximum||null,
   manufacturerSha256:ocr.source.sha256,
   manufacturerUrl:ocr.source.url,
   factCandidates:candidates.map(x=>({lineId:x.id,pageNumber:x.pageNumber,
    locator:x.locator,verbatimText:x.verbatimText,
    proposedValue:x.proposal.value,proposedUnit:x.proposal.unit,
    sourceSha256:x.sourceSha256,sourceUrl:x.sourceUrl,
    reviewStatus:'UNREVIEWED'})),
   mappingStatus:candidates.length===1&&candidates[0].proposal.unit===req.unit?
    'SUGGESTED_MAPPING_REVIEW_REQUIRED':'UNKNOWN',
   result:'UNKNOWN'});
 }
 return out;
}
