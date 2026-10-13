/**
 * Issue #30: manufacturer datasheet vs reviewed TS, evidence-bound comparison.
 * Pure offline. Structured measurements are explicitly supplied by a reviewer;
 * this code does NOT hallucinate OCR semantics or convert incompatible units.
 * Numeric outcomes are suggestions, NOT product MATCH attestations.
 *
 * Only a separate trusted source-review registry may authorize assessments
 * for ResearchPipeline. Zero network, OCR, Sheets, logging, billing or bidding.
 */
const TENDER_MFR_COMPARE = Object.freeze({
  maxCriteria:200,maxFacts:200,maxAgeMs:86400000,
  operators:['GE','GT','LE','LT','EQ','BETWEEN'],
  maxScaled:1000000000
});

function tenderMfrTime_(s) {
  return typeof s==='string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s) ? Date.parse(s):NaN;
}
function tenderMfrId_(s) {
  return typeof s==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(s);
}
function tenderMfrText_(s,max) {
  return typeof s==='string' && !!s.trim() && s.length<=max && !/[\u0000-\u001f]/.test(s);
}
function tenderMfrUrl_(s) {
  // No credentials, fragments, arbitrary local/IP hosts or HTTP.
  return typeof s==='string' && s.length<=1500 &&
    /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[^#\s]*$/i.test(s) &&
    !/^https:\/\/(?:localhost|(?:\d+\.){3}\d+)(?:\/|:)/i.test(s) &&
    !/^https:\/\/[^/]*@/i.test(s) && !/%2f|%5c|%00/i.test(s);
}
function tenderMfrScaled_(value) {
  // Decimal string with <=3 decimals, not a locale-dependent float.
  // Reject commas, exponents, thousands formatting and unsafe magnitudes.
  if(typeof value!=='string' || !/^-?(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(value)) return null;
  const negative=value[0]==='-',digits=negative?value.slice(1):value;
  const parts=digits.split('.');
  const n=Number(parts[0])*1000+Number((parts[1]||'').padEnd(3,'0'));
  const signed=negative?-n:n;
  return Number.isSafeInteger(signed) && Math.abs(signed)<=TENDER_MFR_COMPARE.maxScaled?signed:null;
}
function tenderMfrConstraint_(c) {
  if(!c || !TENDER_MFR_COMPARE.operators.includes(c.operator) ||
      !tenderMfrId_(c.parameterCode) ||
      !tenderMfrText_(c.unit,32)) return null;
  const op=c.operator;
  const low=op==='BETWEEN'?tenderMfrScaled_(c.minimum):null;
  const high=op==='BETWEEN'?tenderMfrScaled_(c.maximum):null;
  const target=op!=='BETWEEN'?tenderMfrScaled_(c.target):null;
  if(op==='BETWEEN') return low!==null && high!==null && low<=high &&
    c.target===undefined?{low,high}:null;
  return target!==null && c.minimum===undefined && c.maximum===undefined?{target}:null;
}

/** Does not trust user/manufacturer-supplied text as reviewed evidence.
 * It only proposes exact-unit numeric comparisons, with page/locator reference.
 */
function proposeTenderManufacturerMatches(ts,product,mappings,nowIso) {
  const output={mode:'MANUFACTURER_TS_COMPARISON',status:'REVIEW',reason:null,
    proposals:[],identityMatch:'UNVERIFIED',manufacturerDocumentVerified:false,
    technicalCompliance:'UNVERIFIED',nationalDecision:'HOLD_NATIONAL',
    sheetsChanged:false,commercialDecision:'REVIEW'};
  const now=tenderMfrTime_(nowIso),source=product && product.source;
  if(!Number.isFinite(now) || !ts || ts.origin!=='ORIGINAL_PROCUREMENT_DOCUMENT' ||
      ts.fullDocumentReviewed!==true || ts.currentVersionVerified!==true ||
      !tenderMfrId_(ts.lotId) || !tenderMfrId_(ts.announcementId) ||
      !ts.evidence || !/^[a-f0-9]{64}$/.test(ts.evidence.sha256 || '') ||
      !tenderMfrUrl_(ts.evidence.url) || !tenderMfrTime_(ts.evidence.observedAt) ||
      !Array.isArray(ts.criteria) || !ts.criteria.length ||
      ts.criteria.length>TENDER_MFR_COMPARE.maxCriteria ||
      !product || !tenderMfrText_(product.brand,120) ||
      !tenderMfrText_(product.model,120) || !tenderMfrText_(product.partNumber,120) ||
      !source || source.kind!=='OFFICIAL_MANUFACTURER_DATASHEET' ||
      !tenderMfrUrl_(source.url) || !/^[a-f0-9]{64}$/.test(source.sha256 || '') ||
      !tenderMfrText_(source.version,160) ||
      !Number.isFinite(tenderMfrTime_(source.observedAt)) ||
      tenderMfrTime_(source.observedAt)>now ||
      now-tenderMfrTime_(source.observedAt)>TENDER_MFR_COMPARE.maxAgeMs ||
      !Array.isArray(product.facts) || product.facts.length>TENDER_MFR_COMPARE.maxFacts ||
      !Array.isArray(mappings) || mappings.length!==ts.criteria.length) {
    output.reason='COMPARISON_INPUT_OR_DOCUMENT_UNVERIFIED';return output;
  }
  // An exact manufacturer's datasheet identity must explicitly name all three.
  const identity=source.productIdentity;
  if(!identity || !['brand','model','partNumber'].every(function(k){
      return tenderMfrText_(identity[k],120);
    })) {output.reason='DATASHEET_IDENTITY_MISSING';return output;}
  const norm=function(s){return s.trim().toLocaleLowerCase('en');};
  output.identityMatch=['brand','model','partNumber'].every(function(k){
    return norm(identity[k])===norm(product[k]);
  })?'EXACT_FIELDS':'MISMATCH';
  const facts=new Map();
  for(const f of product.facts){
    if(!f || !tenderMfrId_(f.id) || facts.has(f.id) ||
       !tenderMfrId_(f.parameterCode) || !tenderMfrText_(f.unit,32) ||
       tenderMfrScaled_(f.value)===null ||
       !Number.isInteger(f.pageNumber) || f.pageNumber<1 || f.pageNumber>200 ||
       !tenderMfrText_(f.locator,240) || !tenderMfrText_(f.verbatimText,1000) ||
       f.sourceSha256!==source.sha256) {
      output.reason='DATASHEET_FACT_INVALID';return output;
    }
    facts.set(f.id,f);
  }
  const criteria=new Set(),byCriterion=new Map();
  for(const c of ts.criteria){
    if(!c || !tenderMfrId_(c.id) || criteria.has(c.id) ||
       !tenderMfrText_(c.requirement,2000) ||
       !c.evidence || c.evidence.sha256!==ts.evidence.sha256) {
      output.reason='TS_CRITERION_BINDING_INVALID';return output;
    }
    criteria.add(c.id);byCriterion.set(c.id,c);
  }
  const bindings=new Map();
  for(const m of mappings) {
    if(!m || !tenderMfrId_(m.criterionId) || bindings.has(m.criterionId) ||
       !byCriterion.has(m.criterionId) ||
       m.requirement!==byCriterion.get(m.criterionId).requirement ||
       !['NUMERIC','UNMAPPED'].includes(m.kind)) {
      output.reason='MAPPING_NOT_EXHAUSTIVE_OR_UNBOUND';return output;
    }
    if(m.kind==='NUMERIC') {
      if(!tenderMfrId_(m.factId) || !tenderMfrConstraint_(m.constraint)) {
        output.reason='NUMERIC_MAPPING_MALFORMED';return output;
      }
    } else if(m.factId!==null || m.constraint!==null) {
      output.reason='UNMAPPED_MUST_REMAIN_UNKNOWN';return output;
    }
    bindings.set(m.criterionId,m);
  }
  for(const criterion of ts.criteria){
    const m=bindings.get(criterion.id);
    if(!m) {output.reason='MAPPING_NOT_EXHAUSTIVE_OR_UNBOUND';output.proposals=[];return output;}
    const suggestion={criterionId:criterion.id,requirement:criterion.requirement,
      tsSha256:ts.evidence.sha256,manufacturerSha256:source.sha256,
      result:'UNKNOWN',reason:'UNMAPPED_CRITERION',factId:null,
      datasheetPage:null,datasheetLocator:null,tsLocator:criterion.evidence.locator||null};
    if(m.kind==='NUMERIC') {
      const f=facts.get(m.factId),c=m.constraint;
      suggestion.factId=m.factId;
      if(!f) suggestion.reason='MISSING_DATASHEET_FACT';
      else if(output.identityMatch!=='EXACT_FIELDS') suggestion.reason='DATASHEET_PRODUCT_IDENTITY_MISMATCH';
      else if(f.parameterCode!==c.parameterCode || f.unit!==c.unit) suggestion.reason='PARAMETER_OR_UNIT_MISMATCH';
      else {
        const n=tenderMfrScaled_(f.value),v=tenderMfrConstraint_(c);
        if(n===null || !v) suggestion.reason='NUMERIC_VALUE_UNVERIFIED';
        else {
          const ok=c.operator==='GE'?n>=v.target:c.operator==='GT'?n>v.target:
            c.operator==='LE'?n<=v.target:c.operator==='LT'?n<v.target:
            c.operator==='EQ'?n===v.target:n>=v.low && n<=v.high;
          suggestion.result=ok?'SUGGEST_MATCH':'SUGGEST_FAIL';
          suggestion.reason=ok?'EXACT_UNIT_NUMERIC_CONSTRAINT_MET':'EXACT_UNIT_NUMERIC_CONSTRAINT_NOT_MET';
        }
      }
      if(f){suggestion.datasheetPage=f.pageNumber;suggestion.datasheetLocator=f.locator;}
    }
    output.proposals.push(suggestion);
  }
  output.status='SUGGESTIONS_ONLY';
  output.reason='INDEPENDENT_DATASHEET_AND_EVERY_CRITERION_REVIEW_REQUIRED';
  return output;
}

/**
 * Produces ResearchPipeline candidate.assessment only on a separately
 * approved trustworthy review record with exact assignments and provenance.
 * Review cannot turn UNKNOWN/SUGGEST_FAIL into MATCH.
 */
function finalizeTenderManufacturerAssessment(ts,product,mappings,review,policy,nowIso) {
  const result={mode:'MANUFACTURER_TS_REVIEW',status:'REVIEW',reason:null,
    candidate:null,comparison:null,nationalDecision:'HOLD_NATIONAL',
    tsCompliance:'UNVERIFIED',commercialDecision:'REVIEW',sheetsChanged:false};
  const preview=proposeTenderManufacturerMatches(ts,product,mappings,nowIso);
  result.comparison=preview;
  if(preview.status!=='SUGGESTIONS_ONLY' || preview.identityMatch!=='EXACT_FIELDS'){
    result.reason=preview.reason==='INDEPENDENT_DATASHEET_AND_EVERY_CRITERION_REVIEW_REQUIRED'?
      'PRODUCT_IDENTITY_MISMATCH':preview.reason;return result;
  }
  const now=tenderMfrTime_(nowIso),trust=policy && policy.manufacturerReview;
  if(!review || !tenderMfrId_(review.reviewId) ||
      review.lotId!==ts.lotId || review.announcementId!==ts.announcementId ||
      review.tsSha256!==ts.evidence.sha256 ||
      review.sourceUrl!==product.source.url ||
      review.sourceSha256!==product.source.sha256 ||
      review.sourceVersion!==product.source.version ||
      !Array.isArray(review.assignments) ||
      review.assignments.length!==preview.proposals.length){
    result.reason='MANUFACTURER_REVIEW_SCOPE_INVALID';return result;
  }
  const byId=new Map();
  for(const item of review.assignments){
    if(!item || !tenderMfrId_(item.criterionId) || byId.has(item.criterionId) ||
        !['MATCH','FAIL','UNKNOWN'].includes(item.result) ||
        !tenderMfrText_(item.reason,300)){
      result.reason='MANUFACTURER_REVIEW_ASSIGNMENTS_INVALID';return result;
    }
    byId.set(item.criterionId,item);
  }
  for(const p of preview.proposals){
    const a=byId.get(p.criterionId);
    if(!a || a.requirement!==p.requirement || a.factId!==p.factId ||
       a.sourceSuggestion!==p.result ||
       a.result==='MATCH' && p.result!=='SUGGEST_MATCH' ||
       a.result==='FAIL' && p.result!=='SUGGEST_FAIL') {
      result.reason='MANUFACTURER_REVIEW_OVERRIDES_UNSUPPORTED';return result;
    }
  }
  const a=trust && trust.approved===true && Number.isFinite(trust.maxAgeMs) &&
    trust.maxAgeMs>0 && trust.maxAgeMs<=TENDER_MFR_COMPARE.maxAgeMs &&
    Array.isArray(trust.artifacts) && trust.artifacts.find(function(x){
      const at=tenderMfrTime_(x && x.observedAt);
      return x && x.approved===true && x.reviewId===review.reviewId &&
        x.lotId===review.lotId && x.announcementId===review.announcementId &&
        x.tsSha256===review.tsSha256 &&
        x.sourceUrl===review.sourceUrl && x.sourceSha256===review.sourceSha256 &&
        x.sourceVersion===review.sourceVersion &&
        x.brand===product.brand && x.model===product.model &&
        x.partNumber===product.partNumber &&
        tenderMfrText_(x.reviewerId,120) && x.officialManufacturerVerified===true &&
        x.originalDatasheetBytesVerified===true &&
        x.currentDatasheetVersionVerified===true && x.productIdentityVerified===true &&
        x.everyCriterionReviewed===true && x.everySourceFactReviewed===true &&
        Number.isFinite(at) && at<=now && now-at<=trust.maxAgeMs &&
        JSON.stringify(x.assignments)===JSON.stringify(review.assignments) &&
        JSON.stringify(x.mappings)===JSON.stringify(mappings);
    });
  if(!a){result.reason='INDEPENDENT_MANUFACTURER_REVIEW_NOT_APPROVED';return result;}
  const evidence=function(locator){
    return {status:'CONFIRMED',url:product.source.url,sha256:product.source.sha256,
      locator:locator,observedAt:a.observedAt};
  };
  result.candidate={brand:product.brand,model:product.model,partNumber:product.partNumber,
    identityEvidence:evidence('review '+review.reviewId+' exact brand/model/part number, manufacturer datasheet'),
    assessment:preview.proposals.map(function(p){
      const assignment=byId.get(p.criterionId);
      return {criterionId:p.criterionId,requirement:p.requirement,
        tsSha256:p.tsSha256,candidateIdentitySha256:product.source.sha256,
        result:assignment.result,evidence:evidence('page '+(p.datasheetPage||'unknown')+
          '; '+(p.datasheetLocator||'no numeric locator')+'; review '+review.reviewId+
          '; criterion '+p.criterionId)};
    })};
  result.status='REVIEWED_ASSESSMENTS_READY';
  result.reason='EXACT_MANUFACTURER_REVIEW_REGISTERED';
  // A READY candidate still requires National PASS_TO_TS, original PDF, 3 real
  // independent offers, KZ logistics, taxes and >=20% planned net margin.
  return result;
}
