/**
 * Issue #30: exact-card research diagnostics. Distinguishes valid product
 * identities from incomplete/unparseable cards; never calls a search API.
 * A search hit is not proof of model, technical match or availability.
 */
function auditTenderTsResearchReadiness(report){
 const out={mode:'TS_RESEARCH_READINESS_AUDIT',issue:null,reviewable:[],
  rejected:[],completeIdentities:0,technicalMatchesVerified:0,
  technicalDecision:'TECHNICAL_REVIEW',nationalDecision:'HOLD_NATIONAL',
  commercialDecision:'REVIEW',certificateGate:false,sheetsChanged:false};
 if(!report||report.issue||
   !['IMPORTED_TS_RESEARCH_PREVIEW','TS_RESEARCH_PIPELINE_PREVIEW'].includes(report.mode)||
   !Array.isArray(report.products)||report.products.length>TS_CARD_BRIDGE.maxCards){
  out.issue='TS_RESEARCH_AUDIT_INPUT_INVALID';return out;
 }
 const seen=new Set();
 for(const p of report.products){
  if(!p||typeof p.productUrl!=='string'||!productCardHost_(p.productUrl)||
    !['KZ','RU','CN'].includes(p.market)||
    !Array.isArray(p.criteria)||p.criteria.length<1||p.criteria.length>20||
    !Array.isArray(p.hints)||p.hints.length>20){
   out.issue='TS_RESEARCH_AUDIT_PRODUCT_INVALID';out.reviewable=[];out.rejected=[];return out;
  }
  const key=p.market+'|'+p.productUrl;
  if(seen.has(key)){out.issue='TS_RESEARCH_AUDIT_DUPLICATE';out.reviewable=[];out.rejected=[];return out;}
  seen.add(key);
  const identity=['brand','model','partNumber'].every(k=>
    typeof p[k]==='string'&&p[k].trim().length>0);
  const ids=new Set();
  const criteriaOk=p.criteria.every(c=>c&&tsProductSearchCriterion_(
    {id:c.id,parameterCode:c.parameterCode,operator:c.operator,unit:c.unit,
      ...(c.operator==='BETWEEN'?{minimum:c.minimum,maximum:c.maximum}:{value:c.value})})&&
    !ids.has(c.id)&&(ids.add(c.id),true));
  const hintIds=new Set();
  const hintsOk=p.hints.every(h=>h&&ids.has(h.criterionId)&&!hintIds.has(h.criterionId)&&
    ['SUGGEST_MATCH','SUGGEST_FAIL','UNKNOWN'].includes(h.status)&&
    h.evidenceStatus==='UNREVIEWED'&&h.sourceUrl===p.productUrl&&
    (hintIds.add(h.criterionId),true));
  if(!criteriaOk||!hintsOk||hintIds.size!==ids.size||
    p.technicalDecision!=='TECHNICAL_REVIEW'||p.tsCompliancePercent!==null){
   out.issue='TS_RESEARCH_AUDIT_BINDING_INVALID';out.reviewable=[];out.rejected=[];return out;
  }
  if(!identity||p.discoveryStatus!=='UNREVIEWED'){
   out.rejected.push({productUrl:p.productUrl,reason:'EXACT_PRODUCT_IDENTITY_UNAVAILABLE'});
  }else{
   out.reviewable.push({productUrl:p.productUrl,market:p.market,
     brand:p.brand,model:p.model,partNumber:p.partNumber,
     status:'PASSPORT_REQUIRED_FOR_TECHNICAL_CONFIRMATION'});
  }
 }
 out.completeIdentities=out.reviewable.length;
 return out;
}
