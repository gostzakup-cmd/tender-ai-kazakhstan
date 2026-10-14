/**
 * Issue #30: product discovery must not be gated by certificate availability.
 * Separate technical product research from documentary submission compliance.
 * Offline plan; no source network, price or supplier promise.
 */
const CERTIFICATE_INDEPENDENT_SEARCH=Object.freeze({maxProducts:20,maxTerms:12});
function technicalSearchToken_(s){
 return typeof s==='string' && s.length>=1 && s.length<=100 &&
   /^[\p{L}\p{N}][\p{L}\p{N} ._+()\/-]*$/u.test(s) && s.trim()===s &&
   !/\s{2}/.test(s);
}
function planCertificateIndependentProductSearch(lot,productTargets,documentRequirements) {
 const result={mode:'CERTIFICATE_INDEPENDENT_PRODUCT_SEARCH',issue:null,
   lotId:lot&&lot.id||null,targets:[],documentRequirements:[],
   certificateRequiredForSearch:false,technicalDecision:'TECHNICAL_REVIEW',
   procurementDecision:'REVIEW',nationalDecision:'HOLD_NATIONAL',
   sourceEvidenceVerified:false,sheetsChanged:false};
 if(!lot || typeof lot.id!=='string' || !/^[1-9]\d{0,9}$/.test(lot.id) ||
   lot.isGoods!==true || !Array.isArray(productTargets) ||
   productTargets.length<1 || productTargets.length>CERTIFICATE_INDEPENDENT_SEARCH.maxProducts ||
   !Array.isArray(documentRequirements) || documentRequirements.length>40){
   result.issue='PRODUCT_SEARCH_INPUT_INVALID';return result;
 }
 const seen=new Set();
 for(const p of productTargets){
   if(!p || !['brand','model','partNumber'].every(k=>technicalSearchToken_(p[k])) ||
     p.lotId!==lot.id) {
     result.issue='PRODUCT_IDENTITY_UNVERIFIED';result.targets=[];return result;
   }
   const key=[p.brand,p.model,p.partNumber].map(x=>x.toLowerCase()).join('|');
   if(seen.has(key)){result.issue='DUPLICATE_PRODUCT';result.targets=[];return result;}
   seen.add(key);
   // Deliberately excludes certificate ID, certificate status, supplier stock,
   // prices and delivery: all are independent checks AFTER finding the product.
   result.targets.push({lotId:p.lotId,brand:p.brand,model:p.model,
     partNumber:p.partNumber,searchTerms:[p.brand,p.model,p.partNumber],
     certificateGate:false,technicalDecision:'TECHNICAL_REVIEW'});
 }
 const docIds=new Set();
 for(const d of documentRequirements){
   if(!d || typeof d.id!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(d.id) ||
     docIds.has(d.id) || !['CERTIFICATE','DECLARATION','OTHER'].includes(d.kind) ||
     typeof d.requirement!=='string' || d.requirement.length<1 ||
     d.requirement.length>2000){
     result.issue='DOCUMENT_REQUIREMENTS_INVALID';
     result.targets=[];result.documentRequirements=[];return result;
   }
   docIds.add(d.id);
   result.documentRequirements.push({id:d.id,kind:d.kind,
     requirement:d.requirement,status:'DOCUMENT_NOT_VERIFIED',
     blocksTechnicalDiscovery:false,
     procurementReviewRequired:true});
 }
 return result;
}
/** Retain all technically matched products even if certificate is missing.
 * Never turn a technical recommendation into procurement GO.
 */
function attachCertificateStatusToTechnicalShortlist(technical,documents) {
 if(!technical || technical.mode!=='TECHNICAL_PRODUCT_SHORTLIST' ||
    technical.issue || !Array.isArray(technical.products) ||
    !documents || documents.mode!=='CERTIFICATE_INDEPENDENT_PRODUCT_SEARCH' ||
    documents.issue || documents.lotId!==technical.lotId) return null;
 return Object.assign({},technical,{
   procurementDecision:'REVIEW',
   documentationDecision:documents.documentRequirements.length?'DOCUMENT_REQUIRED':'DOCUMENT_NOT_ASSESSED',
   products:technical.products.map(p=>Object.assign({},p,{
     certificateRequiredForTechnicalSelection:false,
     certificateStatus:documents.documentRequirements.length?'NOT_VERIFIED':'NOT_ASSESSED',
     procurementDecision:'REVIEW'
   }))
 });
}
