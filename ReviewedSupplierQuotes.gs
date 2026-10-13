/**
 * Issue #30: per-lot supplier quote source-review bridge.
 *
 * Only out-of-band independently reviewed PRICE/STOCK/DELIVERY snapshots can
 * become ResearchPipeline quotes. Product card JSON-LD or an owner/AI-provided
 * status=CONFIRMED is not proof. This module is pure, offline and read-only.
 */
const TENDER_QUOTE_REVIEW = Object.freeze({
  maxOffers:30, maxLots:30, maxSnapshotAgeMs:86400000,
  maxShortlistAgeMs:300000
});

function tenderQuoteReviewTime_(s) {
  return typeof s==='string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s) ? Date.parse(s):NaN;
}
function tenderQuoteReviewText_(s,max) {
  return typeof s==='string' && !!s.trim() && s.length<=max &&
    !/[\x00-\x1f\x7f]/.test(s);
}
function tenderQuoteReviewProof_(e) {
  return e && {kind:e.kind,url:e.url,sha256:e.sha256,
    locator:e.locator,observedAt:e.observedAt};
}
function tenderQuoteReviewMatchProofs_(a,b) {
  if(!Array.isArray(a) || !Array.isArray(b) || a.length!==3 || b.length!==3) return false;
  const kinds=['PRICE','STOCK','DELIVERY'];
  return kinds.every(function(kind){
    const x=a.filter(function(p){return p && p.kind===kind;});
    const y=b.filter(function(p){return p && p.kind===kind;});
    return x.length===1 && y.length===1 && ['url','sha256','locator','observedAt'].every(function(key){
      return x[0][key]===y[0][key];
    });
  });
}
function tenderQuoteReviewLot_(shortlist,lot,now) {
  if(!shortlist || shortlist.issue || shortlist.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY' ||
      shortlist.coverage!=='sample_only' || !Array.isArray(shortlist.items) ||
      shortlist.items.length<1 || shortlist.items.length>TENDER_QUOTE_REVIEW.maxLots ||
      !lot || !tenderQuoteReviewText_(lot.id,16) ||
      !Number.isFinite(tenderQuoteReviewTime_(shortlist.observedAt)) ||
      now-tenderQuoteReviewTime_(shortlist.observedAt)>TENDER_QUOTE_REVIEW.maxShortlistAgeMs ||
      tenderQuoteReviewTime_(shortlist.observedAt)>now ||
      tenderQuoteReviewTime_(lot.verifiedAt)!==tenderQuoteReviewTime_(shortlist.observedAt)) return null;
  const match=shortlist.items.filter(function(row){return row && row.lotId===lot.id;});
  if(match.length!==1) return null;
  const item=match[0];
  const expected={lotNumber:'lotNumber',announcementNumber:'announcementNumber',
    statusCode:'status',plannedMethodId:'plannedMethodId',
    actualMethodId:'actualMethodId',amountKzt:'amountKzt',quantity:'quantity',
    applicationStart:'applicationStart',deadline:'deadline'};
  if(item.decision!=='SAME_DAY_CANDIDATE' || item.announcementId===undefined ||
      String(item.announcementId)!==lot.announcementId ||
      Object.keys(expected).some(function(k){return lot[k]!==item[expected[k]];}) ||
      !Array.isArray(item.planIds) || !Array.isArray(lot.planIds) ||
      JSON.stringify(item.planIds.slice().sort())!==JSON.stringify(lot.planIds.slice().sort()) ||
      lot.isGoods!==true || lot.active!==true || lot.planCoverageVerified!==true ||
      !tenderQuoteReviewText_(lot.unit,60) || !tenderQuoteReviewText_(item.sourceUrl,1500) ||
      !Number.isFinite(tenderQuoteReviewTime_(lot.applicationStart)) ||
      tenderQuoteReviewTime_(lot.applicationStart)>now ||
      !(tenderQuoteReviewTime_(lot.deadline)>now)) return null;
  return item;
}

/**
 * Source observations MUST first pass the existing UNREVIEWED intake.
 * Registry artifacts represent independently verified supplier ownership,
 * economic group, currency, availability, Kazakhstan logistics and original
 * source snapshots. They are NOT created or approved by this function.
 */
function finalizeTenderSupplierQuotes(shortlist,lot,observations,candidateReview,policy,nowIso) {
  const result={mode:'REVIEWED_SUPPLIER_QUOTES',status:'REVIEW',issue:null,
    lotId:lot && lot.id || null,observedAt:nowIso,items:[],quotes:[],
    verifiedQuotes:0,independentEconomicGroups:0,
    nationalDecision:'HOLD_NATIONAL',tsCompliance:'UNVERIFIED',
    commercialDecision:'REVIEW',sheetsChanged:false,watermarkAdvanced:false};
  const now=tenderQuoteReviewTime_(nowIso),cfg=policy && policy.supplierReview;
  if(!Number.isFinite(now) || !tenderQuoteReviewLot_(shortlist,lot,now) ||
      !Array.isArray(observations) || observations.length>TENDER_QUOTE_REVIEW.maxOffers ||
      !candidateReview || candidateReview.status!=='REVIEWED_ASSESSMENTS_READY' ||
      !candidateReview.candidate ||
      !['brand','model','partNumber'].every(function(k){
        return tenderQuoteReviewText_(candidateReview.candidate[k],120);
      }) ||
      !cfg || cfg.approved!==true || !Number.isFinite(cfg.maxAgeMs) ||
      cfg.maxAgeMs<=0 || cfg.maxAgeMs>TENDER_QUOTE_REVIEW.maxSnapshotAgeMs ||
      !Array.isArray(cfg.artifacts) || cfg.artifacts.length>900) {
    result.issue='SUPPLIER_REVIEW_CONTEXT_INVALID';return result;
  }
  const intake=intakeTenderSupplierOffers(shortlist,observations,nowIso);
  if(intake.issue || intake.offers.length!==observations.length) {
    result.issue='SUPPLIER_REVIEW_INTAKE_REJECTED';return result;
  }
  const candidate=candidateReview.candidate,seen=new Set(),groups=new Map(),owners=new Map();
  for(let i=0;i<observations.length;i++){
    const o=observations[i],source=intake.offers[i];
    const row={offerId:o && o.offerId || null,lotId:lot.id,
      status:'REVIEW',reason:'SOURCE_REVIEW_REQUIRED'};
    result.items.push(row);
    if(!source || source.status!=='PENDING_REVIEW' || !o ||
        source.lotId!==lot.id || source.reasons.some(function(x){
          return x!=='HUMAN_SOURCE_AND_SUPPLIER_VERIFICATION_REQUIRED';
        })) {
      row.reason='SOURCE_INTAKE_NOT_ELIGIBLE';continue;
    }
    if(seen.has(o.offerId)){row.reason='DUPLICATE_OFFER';continue;}
    seen.add(o.offerId);
    if(o.unit!==lot.unit || ['brand','model','partNumber'].some(function(k){
      return o[k]!==candidate[k];
    })){row.reason='EXACT_PRODUCT_OR_UNIT_MISMATCH';continue;}
    const artifacts=cfg.artifacts.filter(function(a){
      return a && a.approved===true && a.offerId===o.offerId &&
        a.lotId===lot.id && a.announcementId===lot.announcementId &&
        a.revisionHash===lot.revisionHash;
    });
    // Ambiguous/conflicting approvals must not be resolved by array order.
    if(artifacts.length!==1){row.reason='INDEPENDENT_APPROVAL_NOT_UNIQUE';continue;}
    const a=artifacts[0],at=tenderQuoteReviewTime_(a.reviewedAt);
    const priceEnd=tenderQuoteReviewTime_(a.validUntil);
    const proof=Array.isArray(a.snapshots)?a.snapshots:[];
    if(!tenderQuoteReviewText_(a.reviewerId,120) || !tenderQuoteReviewText_(a.reviewId,120) ||
        !tenderQuoteReviewText_(a.independenceGroup,120) ||
        a.supplierOwnershipVerified!==true || a.independenceVerified!==true ||
        a.exactProductReviewed!==true || a.priceReviewed!==true ||
        a.stockReviewed!==true || a.deliveryToKazakhstanReviewed!==true ||
        a.deliveryCompatible!==true || a.stockContradicted!==false ||
        a.stock!=='IN_STOCK' ||
        !Number.isFinite(at) || at>now || now-at>cfg.maxAgeMs ||
        !Number.isFinite(priceEnd) || priceEnd<=now ||
        priceEnd<tenderQuoteReviewTime_(lot.deadline) ||
        a.supplierId!==o.supplierId || a.provider!==o.provider ||
        a.origin!==o.origin || a.sourceKind!==o.sourceKind ||
        a.productUrl!==o.productUrl ||
        a.brand!==o.brand || a.model!==o.model || a.partNumber!==o.partNumber ||
        a.unit!==o.unit || a.unitPrice!==o.unitPrice ||
        a.currency!==o.currency || a.availableQuantity!==o.availableQuantity ||
        a.leadTimeDays!==o.leadTimeDays ||
        o.availableQuantity<lot.quantity ||
        !tenderQuoteReviewMatchProofs_(proof,o.evidence)) {
      row.reason='SUPPLIER_SOURCE_FACTS_UNVERIFIED';continue;
    }
    const timestamps=o.evidence.map(function(e){return tenderQuoteReviewTime_(e.observedAt);});
    if(timestamps.some(function(t){return !Number.isFinite(t) || t>at ||
      now-t>cfg.maxAgeMs;})){
      row.reason='SOURCE_SNAPSHOT_STALE_OR_UNREVIEWED';continue;
    }
    if(owners.has(o.supplierId) && owners.get(o.supplierId)!==a.independenceGroup) {
      row.reason='SUPPLIER_ECONOMIC_GROUP_CONFLICT';continue;
    }
    if(groups.has(a.independenceGroup) && groups.get(a.independenceGroup)!==o.supplierId &&
        a.groupOwnershipScopeVerified!==true) {
      row.reason='INDEPENDENCE_SCOPE_UNVERIFIED';continue;
    }
    owners.set(o.supplierId,a.independenceGroup);
    groups.set(a.independenceGroup,o.supplierId);
    const e=function(kind,locator) {
      const observation=proof.find(function(p){return p.kind===kind;});
      return {status:'CONFIRMED',url:observation.url,sha256:observation.sha256,
        locator:locator || observation.locator,observedAt:observation.observedAt};
    };
    const quote={id:o.offerId,supplierId:o.supplierId,
      independenceGroup:a.independenceGroup,identityEvidence:e('PRICE',
        'source review '+a.reviewId+'; '+proof.find(function(p){return p.kind==='PRICE';}).locator),
      sourceKind:o.sourceKind,priceEvidence:e('PRICE'),validUntil:a.validUntil,
      brand:o.brand,model:o.model,partNumber:o.partNumber,unit:o.unit,
      currency:o.currency,unitPrice:o.unitPrice,stock:'IN_STOCK',
      stockContradicted:false,availableQuantity:o.availableQuantity,
      stockEvidence:e('STOCK'),leadTimeDays:o.leadTimeDays,
      deliveryCompatible:true,deliveryEvidence:e('DELIVERY')};
    if(o.currency!=='KZT'){
      // FX source, spread and currency require independent out-of-band review.
      const fx=a.fx,ev=fx && fx.evidence;
      if(!fx || fx.currency!==o.currency ||
          typeof fx.rateKztPerUnit!=='number' || !Number.isFinite(fx.rateKztPerUnit) ||
          fx.rateKztPerUnit<=0 || fx.spreadReviewed!==true ||
          !ev || ev.status!=='CONFIRMED' || !supplierIntakeUrl_(ev.url) ||
          !/^[a-f0-9]{64}$/.test(ev.sha256 || '') ||
          !tenderQuoteReviewText_(ev.locator,240) ||
          !Number.isFinite(tenderQuoteReviewTime_(ev.observedAt)) ||
          tenderQuoteReviewTime_(ev.observedAt)>now ||
          now-tenderQuoteReviewTime_(ev.observedAt)>cfg.maxAgeMs) {
        row.reason='FX_SOURCE_REVIEW_REQUIRED';continue;
      }
      quote.fx={rateKztPerUnit:fx.rateKztPerUnit,spreadReviewed:true,
        evidence:{status:'CONFIRMED',url:ev.url,sha256:ev.sha256,
          locator:ev.locator,observedAt:ev.observedAt}};
    }
    result.quotes.push(quote);
    row.status='REVIEWED_QUOTE';row.reason='INDEPENDENT_SOURCE_ARTIFACT_MATCHED';
  }
  result.verifiedQuotes=result.quotes.length;
  result.independentEconomicGroups=new Set(result.quotes.map(function(q){
    return q.independenceGroup;
  })).size;
  result.status=result.quotes.length?'REVIEWED_QUOTES_READY':'REVIEW';
  return result;
}

/**
 * Connect the manufacturer review to reviewed supplier quotes and the
 * existing national/TS/15-cost/20% net margin gate. Does not invent costs,
 * tax, bid, supplier identities or facts. Never mutates input.
 */
function evaluateTenderWithReviewedSuppliers(baseInput,manufacturerReview,supplierReport,policy,nowIso) {
  const result={mode:'TENDER_REVIEWED_SUPPLIER_EVALUATION',status:'REVIEW',
    reason:'REVIEWED_SOURCE_INPUT_REQUIRED',research:null,
    selectedSupplier:null,netMarginPercent:null,sheetsChanged:false};
  if(!baseInput || baseInput.schemaVersion!==1 || !baseInput.lot ||
      !baseInput.ts || !manufacturerReview ||
      manufacturerReview.status!=='REVIEWED_ASSESSMENTS_READY' ||
      !manufacturerReview.candidate || !supplierReport ||
      supplierReport.mode!=='REVIEWED_SUPPLIER_QUOTES' ||
      supplierReport.status!=='REVIEWED_QUOTES_READY' ||
      supplierReport.issue || supplierReport.lotId!==baseInput.lot.id ||
      !Array.isArray(supplierReport.quotes) ||
      supplierReport.quotes.length>30 ||
      supplierReport.quotes.length!==supplierReport.verifiedQuotes ||
      !Number.isFinite(tenderQuoteReviewTime_(nowIso)) ||
      !Number.isFinite(tenderQuoteReviewTime_(supplierReport.observedAt)) ||
      tenderQuoteReviewTime_(supplierReport.observedAt)>tenderQuoteReviewTime_(nowIso) ||
      tenderQuoteReviewTime_(nowIso)-tenderQuoteReviewTime_(supplierReport.observedAt)>
        TENDER_QUOTE_REVIEW.maxShortlistAgeMs) return result;
  const source=manufacturerReview.candidate.identityEvidence;
  if(!source || source.status!=='CONFIRMED' ||
      !baseInput.ts.evidence ||
      !Array.isArray(baseInput.ts.criteria) ||
      !Array.isArray(manufacturerReview.candidate.assessment) ||
      manufacturerReview.candidate.assessment.length!==baseInput.ts.criteria.length ||
      manufacturerReview.candidate.assessment.some(function(a){
        return !a || a.tsSha256!==baseInput.ts.evidence.sha256 ||
          a.candidateIdentitySha256!==source.sha256;
      }) ||
      supplierReport.quotes.some(function(q){
        return !q || ['brand','model','partNumber'].some(function(k){
          return q[k]!==manufacturerReview.candidate[k];
        });
      })) {
    result.reason='MANUFACTURER_TS_AND_QUOTE_BINDING_INVALID';return result;
  }
  const input=Object.assign({},baseInput,{
    candidate:manufacturerReview.candidate,quotes:supplierReport.quotes.slice()
  });
  const analysis=evaluateTenderResearch(input,policy,nowIso);
  result.research=analysis;result.status=analysis.decision;
  result.reason=analysis.reasons.length?analysis.reasons[analysis.reasons.length-1]:'REVIEW';
  if(analysis.finance && analysis.validQuoteIds.includes(analysis.finance.quoteId)){
    const quote=input.quotes.find(function(q){return q.id===analysis.finance.quoteId;});
    result.selectedSupplier=quote && {supplierId:quote.supplierId,
      priceUrl:quote.priceEvidence.url,priceObservedAt:quote.priceEvidence.observedAt};
    result.netMarginPercent=analysis.finance.netMarginPercent;
  }
  return result;
}
