/**
 * Issue #30: conservative schema.org additionalProperty technical hints.
 * Offline exact card HTML inspection, not supplier confirmation or TS MATCH.
 */
function proposeTenderCardTechnicalHints(html,url,requiredCriteria,nowIso) {
 const out={mode:'PRODUCT_CARD_TECHNICAL_HINTS',issue:null,identity:null,
  technicalDecision:'TECHNICAL_REVIEW',tsCompliancePercent:null,
  criterionHints:[],sourceUrl:url,certificateGate:false,
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW'};
 if(!Array.isArray(requiredCriteria)||requiredCriteria.length<1||
    requiredCriteria.length>20||!requiredCriteria.every(tsProductSearchCriterion_)||
    new Set(requiredCriteria.map(x=>x.id)).size!==requiredCriteria.length) {
   out.issue='CARD_TS_REQUIREMENTS_INVALID';return out;
 }
 const base=inspectTenderUnknownModelCardHtml(html,url,nowIso);
 if(base.status!=='UNREVIEWED_PRODUCT_IDENTITY'){
   out.issue='CARD_EXACT_IDENTITY_UNVERIFIED';return out;
 }
 out.identity=base.product;
 const scripts=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,found=[];let m;
 while((m=scripts.exec(html))!==null){
  if(!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)(?=[\s>]|$)/i.test(m[1]))continue;
  let data;try{data=JSON.parse(m[2]);}catch(e){continue;}
  productCardNodes_(data).filter(x=>productCardTypes_(x,'Product')).forEach(x=>found.push(x));
 }
 if(found.length!==1){out.issue='CARD_PRODUCT_AMBIGUOUS';return out;}
 const raw=found[0].additionalProperty;
 const entries=Array.isArray(raw)?raw:raw?[raw]:[];
 if(entries.length>100){out.issue='CARD_PROPERTIES_LIMIT';return out;}
 const observations=[];
 for(const x of entries){
  if(!x||!productCardTypes_(x,'PropertyValue')||
    typeof x.name!=='string'||typeof x.value!=='string'||
    x.name.length>120||x.value.length>200)continue;
  const candidate=mfrParameterParseLine_(x.name+' '+x.value);
  if(candidate.suggestion)observations.push({
    name:x.name,rawValue:x.value,proposal:candidate.suggestion});
 }
 for(const req of requiredCriteria){
  const matches=observations.filter(x=>x.proposal.parameterCode===req.parameterCode);
  let status='UNKNOWN',reason='SOURCE_PROPERTY_ABSENT_OR_UNPARSEABLE',observed=null;
  if(matches.length===1&&matches[0].proposal.unit===req.unit) {
    observed=matches[0].proposal;
    const n=tenderMfrScaled_(observed.value);
    const min=req.operator==='BETWEEN'?tenderMfrScaled_(req.minimum):null;
    const max=req.operator==='BETWEEN'?tenderMfrScaled_(req.maximum):null;
    const v=req.operator==='BETWEEN'?null:tenderMfrScaled_(req.value);
    if(n!==null&&(req.operator==='BETWEEN'?min!==null&&max!==null:v!==null)){
      const yes=req.operator==='GE'?n>=v:req.operator==='GT'?n>v:
        req.operator==='LE'?n<=v:req.operator==='LT'?n<v:
        req.operator==='EQ'?n===v:n>=min&&n<=max;
      status=yes?'SUGGEST_MATCH':'SUGGEST_FAIL';
      reason='UNREVIEWED_MERCHANT_PROPERTY';
    }
  } else if(matches.length>1){
    reason='CONFLICTING_CARD_PROPERTIES';
  } else if(matches.length===1)reason='UNIT_MISMATCH';
  out.criterionHints.push({criterionId:req.id,status,reason,
    value:observed?observed.value:null,unit:observed?observed.unit:null,
    sourceUrl:url,evidenceStatus:'UNREVIEWED'});
 }
 return out;
}
