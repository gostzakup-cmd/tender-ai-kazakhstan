/**
 * Issue #30: exact card HTTP observation -> supplier review-queue adapter.
 *
 * Source chain: approved search URL -> approved ProductCardProbe response ->
 * JSON-LD price observed from the actual page bytes -> separately SUPPLIED
 * stock/delivery evidence -> SupplierIntake UNREVIEWED queue.
 *
 * This is NOT a trusted source-review adapter; no CONFIRMED evidence, GO,
 * profit, FX, stock or lead time is invented. Pure offline, read-only.
 */
const TENDER_CARD_OFFER_BRIDGE = Object.freeze({
  maxCards:5,maxShortlistAgeMs:300000,maxCardAgeMs:300000,
  allowedPriceKinds:['KZT','RUB','CNY','USD','EUR']
});
function tenderCardOfferTime_(v){
  return typeof v==='string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)?
    Date.parse(v):NaN;
}
function tenderCardOfferValidId_(s) {
  return typeof s==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(s);
}
function tenderCardOfferExact_(a,b){
  return typeof a==='string' && typeof b==='string' &&
    a.trim().toLowerCase()===b.trim().toLowerCase() && a.trim().length>0;
}
/** Report grouped by currency ONLY; NEVER compare RUB/CNY/USD/EUR as KZT. */
function compareTenderCardObservedPrices(report) {
  const output={mode:'UNREVIEWED_PRICE_COMPARISON',coverage:'observed_cards_only',
    quotesVerified:0,netMarginPercent:null,nationalDecision:'HOLD_NATIONAL',
    items:[],issue:null};
  if(!report || report.mode!=='CARD_TO_SUPPLIER_EVIDENCE' || report.issue ||
     !Array.isArray(report.items) ||
     report.items.length>TENDER_CARD_OFFER_BRIDGE.maxCards){
    output.issue='PRICE_OBSERVATIONS_INVALID';return output;
  }
  const groups=new Map();
  report.items.forEach(function(item){
    if(!item || !item.priceObservation || item.priceObservation.status!=='UNREVIEWED')return;
    const p=item.priceObservation,k=item.lotId+'|'+p.currency;
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push({lotId:item.lotId,provider:item.provider,
      origin:item.origin,productUrl:item.productUrl,unitPrice:p.unitPrice,
      currency:p.currency,status:'UNREVIEWED'});
  });
  groups.forEach(function(items){
    items.sort(function(a,b){return a.unitPrice-b.unitPrice ||
      a.productUrl.localeCompare(b.productUrl);});
    output.items.push({lotId:items[0].lotId,currency:items[0].currency,
      offers:items,lowestObservedUnitPrice:items[0].unitPrice,
      quotedDeliveredCostKzt:null,netMarginPercent:null,verification:'UNREVIEWED'});
  });
  output.items.sort(function(a,b){return a.lotId.localeCompare(b.lotId) ||
    a.currency.localeCompare(b.currency);});
  return output;
}
/**
 * All inputs must come from the CURRENT selected lot and exact URL capture.
 * detail records identify self-declared sellers; they are NOT supplier proofs.
 * When stock/delivery data is absent, a pending fact checklist is returned.
 */
function assembleTenderCardOfferEvidence(shortlist,requests,cardReport,details,policy,nowIso) {
  const output={mode:'CARD_TO_SUPPLIER_EVIDENCE',coverage:'exact_cards_only',
    issue:null,observedAt:nowIso,items:[],observations:[],
    intake:null,verifiedQuotes:0,stockVerified:false,deliveryVerified:false,
    tsCompliance:'UNVERIFIED',netMarginPercent:null,
    nationalDecision:'HOLD_NATIONAL',decision:'REVIEW',
    sheetsChanged:false,watermarkAdvanced:false};
  const now=tenderCardOfferTime_(nowIso);
  const shortTime=tenderCardOfferTime_(shortlist && shortlist.observedAt);
  const reportTime=tenderCardOfferTime_(cardReport && cardReport.observedAt);
  if(!Number.isFinite(now) || !shortlist || shortlist.issue ||
     shortlist.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY' ||
     shortlist.coverage!=='sample_only' ||
     !Array.isArray(shortlist.items) || shortlist.items.length<1 ||
     shortlist.items.length>30 ||
     !Number.isFinite(shortTime) || shortTime>now ||
     now-shortTime>TENDER_CARD_OFFER_BRIDGE.maxShortlistAgeMs ||
     !Array.isArray(requests) || !requests.length ||
     requests.length>TENDER_CARD_OFFER_BRIDGE.maxCards ||
     !cardReport || cardReport.mode!=='PRODUCT_CARD_PROBE_READ_ONLY' ||
     cardReport.coverage!=='submitted_exact_urls_only' || cardReport.issue ||
     cardReport.nationalDecision!=='HOLD_NATIONAL' ||
     !Array.isArray(cardReport.items) ||
     cardReport.items.length!==requests.length ||
     !Number.isFinite(reportTime) || reportTime<shortTime || reportTime>now ||
     now-reportTime>TENDER_CARD_OFFER_BRIDGE.maxCardAgeMs ||
     !Array.isArray(details) || details.length>requests.length){
    output.issue='CARD_OFFER_INPUT_NOT_CURRENT';return output;
  }
  const ids=new Set(),lots=new Map(),requestKeys=new Set(),detailKeys=new Set(),cards=new Map();
  for(const l of shortlist.items){
    if(!l || typeof l.lotId!=='string' || lots.has(l.lotId)) {
      output.issue='CARD_OFFER_LOTS_AMBIGUOUS';return output;
    }
    lots.set(l.lotId,l);
  }
  for(const request of requests){
    const lot=request && lots.get(request.lotId);
    if(!request || !lot || lot.decision!=='SAME_DAY_CANDIDATE' ||
       !Number.isFinite(tenderCardOfferTime_(lot.deadline)) ||
       tenderCardOfferTime_(lot.deadline)<=now ||
       !Number.isFinite(tenderCardOfferTime_(lot.applicationStart)) ||
       tenderCardOfferTime_(lot.applicationStart)>now ||
       !tenderCardOfferValidId_(request.lotId) ||
       !request.expected || !['brand','model','partNumber'].every(function(k){
         return tenderCardOfferExact_(request.expected[k],request.expected[k]);
       }) ||
       !productCardAllowed_(request,policy) ||
       requestKeys.has(request.url) || requestKeys.has(request.lotId+'|'+request.url)) {
      output.issue='CARD_OFFER_REQUEST_UNVERIFIED';return output;
    }
    requestKeys.add(request.url);requestKeys.add(request.lotId+'|'+request.url);
  }
  for(const card of cardReport.items){
    const key=card && card.lotId+'|'+card.productUrl;
    const req=requests.find(function(r){return r.lotId===card.lotId && r.url===card.productUrl;});
    const time=tenderCardOfferTime_(card && card.observedAt);
    if(!card || !req || cards.has(key) ||
       card.provider!==req.provider || card.origin!==req.origin ||
       !Number.isFinite(time) || time<shortTime || time>now ||
       now-time>TENDER_CARD_OFFER_BRIDGE.maxCardAgeMs ||
       (card.contentSha256!==null && !/^[a-f0-9]{64}$/.test(card.contentSha256 || '')) ||
       card.priceVerified===true || card.stockVerified===true ||
       card.deliveryVerified===true || card.tsCompliance==='TS_COMPLIANCE_100_PERCENT') {
      output.issue='CARD_OFFER_CAPTURE_BINDING_FAILED';return output;
    }
    cards.set(key,card);
  }
  for(const detail of details){
    const key=detail && detail.lotId+'|'+detail.productUrl;
    if(!detail || !requests.some(function(r){
      return r.lotId===detail.lotId && r.url===detail.productUrl;
    }) || detailKeys.has(key)){
      output.issue='CARD_OFFER_SELLER_CONTEXT_INVALID';return output;
    }
    detailKeys.add(key);
  }
  for(const req of requests){
    const lot=lots.get(req.lotId),card=cards.get(req.lotId+'|'+req.url);
    const detail=details.find(function(d){
      return d.lotId===req.lotId && d.productUrl===req.url;
    });
    const row={lotId:req.lotId,productUrl:req.url,
      provider:req.provider,origin:req.origin,
      status:'REVIEW',reasons:[],priceObservation:null,
      publicInventorySignal:null,publicKazakhstanShippingSignal:null,
      supplierIdentityVerified:false,tsCompliance:'UNVERIFIED',
      stockVerified:false,deliveryVerified:false,
      supplierId:detail && detail.supplierId || null};
    output.items.push(row);
    if(!card || card.status!=='UNREVIEWED_PRODUCT_CARD' ||
       card.httpStatus!==200 ||
       card.identityMatch!=='EXACT_FIELDS' || !card.product ||
       !/^[a-f0-9]{64}$/.test(card.contentSha256 || '') ||
       !['brand','model'].every(function(k){
         return tenderCardOfferExact_(card.product[k],req.expected[k]);
       }) ||
       ![card.product.partNumber,card.product.sku].some(function(p){
         return tenderCardOfferExact_(p,req.expected.partNumber);
       }) ||
       !card.listedOffer ||
       !supplierIntakeMoney_(card.listedOffer.unitPrice) ||
       !TENDER_CARD_OFFER_BRIDGE.allowedPriceKinds.includes(card.listedOffer.currency)) {
      row.reasons.push('CARD_EXACT_PRICE_OR_IDENTITY_UNVERIFIED');continue;
    }
    const validUntil=card.listedOffer.priceValidUntil;
    if(validUntil!==null && validUntil!==undefined &&
       (!Number.isFinite(Date.parse(validUntil)) ||
        Date.parse(validUntil)<now)) {
      row.reasons.push('CARD_PRICE_EXPIRED');continue;
    }
    // Published listing signals are leads, NOT executable stock or shipping.
    if(card.offerSignals && card.offerSignals.verification==='UNREVIEWED' &&
       card.offerSignals.stockVerified===false && card.offerSignals.deliveryVerified===false) {
      row.publicInventorySignal=card.offerSignals.inventory || null;
      row.publicKazakhstanShippingSignal=card.offerSignals.kazakhstanShipping || null;
    }
    row.priceObservation={status:'UNREVIEWED',
      unitPrice:card.listedOffer.unitPrice,
      currency:card.listedOffer.currency,
      availability:card.listedOffer.availability||'UNKNOWN',
      sha256:card.contentSha256,observedAt:card.observedAt,
      locator:'JSON-LD Product.offers.price/priceCurrency',
      validUntil:validUntil||null};
    if(!detail){row.reasons.push('SUPPLIER_IDENTITY_REQUIRED');}
    const nonempty=function(s){return typeof s==='string' && !!s.trim() &&
      s.length<=120 && !/[\x00-\x1f]/.test(s);};
    if(!detail || !tenderCardOfferValidId_(detail.offerId) ||
       !nonempty(detail.supplierId) ||
       !nonempty(detail.supplierName) ||
       !nonempty(detail.unit) || !nonempty(lot.unit) ||
       detail.unit!==lot.unit) {
      row.reasons.push('SELLER_AND_LOT_UNIT_REVIEW_REQUIRED');
    }
    if(detail && (detail.provider!==req.provider || detail.origin!==req.origin ||
       (detail.currency!==undefined && detail.currency!==card.listedOffer.currency) ||
       (detail.unitPrice!==undefined && detail.unitPrice!==card.listedOffer.unitPrice))) {
      row.reasons.push('SOURCE_PRICE_OR_PROVIDER_CONTRADICTION');
    }
    if(!detail || !Number.isSafeInteger(detail.availableQuantity) ||
       detail.availableQuantity<lot.quantity) row.reasons.push('QUANTITY_OR_STOCK_SOURCE_REQUIRED');
    if(!detail || !Number.isFinite(detail.leadTimeDays) ||
       detail.leadTimeDays<0 || detail.leadTimeDays>365)
       row.reasons.push('DELIVERY_DAYS_AND_ROUTE_REQUIRED');
    const other=detail && [detail.stockEvidence,detail.deliveryEvidence];
    if(!other || other.some(function(e,i){
      return !e || e.kind!==(i===0?'STOCK':'DELIVERY') ||
        !supplierIntakeEvidence_(e,now,SUPPLIER_INTAKE.maxAgeMs) ||
        tenderCardOfferTime_(e.observedAt)<shortTime;
    })) row.reasons.push('STOCK_AND_DELIVERY_SNAPSHOTS_REQUIRED');
    // The card can only furnish UNREVIEWED price evidence. Independently
    // supplied stock and delivery facts must still have their own sources.
    if(row.reasons.length)continue;
    const priceProof={kind:'PRICE',status:'UNREVIEWED',url:req.url,
      locator:row.priceObservation.locator,
      sha256:card.contentSha256,observedAt:card.observedAt};
    const observation={lotId:req.lotId,offerId:detail.offerId,
      supplierId:detail.supplierId,supplierName:detail.supplierName,
      provider:req.provider,origin:req.origin,sourceKind:'OFFICIAL_CATALOG',
      productUrl:req.url,brand:req.expected.brand,model:req.expected.model,
      partNumber:req.expected.partNumber,unit:detail.unit,
      unitPrice:card.listedOffer.unitPrice,
      currency:card.listedOffer.currency,
      availableQuantity:detail.availableQuantity,
      leadTimeDays:detail.leadTimeDays,
      evidence:[priceProof,detail.stockEvidence,detail.deliveryEvidence].map(function(e){
        return {kind:e.kind,status:'UNREVIEWED',url:e.url,sha256:e.sha256,
          locator:e.locator,observedAt:e.observedAt};
      })};
    output.observations.push(observation);
    row.status='PENDING_INDEPENDENT_REVIEW';
    row.reasons.push('PRICE_STOCK_DELIVERY_ARE_UNREVIEWED');
  }
  if(output.observations.length){
    const intake=intakeTenderSupplierOffers(shortlist,output.observations,nowIso);
    if(intake.issue || intake.offers.some(function(item){
      return item.status!=='PENDING_REVIEW';
    })){
      output.issue='SUPPLIER_INTAKE_BRIDGE_REJECTED';
      output.items=[];output.observations=[];return output;
    }
    output.intake=intake;
  }
  return output;
}

/** CSV preview: no spreadsheet write. Literal formula prefixes escaped. */
function previewTenderCardOfferEvidenceCsv(report) {
  if(!report || report.mode!=='CARD_TO_SUPPLIER_EVIDENCE' || report.issue ||
     !Array.isArray(report.items) || report.items.length>5)return null;
  const fields=['lotId','provider','origin','productUrl','status',
    'listedUnitPrice','currency','availability','observedAt','reasons'];
  const cell=function(v){
    let s=String(v==null?'':v).replace(/[\r\n\t]/g,' ').slice(0,1500);
    if(/^\s*[=+\-@\u0000-\u001f]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  const rows=[fields.map(cell).join(',')];
  report.items.forEach(function(i){
    const p=i.priceObservation||{};
    rows.push([i.lotId,i.provider,i.origin,i.productUrl,i.status,
      p.unitPrice,p.currency,p.availability,p.observedAt,
      i.reasons.join('|')].map(cell).join(','));
  });
  return rows.join('\r\n');
}
