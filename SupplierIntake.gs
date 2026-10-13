/** Supplier offer evidence intake: offline / read-only; never asserts confirmation.
 * Sources can be entered from legitimate supplier APIs, public catalog pages or
 * direct quotes. A URI or supplied price alone never proves its own contents.
 * Only a separately trusted reviewed adapter may later produce CONFIRMED proofs.
 */
const SUPPLIER_INTAKE = Object.freeze({
  maxLots:30,maxOffersPerLot:30,maxAgeMs:86400000,
  origins:['KZ','RU','CN'],currencies:['KZT','RUB','CNY','USD','EUR'],
  providers:['MANUFACTURER','DISTRIBUTOR','KASPI','SATU','ALIBABA','1688','OZON','WILDBERRIES','AMAZON','DIRECT_QUOTE']
});

function supplierIntakeUrl_(url) {
  if (typeof url !== 'string' || url.length > 1500 || !/^https:\/\//i.test(url)) return false;
  // No credentials, fragments, URL shorteners, loopback, IP literals or private hosts.
  const match=/^https:\/\/([^/?#:@]+)(?::443)?(\/[^?#]*)?(?:\?[^#]*)?$/i.exec(url);
  if (!match || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(match[1]) ||
      /(^|\.)((localhost)|(local)|(internal)|(test)|(invalid))$/i.test(match[1]) ||
      /^(?:\d+\.){3}\d+$/.test(match[1]) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(match[1])) return false;
  return !/[\s<>"'\\]/.test(url);
}

function supplierIntakeMoney_(n) {
  return typeof n==='number' && Number.isFinite(n) && n>0 &&
    Number.isSafeInteger(Math.round(n*100)) && Math.abs(n*100-Math.round(n*100))<0.00001;
}

function supplierIntakeEvidence_(e, now, maxAge) {
  return !!e && typeof e==='object' && e.status==='UNREVIEWED' &&
    supplierIntakeUrl_(e.url) &&
    typeof e.locator==='string' && e.locator.length>=2 && e.locator.length<=240 &&
    /^[0-9a-f]{64}$/.test(e.sha256 || '') &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(e.observedAt || '') &&
    Number.isFinite(Date.parse(e.observedAt)) &&
    Date.parse(e.observedAt)<=now && now-Date.parse(e.observedAt)<=maxAge;
}

/** Normalize *unreviewed* owner-supplied observations into a research work queue.
 * Does not make HTTP calls, extract page data or set proof.status='CONFIRMED'.
 * Every quote is kept linked to a specific lot+product; unmatched ones get REVIEW.
 */
function intakeTenderSupplierOffers(shortlist, observations, nowIso) {
  const result={mode:'SUPPLIER_EVIDENCE_INTAKE',coverage:'submitted_observations_only',
    issue:null,observedAt:nowIso,sheetsChanged:false,verifiedQuotes:0,
    authorizedResearch:false,offers:[],lotCoverage:[],exportReady:false};
  const now=Date.parse(nowIso);
  if (!shortlist || !Array.isArray(shortlist.items) || shortlist.items.length>SUPPLIER_INTAKE.maxLots ||
      shortlist.issue || !Array.isArray(observations) ||
      observations.length>SUPPLIER_INTAKE.maxLots*SUPPLIER_INTAKE.maxOffersPerLot ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(nowIso || '') ||
      !Number.isFinite(now) || new Set(shortlist.items.map(x=>x && x.lotId)).size!==shortlist.items.length) {
    result.issue='INTAKE_INPUT_INVALID';return result;
  }
  const byLot=new Map(shortlist.items.map(x=>[x.lotId,x])), counts=new Map(), ids=new Set();
  for (const o of observations) {
    // Use a constant bounded metadata view, not arbitrary untrusted payload fields.
    const r={lotId:o && o.lotId || null,offerId:o && o.offerId || null,
      status:'REVIEW',reasons:[],supplier:null,product:null,commercial:null,source:null};
    result.offers.push(r);
    if (!o || typeof o.offerId!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(o.offerId) ||
        ids.has(o.offerId)) {r.reasons.push('OFFER_ID_INVALID_OR_DUPLICATE');continue;}
    ids.add(o.offerId);
    if (typeof o.lotId!=='string' || !byLot.has(o.lotId) ||
        byLot.get(o.lotId).decision!=='SAME_DAY_CANDIDATE') {
      r.reasons.push('CURRENT_LOT_CANDIDATE_REQUIRED');continue;
    }
    const count=(counts.get(o.lotId)||0)+1;counts.set(o.lotId,count);
    if (count>SUPPLIER_INTAKE.maxOffersPerLot){r.reasons.push('LOT_OFFER_LIMIT');continue;}
    if (!SUPPLIER_INTAKE.providers.includes(o.provider) || !SUPPLIER_INTAKE.origins.includes(o.origin) ||
        !['SUPPLIER_OFFER','OFFICIAL_CATALOG'].includes(o.sourceKind) ||
        !supplierIntakeUrl_(o.productUrl)) {
      r.reasons.push('SOURCE_NOT_VERIFIABLE');continue;
    }
    const nonempty=k=>typeof o[k]==='string' && o[k].trim().length>0 && o[k].length<=120;
    if (!['supplierId','supplierName','brand','model','partNumber','unit'].every(nonempty)) {
      r.reasons.push('IDENTITY_NOT_SPECIFIED');continue;
    }
    if (!SUPPLIER_INTAKE.currencies.includes(o.currency) || !supplierIntakeMoney_(o.unitPrice) ||
        !Number.isSafeInteger(o.availableQuantity) || o.availableQuantity<0 ||
        !Number.isFinite(o.leadTimeDays) || o.leadTimeDays<0 || o.leadTimeDays>365) {
      r.reasons.push('PRICE_STOCK_OR_LEAD_TIME_INVALID');continue;
    }
    if (!Array.isArray(o.evidence) || o.evidence.length!==3 ||
        new Set(o.evidence.map(e=>e && e.kind)).size!==3 ||
        !['PRICE','STOCK','DELIVERY'].every(kind=>o.evidence.some(e=>e.kind===kind &&
          supplierIntakeEvidence_(e,now,SUPPLIER_INTAKE.maxAgeMs))) ||
        !o.evidence.some(e=>e.kind==='PRICE' && e.url===o.productUrl)) {
      r.reasons.push('EVIDENCE_SNAPSHOT_INCOMPLETE');continue;
    }
    const lot=byLot.get(o.lotId);
    r.supplier={id:o.supplierId,name:o.supplierName,origin:o.origin,provider:o.provider};
    r.product={brand:o.brand,model:o.model,partNumber:o.partNumber,unit:o.unit};
    r.commercial={unitPrice:o.unitPrice,currency:o.currency,
      availableQuantity:o.availableQuantity,leadTimeDays:o.leadTimeDays};
    r.source={productUrl:o.productUrl,observedAt:o.evidence.find(e=>e.kind==='PRICE').observedAt};
    if (!Number.isFinite(lot.quantity) || lot.quantity<=0 ||
        o.availableQuantity<lot.quantity) r.reasons.push('INSUFFICIENT_STOCK');
    if (!lot.sourceUrl) r.reasons.push('LOT_URL_UNVERIFIED');
    r.reasons.push('HUMAN_SOURCE_AND_SUPPLIER_VERIFICATION_REQUIRED');
    r.status='PENDING_REVIEW';
  }
  shortlist.items.forEach(lot=>{
    const candidates=result.offers.filter(o=>o.lotId===lot.lotId && o.status==='PENDING_REVIEW');
    const distinct=new Set(candidates.map(o=>o.supplier.id));
    result.lotCoverage.push({lotId:lot.lotId,observations:candidates.length,
      uniqueSupplierIds:distinct.size,independenceVerified:false,
      nationalDecision:'HOLD_NATIONAL',decision:'REVIEW',
      requiresThreeIndependentReviewedQuotes:distinct.size<3});
  });
  return result;
}

/** CSV-only preview; no spreadsheet write, price or source promoted to CONFIRMED. */
function previewTenderSupplierIntakeCsv(report) {
  if (!report || report.mode!=='SUPPLIER_EVIDENCE_INTAKE' || report.issue ||
      !Array.isArray(report.offers) || report.offers.length>900) return null;
  const cell=v=>{
    const s=String(v==null?'':v).replace(/[\r\n\t]/g,' ').slice(0,1500);
    const safe=/^\s*[=+\-@\u0000-\u001f]/.test(s)?"'"+s:s;
    return '"'+safe.replace(/"/g,'""')+'"';
  };
  const columns=['lotId','offerId','status','supplier','country','provider','brand','model',
    'partNumber','unit','unitPrice','currency','availableQuantity','leadTimeDays','productUrl','reasons'];
  const rows=[columns.map(cell).join(',')];
  report.offers.forEach(r=>{
    const data=[r.lotId,r.offerId,r.status,r.supplier&&r.supplier.name,
      r.supplier&&r.supplier.origin,r.supplier&&r.supplier.provider,
      r.product&&r.product.brand,r.product&&r.product.model,
      r.product&&r.product.partNumber,r.product&&r.product.unit,
      r.commercial&&r.commercial.unitPrice,r.commercial&&r.commercial.currency,
      r.commercial&&r.commercial.availableQuantity,r.commercial&&r.commercial.leadTimeDays,
      r.source&&r.source.productUrl,(r.reasons||[]).join('|')];
    rows.push(data.map(cell).join(','));
  });
  return rows.join('\r\n');
}
