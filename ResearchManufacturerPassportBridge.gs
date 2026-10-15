/**
 * Issue #30: bridge discovered exact product identities into independently
 * approved manufacturer-site passport discovery. Pure offline preparation.
 * Merchant claims are not accepted as manufacturer ownership or TS proof.
 */
function planTenderResearchManufacturerPassports(lot,research,manufacturerHosts,policy,nowIso){
 const out={mode:'RESEARCH_TO_MANUFACTURER_PASSPORT_PLAN',issue:null,
  requests:[],matchedProducts:0,technicalDecision:'TECHNICAL_REVIEW',
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',
  certificateGate:false,sheetsChanged:false};
 if(!lot||!research||research.issue||!Array.isArray(research.products)||
    research.products.length>5||research.products.length<1||
    !['IMPORTED_TS_RESEARCH_PREVIEW','TS_RESEARCH_PIPELINE_PREVIEW'].includes(research.mode)||
    !Array.isArray(manufacturerHosts)||manufacturerHosts.length>20||
    !policy||!Number.isFinite(mfrSiteTime_(nowIso))){
  out.issue='RESEARCH_OR_HOST_INPUT_INVALID';return out;
 }
 const selected=[],identities=new Set();
 for(const p of research.products){
  if(!p||!['brand','model','partNumber'].every(k=>mfrSiteModelTerm_(p[k]))||
    typeof p.productUrl!=='string'||!productCardHost_(p.productUrl)||
    p.technicalDecision!=='TECHNICAL_REVIEW')continue;
  const identity=[p.brand,p.model,p.partNumber].join('|').toLowerCase();
  if(identities.has(identity))continue;
  identities.add(identity);
  const hosts=manufacturerHosts.filter(h=>h&&h.brand===p.brand&&
   mfrSiteHost_(h.host)&&h.approved===true);
  if(hosts.length!==1)continue;
  selected.push({lotId:lot.id,brand:p.brand,model:p.model,
   partNumber:p.partNumber,host:hosts[0].host});
  if(selected.length===MFR_SITE_DISCOVERY.maxTargets)break;
 }
 if(!selected.length){out.issue='NO_APPROVED_MANUFACTURER_HOST_FOR_PRODUCTS';return out;}
 const plan=planTenderManufacturerSiteDiscovery(lot,selected,policy,nowIso);
 if(plan.issue){out.issue=plan.issue;return out;}
 out.requests=plan.requests.map(x=>Object.assign({},x,{status:'PENDING_APPROVED_MANUFACTURER_SITE_INSPECTION'}));
 out.matchedProducts=selected.length;
 return out;
}
