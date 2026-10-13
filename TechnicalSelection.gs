/**
 * Issue #30: TECHNICAL-FIRST product selection, independent of supplier
 * quotation, stock, shipping, tax, exchange rates or desired net margin.
 *
 * An independently reviewed original TS and manufacturer datasheet are still
 * mandatory. The result is never a procurement GO or national-regime approval.
 * Entirely offline; no Apps Script deployment, fetch, Sheets or paid services.
 */
const TECHNICAL_SELECTION = Object.freeze({
  maxProducts:20, maxCriteria:200, maxEvidenceAgeMs:86400000,
  maxLotAgeMs:300000
});

function technicalSelectionTime_(value) {
  return typeof value==='string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)?
    Date.parse(value):NaN;
}
function technicalSelectionText_(value,max) {
  return typeof value==='string' && value.length>0 &&
    value.length<=max && !!value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}
function technicalSelectionProof_(proof,now,maxAge) {
  if(!proof || proof.status!=='CONFIRMED' ||
      !supplierIntakeUrl_(proof.url) ||
      !/^[a-f0-9]{64}$/.test(proof.sha256 || '') ||
      !technicalSelectionText_(proof.locator,250) ||
      !Number.isFinite(technicalSelectionTime_(proof.observedAt))) return false;
  const at=technicalSelectionTime_(proof.observedAt);
  return at<=now && now-at<=maxAge;
}
function technicalSelectionCriteria_(criteria) {
  return criteria.map(function(c){
    return {id:c.id, requirement:c.requirement, critical:c.critical,
      locator:c.evidence.locator,sha256:c.evidence.sha256};
  });
}
function technicalSelectionSourceVerified_(lot,ts,policy,now) {
  if(!ts || ts.origin!=='ORIGINAL_PROCUREMENT_DOCUMENT' ||
      ts.fullDocumentReviewed!==true || ts.currentVersionVerified!==true ||
      ts.lotId!==lot.id || ts.announcementId!==lot.announcementId ||
      !technicalSelectionText_(ts.version,160) ||
      !technicalSelectionProof_(ts.evidence,now,TECHNICAL_SELECTION.maxEvidenceAgeMs) ||
      !Array.isArray(ts.criteria) || ts.criteria.length<1 ||
      ts.criteria.length>TECHNICAL_SELECTION.maxCriteria) return false;
  const seen=new Set();
  for(const c of ts.criteria) {
    if(!c || !technicalSelectionText_(c.id,64) || seen.has(c.id) ||
        !technicalSelectionText_(c.requirement,2000) ||
        typeof c.critical!=='boolean' ||
        !technicalSelectionProof_(c.evidence,now,TECHNICAL_SELECTION.maxEvidenceAgeMs) ||
        c.evidence.sha256!==ts.evidence.sha256 ||
        c.evidence.url!==ts.evidence.url) return false;
    seen.add(c.id);
  }
  // Source review registry is an independently controlled trusted policy input.
  // Never mint this registry from AI's own OCR or user-supplied flags.
  const registry=policy && policy.technicalSourceReview;
  if(!registry || registry.approved!==true ||
      !Number.isFinite(registry.maxAgeMs) || registry.maxAgeMs<=0 ||
      registry.maxAgeMs>TECHNICAL_SELECTION.maxEvidenceAgeMs ||
      !Array.isArray(registry.artifacts) ||
      registry.artifacts.length>TECHNICAL_SELECTION.maxProducts*5) return false;
  const matching=registry.artifacts.filter(function(a){
    return a && a.approved===true &&
      a.lotId===lot.id && a.announcementId===lot.announcementId &&
      a.revisionHash===lot.revisionHash &&
      a.documentUrl===ts.evidence.url && a.sha256===ts.evidence.sha256 &&
      a.version===ts.version;
  });
  if(matching.length!==1) return false;
  const approved=matching[0],at=technicalSelectionTime_(approved.verifiedAt);
  return technicalSelectionText_(approved.reviewerId,120) &&
    approved.originalPdfBytesVerified===true &&
    approved.currentVersionReviewed===true &&
    approved.allOriginalPagesReviewed===true &&
    approved.allTechnicalRequirementsCaptured===true &&
    Number.isFinite(at) && at<=now && now-at<=registry.maxAgeMs &&
    Array.isArray(approved.criteria) &&
    JSON.stringify(approved.criteria)===
      JSON.stringify(technicalSelectionCriteria_(ts.criteria));
}
/** Each manufacturer review is recomputed against the independently approved
 * registry; a caller cannot submit a forged candidate with MATCH flags.
 */
function selectTenderTechnicalProducts(lot,ts,manufacturerPackets,policy,nowIso) {
  const output={mode:'TECHNICAL_PRODUCT_SHORTLIST',issue:null,
    coverage:'reviewed_original_ts_and_manufacturer_docs_only',
    observedAt:nowIso,lotId:lot && lot.id || null,
    lotNumber:lot && lot.lotNumber || null,
    announcementNumber:lot && lot.announcementNumber || null,
    requiredQuantity:lot && lot.quantity || null,
    lotAmountKzt:lot && lot.amountKzt===0?0:lot && lot.amountKzt || null,
    nationalDecision:'HOLD_NATIONAL',procurementDecision:'REVIEW',
    priceVerified:false,stockVerified:false,shippingVerified:false,
    marginVerified:false,netMarginPercent:null,
    tsSourceVerified:false,products:[],
    counts:{TECHNICAL_MATCH:0,TECHNICAL_REVIEW:0,TECHNICAL_FAIL:0},
    sheetsChanged:false,watermarkAdvanced:false};
  const now=technicalSelectionTime_(nowIso),verified=technicalSelectionTime_(lot && lot.verifiedAt);
  if(!Number.isFinite(now) || !lot ||
      !technicalSelectionText_(lot.id,16) ||
      !technicalSelectionText_(lot.announcementId,16) ||
      !technicalSelectionText_(lot.revisionHash,64) ||
      !/^[a-f0-9]{64}$/.test(lot.revisionHash) ||
      lot.isGoods!==true || lot.active!==true ||
      lot.planCoverageVerified!==true ||
      !Number.isFinite(verified) || verified>now ||
      now-verified>TECHNICAL_SELECTION.maxLotAgeMs ||
      !Number.isFinite(technicalSelectionTime_(lot.applicationStart)) ||
      technicalSelectionTime_(lot.applicationStart)>now ||
      !(technicalSelectionTime_(lot.deadline)>now) ||
      !Number.isFinite(lot.amountKzt) || lot.amountKzt<=0 ||
      lot.amountKzt>10000000 ||
      !Number.isSafeInteger(lot.quantity) || lot.quantity<1 ||
      !Array.isArray(manufacturerPackets) ||
      manufacturerPackets.length>TECHNICAL_SELECTION.maxProducts) {
    output.issue='TECHNICAL_LOT_OR_INPUT_INVALID';return output;
  }
  if(!technicalSelectionSourceVerified_(lot,ts,policy,now)) {
    output.issue='ORIGINAL_TS_INDEPENDENT_REVIEW_REQUIRED';return output;
  }
  output.tsSourceVerified=true;
  const identities=new Set();
  for(const packet of manufacturerPackets) {
    const c=packet && packet.product;
    const identity=c && ['brand','model','partNumber'].map(function(k){
      return technicalSelectionText_(c[k],120)?c[k].trim().toLowerCase():null;
    });
    if(!identity || identity.some(function(x){return !x;})) {
      output.issue='MANUFACTURER_IDENTITY_INVALID';output.products=[];return output;
    }
    const key=identity.join('|');
    if(identities.has(key)) {
      output.issue='DUPLICATE_TECHNICAL_PRODUCT';output.products=[];return output;
    }
    identities.add(key);
    const row={brand:c.brand,model:c.model,partNumber:c.partNumber,
      decision:'TECHNICAL_REVIEW',tsCompliancePercent:null,
      matchedCriteria:0,failedCriteria:0,unknownCriteria:ts.criteria.length,
      totalCriteria:ts.criteria.length,reason:'MANUFACTURER_SOURCE_REVIEW_REQUIRED',
      confidence:'LOW',datasheetUrl:null,datasheetSha256:null,
      originalTsUrl:ts.evidence.url,originalTsSha256:ts.evidence.sha256,
      priceKzt:null,stockAvailable:null,deliveryDays:null,
      netMarginPercent:null,procurementDecision:'REVIEW',
      assessmentEvidence:[]};
    output.products.push(row);
    // Does not accept a user/AI-supplied "REVIEWED" status in place of
    // the actual manufacturer source review verification.
    let review=null;
    try {
      review=finalizeTenderManufacturerAssessment(
        ts,c,packet.mappings,packet.review,policy,nowIso);
    } catch(e) {
      row.reason='MANUFACTURER_REVIEW_EXCEPTION';continue;
    }
    if(!review || review.status!=='REVIEWED_ASSESSMENTS_READY' ||
        !review.candidate || !review.candidate.identityEvidence ||
        !technicalSelectionProof_(review.candidate.identityEvidence,now,
          TECHNICAL_SELECTION.maxEvidenceAgeMs) ||
        !Array.isArray(review.candidate.assessment) ||
        review.candidate.assessment.length!==ts.criteria.length ||
        !['brand','model','partNumber'].every(function(k){
          return review.candidate[k]===c[k];
        })) {
      row.reason=review && review.reason || 'MANUFACTURER_REVIEW_NOT_READY';
      continue;
    }
    const assessments=new Map(),identitySha=review.candidate.identityEvidence.sha256;
    let bindingInvalid=false;
    for(const a of review.candidate.assessment){
      if(!a || assessments.has(a.criterionId) ||
          !['MATCH','FAIL','UNKNOWN'].includes(a.result) ||
          a.tsSha256!==ts.evidence.sha256 ||
          a.candidateIdentitySha256!==identitySha ||
          !technicalSelectionProof_(a.evidence,now,
            TECHNICAL_SELECTION.maxEvidenceAgeMs) ||
          a.evidence.sha256!==identitySha) {
        bindingInvalid=true;break;
      }
      assessments.set(a.criterionId,a);
    }
    if(bindingInvalid || assessments.size!==ts.criteria.length){
      row.reason='MANUFACTURER_CRITERION_BINDING_INVALID';continue;
    }
    let matched=0,failed=0,unknown=0;
    for(const criterion of ts.criteria){
      const a=assessments.get(criterion.id);
      if(!a || a.requirement!==criterion.requirement) {
        bindingInvalid=true;break;
      }
      if(a.result==='MATCH')matched++;
      else if(a.result==='FAIL')failed++;
      else unknown++;
      row.assessmentEvidence.push({criterionId:criterion.id,
        requirement:criterion.requirement,result:a.result,
        manufacturerUrl:a.evidence.url,
        manufacturerLocator:a.evidence.locator,
        manufacturerSha256:a.evidence.sha256,
        tsLocator:criterion.evidence.locator});
    }
    if(bindingInvalid) {
      row.reason='ORIGINAL_TS_CRITERION_MISMATCH';
      row.assessmentEvidence=[];continue;
    }
    row.matchedCriteria=matched;
    row.failedCriteria=failed;
    row.unknownCriteria=unknown;
    row.datasheetUrl=review.candidate.identityEvidence.url;
    row.datasheetSha256=identitySha;
    if(failed) {
      row.decision='TECHNICAL_FAIL';
      row.reason='REVIEWED_MANDATORY_TS_CRITERION_FAILED';
      row.confidence='MED';
    } else if(unknown) {
      row.reason='UNREVIEWED_OR_UNMATCHED_TS_CRITERIA';
    } else {
      row.decision='TECHNICAL_MATCH';
      row.tsCompliancePercent=100;
      row.reason='EVERY_TS_CRITERION_INDEPENDENTLY_MATCHED';
      row.confidence='HIGH';
    }
  }
  const priority={TECHNICAL_MATCH:0,TECHNICAL_REVIEW:1,TECHNICAL_FAIL:2};
  output.products.sort(function(a,b){
    return priority[a.decision]-priority[b.decision] ||
      a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model) ||
      a.partNumber.localeCompare(b.partNumber);
  });
  output.products.forEach(function(p){output.counts[p.decision]++;});
  return output;
}

/** CSV preview of technical candidates only. No supplier or financial claims. */
function previewTenderTechnicalProductsCsv(report) {
  if(!report || report.issue || report.mode!=='TECHNICAL_PRODUCT_SHORTLIST' ||
      !Array.isArray(report.products) || report.products.length>20) return null;
  const fields=['lotId','lotNumber','announcementNumber','brand','model',
    'partNumber','decision','tsCompliancePercent','matchedCriteria',
    'failedCriteria','unknownCriteria','confidence','reason',
    'originalTsUrl','datasheetUrl','priceKzt','netMarginPercent'];
  const cell=function(v){
    let s=String(v===null || v===undefined?'':v)
      .replace(/[\r\n\t]/g,' ').slice(0,1600);
    if(/^\s*[=+\-@\u0000-\u001f]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  const rows=[fields.map(cell).join(',')];
  report.products.forEach(function(p){
    const data={lotId:report.lotId,lotNumber:report.lotNumber,
      announcementNumber:report.announcementNumber,
      brand:p.brand,model:p.model,partNumber:p.partNumber,
      decision:p.decision,tsCompliancePercent:p.tsCompliancePercent,
      matchedCriteria:p.matchedCriteria,failedCriteria:p.failedCriteria,
      unknownCriteria:p.unknownCriteria,confidence:p.confidence,
      reason:p.reason,originalTsUrl:p.originalTsUrl,
      datasheetUrl:p.datasheetUrl,priceKzt:null,netMarginPercent:null};
    rows.push(fields.map(function(k){return cell(data[k]);}).join(','));
  });
  return rows.join('\r\n');
}
