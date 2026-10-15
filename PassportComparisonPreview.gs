/**
 * Issue #30: bind a PDF OCR mapping worklist to separately provided
 * datasheet facts. Only suggestions: cannot certify a source or TS match.
 */
function previewTenderPassportComparison(ts,worklist,product,nowIso){
 const out={mode:'PASSPORT_TS_COMPARISON_PREVIEW',issue:null,
  mappings:[],comparison:null,technicalDecision:'TECHNICAL_REVIEW',
  verifiedTechnicalMatches:0,certificateGate:false,
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW'};
 if(!ts||!worklist||worklist.issue||
   worklist.mode!=='PASSPORT_TS_MAPPING_WORKLIST'||
   !Array.isArray(ts.criteria)||!Array.isArray(worklist.items)||
   worklist.items.length!==ts.criteria.length||
   !product||!product.source||!Array.isArray(product.facts)||
   product.source.sha256!==worklist.items[0].manufacturerSha256||
   product.source.url!==worklist.items[0].manufacturerUrl){
  out.issue='PASSPORT_COMPARISON_INPUT_INVALID';return out;
 }
 const seen=new Set();
 for(const w of worklist.items){
  const c=ts.criteria.find(x=>x.id===w.criterionId);
  if(!c||seen.has(w.criterionId)||c.requirement!==w.requirement||
     c.evidence.sha256!==w.tsSha256||
     w.manufacturerSha256!==product.source.sha256||
     w.manufacturerUrl!==product.source.url||
     !Array.isArray(w.factCandidates)){
   out.issue='PASSPORT_CRITERION_BINDING_INVALID';out.mappings=[];return out;
  }
  seen.add(w.criterionId);
  let mapping={criterionId:c.id,requirement:c.requirement,
    kind:'UNMAPPED',factId:null,constraint:null};
  if(w.mappingStatus==='SUGGESTED_MAPPING_REVIEW_REQUIRED'&&
     w.factCandidates.length===1){
   const hint=w.factCandidates[0];
   const exact=product.facts.filter(f=>f.id===hint.lineId&&
     f.parameterCode===w.parameterCode&&f.value===hint.proposedValue&&
     f.unit===hint.proposedUnit&&f.pageNumber===hint.pageNumber&&
     f.verbatimText===hint.verbatimText&&f.sourceSha256===hint.sourceSha256&&
     f.sourceSha256===product.source.sha256);
   if(exact.length===1&&hint.proposedUnit===w.unit){
    mapping={criterionId:c.id,requirement:c.requirement,kind:'NUMERIC',
     factId:exact[0].id,constraint:{parameterCode:exact[0].parameterCode,
      operator:w.operator,unit:w.unit}};
    if(w.operator==='BETWEEN'){
     mapping.constraint.minimum=w.minimum;mapping.constraint.maximum=w.maximum;
    }else mapping.constraint.target=w.target;
   }
  }
  out.mappings.push(mapping);
 }
 const result=proposeTenderManufacturerMatches(ts,product,out.mappings,nowIso);
 out.comparison=result;
 if(result.status!=='SUGGESTIONS_ONLY')out.issue=result.reason;
 return out;
}
