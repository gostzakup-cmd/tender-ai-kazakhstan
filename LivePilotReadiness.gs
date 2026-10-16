/**
 * Issue #30: bounded live pilot preflight before external calls.
 * No fetch, secret access, timer, deployment, purchases or applications.
 * Prevents offline fixtures/partial discovery being labelled production ready.
 */
function assessTenderLivePilotReadiness(discovery,ts,merchantPolicy,manufacturerPolicy,nowIso){
 const out={mode:'LIVE_PILOT_READINESS',ready:false,blocks:[],
  allowExternalCalls:false,allowTenderApplication:false,
  certificateGate:false,nationalDecision:'HOLD_NATIONAL',
  commercialDecision:'REVIEW',technicalDecision:'TECHNICAL_REVIEW',
  coverage:'not_production_verified',sheetsChanged:false};
 const now=Date.parse(nowIso);
 if(typeof nowIso!=='string'||!Number.isFinite(now)){
  out.blocks.push('CLOCK_UNVERIFIED');return out;
 }
 if(!discovery||discovery.issue||
   discovery.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY'||
   !Array.isArray(discovery.items)||discovery.items.length<1||
   discovery.dailyCoverageVerified!==true){
  out.blocks.push('FULL_SAME_DAY_LOT_DISCOVERY_UNVERIFIED');
 }
 if(!ts||ts.origin!=='ORIGINAL_PROCUREMENT_DOCUMENT'||
   ts.fullDocumentReviewed!==true||ts.currentVersionVerified!==true||
   !Array.isArray(ts.criteria)||!ts.criteria.length){
  out.blocks.push('ORIGINAL_TS_INDEPENDENT_REVIEW_REQUIRED');
 }
 if(!merchantPolicy||merchantPolicy.approved!==true||
   merchantPolicy.allowSearchApiCall!==true||
   merchantPolicy.apiProvider!=='BRAVE_SEARCH'||
   merchantPolicy.billingApproved!==true||
   !Number.isSafeInteger(merchantPolicy.maxApprovedRequests)||
   merchantPolicy.maxApprovedRequests<1||
   merchantPolicy.maxApprovedRequests>6){
  out.blocks.push('SEARCH_API_OWNER_BILLING_APPROVAL_REQUIRED');
 }
 if(!manufacturerPolicy||!manufacturerPolicy.manufacturerSites||
   manufacturerPolicy.manufacturerSites.approved!==true||
   !Array.isArray(manufacturerPolicy.manufacturerSites.hosts)||
   !manufacturerPolicy.manufacturerSites.hosts.some(h=>h&&h.approved===true&&
    h.manufacturerDomainOwnershipReviewed===true&&
    h.publicSiteTermsReviewed===true)){
  out.blocks.push('REVIEWED_MANUFACTURER_SOURCE_REQUIRED');
 }
 // This is a preflight only. A successful preflight does not execute
 // or grant authority for a network request, a bid or an expenditure.
 out.ready=out.blocks.length===0;
 return out;
}
