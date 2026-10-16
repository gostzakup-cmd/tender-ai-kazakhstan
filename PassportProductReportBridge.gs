/**
 * Issue #30: attach an unreviewed passport-criterion report to product research
 * without upgrading it to TECHNICAL_MATCH. A trusted technical shortlist, if
 * supplied, is separately computed by selectTenderTechnicalProducts.
 * Certificates and commercial gates are independent of technical discovery.
 */
function buildTenderPassportProductReviewReport(ts,passportSummaries,shortlist){
 const out={mode:'PASSPORT_PRODUCT_REVIEW_REPORT',issue:null,products:[],
  technicalMatchesVerified:0,certificateGate:false,
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',sheetsChanged:false};
 if(!ts||!Array.isArray(ts.criteria)||!ts.criteria.length||ts.criteria.length>200||
    !Array.isArray(passportSummaries)||passportSummaries.length>20||
    !shortlist||shortlist.issue||shortlist.mode!=='TECHNICAL_PRODUCT_SHORTLIST'||
    !Array.isArray(shortlist.products)||shortlist.products.length>20||
    shortlist.tsSourceVerified!==true){
  out.issue='REVIEW_REPORT_INPUT_INVALID';return out;
 }
 const used=new Set();
 for(const item of passportSummaries){
  const identity=item&&item.identity;
  if(!identity||!['brand','model','partNumber'].every(k=>typeof identity[k]==='string'&&identity[k].trim())||
    !item.summary||item.summary.issue||item.summary.mode!=='PASSPORT_TS_CRITERIA_SUMMARY'||
    !Array.isArray(item.summary.rows)||item.summary.rows.length!==ts.criteria.length){
   out.issue='PASSPORT_SUMMARY_OR_IDENTITY_INVALID';out.products=[];return out;
  }
  const key=[identity.brand,identity.model,identity.partNumber].join('|').toLowerCase();
  if(used.has(key)){out.issue='DUPLICATE_PASSPORT_PRODUCT';out.products=[];return out;}
  used.add(key);
  const matching=shortlist.products.filter(p=>p.brand===identity.brand&&
    p.model===identity.model&&p.partNumber===identity.partNumber);
  if(matching.length!==1){out.issue='PASSPORT_PRODUCT_NOT_IN_SHORTLIST';out.products=[];return out;}
  const s=matching[0],seen=new Set();
  for(const c of ts.criteria){
   const rows=item.summary.rows.filter(r=>r.criterionId===c.id);
   if(rows.length!==1||seen.has(c.id)||rows[0].requirement!==c.requirement||
      rows[0].evidenceStatus!=='UNREVIEWED'){
    out.issue='PASSPORT_REPORT_CRITERION_UNBOUND';out.products=[];return out;
   }
   seen.add(c.id);
  }
  out.products.push({brand:identity.brand,model:identity.model,
   partNumber:identity.partNumber,technicalDecision:s.decision,
   tsCompliancePercent:s.decision==='TECHNICAL_MATCH'?s.tsCompliancePercent:null,
   datasheetUrl:s.datasheetUrl||null,
   passportSuggestions:{suggestMatch:item.summary.counts.suggestMatch,
    suggestFail:item.summary.counts.suggestFail,unknown:item.summary.counts.unknown},
   evidenceStatus:'UNREVIEWED_PASSPORT_SUGGESTIONS',
   sourceVerifiedByIndependentTechnicalSelection:s.decision==='TECHNICAL_MATCH',
   certificateGate:false});
 }
 out.technicalMatchesVerified=out.products.filter(x=>x.technicalDecision==='TECHNICAL_MATCH').length;
 return out;
}
