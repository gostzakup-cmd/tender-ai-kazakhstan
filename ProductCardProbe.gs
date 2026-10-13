/**
 * Issue #30 — opt-in, bounded, read-only product-card probe.
 * Reads exact approved HTTPS product URLs, never guesses search endpoints.
 * Extracts schema.org Product/Offer only; snapshots are UNREVIEWED, not quotes.
 * No scraping protections bypass, no cookies/tokens, no Sheets or bidding.
 */
const PRODUCT_CARD_PROBE = Object.freeze({
  maxCards:5,maxBytes:524288,maxRuntimeMs:30000,
  markets:Object.freeze({
    KASPI:['kaspi.kz'], SATU:['satu.kz'],
    ALIBABA:['alibaba.com'], '1688':['1688.com'],
    OZON:['ozon.kz','ozon.ru'], WILDBERRIES:['wildberries.kz','wildberries.ru','wildberries.com'],
    AMAZON:['amazon.com']
  })
});

function productCardHost_(url) {
  if (!supplierIntakeUrl_(url) || /%2f|%5c|%00/i.test(url)) return null;
  const m=/^https:\/\/([a-z0-9.-]+)(?::443)?(?:[/?]|$)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function productCardAllowed_(card, policy) {
  if (!card || typeof card !== 'object' || !SUPPLIER_INTAKE.providers.includes(card.provider) ||
      !SUPPLIER_INTAKE.origins.includes(card.origin) ||
      typeof card.lotId !== 'string' || !/^[1-9][0-9]{0,9}$/.test(card.lotId) ||
      !productCardHost_(card.url)) return false;
  const host=productCardHost_(card.url), known=PRODUCT_CARD_PROBE.markets[card.provider];
  // Fixed retail marketplace host allowlist. No arbitrary supplier hostname.
  if (known) return known.some(function (suffix) {
    return host===suffix || host.endsWith('.'+suffix);
  });
  // Manufacturer/distributor exact host only, separately approved by owner.
  if (!['MANUFACTURER','DISTRIBUTOR'].includes(card.provider) ||
      !policy || policy.approved!==true || !Array.isArray(policy.approvedHosts)) return false;
  return policy.approvedHosts.some(function (entry) {
    return entry && entry.approved===true &&
      entry.host===host && entry.provider===card.provider && entry.origin===card.origin;
  });
}

function productCardPlain_(s,max) {
  return typeof s==='string' && s.trim() && s.length<=max ? s.trim() : null;
}

function productCardNodes_(root) {
  const output=[], stack=[root];
  while (stack.length && output.length<50) {
    const node=stack.pop();
    if (Array.isArray(node)) {
      if (node.length>30) return [];
      node.forEach(function (x) {stack.push(x);});continue;
    }
    if (!node || typeof node!=='object') continue;
    output.push(node);
    if (Array.isArray(node['@graph'])) stack.push(node['@graph']);
    if (node.mainEntity) stack.push(node.mainEntity);
  }
  return output;
}

function productCardTypes_(node,type) {
  const value=node && node['@type'];
  return (Array.isArray(value)?value:[value]).some(function (t) {
    return t===type || t==='https://schema.org/'+type || t==='http://schema.org/'+type;
  });
}

/** Parse HTML JSON-LD without executing scripts; no heuristic invisible-price scrape. */
function parseTenderProductCard_(html,requestedUrl,expected,nowIso) {
  const out={status:'REVIEW',reason:'SCHEMA_PRODUCT_NOT_FOUND',identityMatch:'UNVERIFIED',
    product:null,listedOffer:null,availableQuantity:null,leadTimeDays:null,
    tsCompliance:'UNVERIFIED',supplierVerified:false,stockVerified:false,
    priceVerified:false,deliveryVerified:false, evidenceStatus:'UNREVIEWED',offerSignals:null};
  if (typeof html!=='string' || html.length>PRODUCT_CARD_PROBE.maxBytes ||
      !productCardHost_(requestedUrl)) {out.reason='PAGE_INVALID';return out;}
  // Extract only application/ld+json script tags, independent of attribute order.
  const blocks=[], tag=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match=tag.exec(html))!==null) {
    if (!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)(?=[\s>]|$)/i.test(match[1])) continue;
    if (match[2].length>131072 || blocks.length===20){out.reason='JSONLD_LIMIT';return out;}
    blocks.push(match[2]);
  }
  const products=[];
  for (const block of blocks) {
    let root;
    try {root=JSON.parse(block);} catch(e){continue;}
    productCardNodes_(root).filter(function (node) {
      return productCardTypes_(node,'Product');
    }).forEach(function(node){products.push(node);});
    if(products.length>10){out.reason='PRODUCT_AMBIGUOUS';return out;}
  }
  if (products.length!==1) {out.reason=products.length?'PRODUCT_AMBIGUOUS':'SCHEMA_PRODUCT_NOT_FOUND';return out;}
  const p=products[0],brand=typeof p.brand==='string'?p.brand:
    p.brand && typeof p.brand.name==='string'?p.brand.name:null;
  const fields={name:productCardPlain_(p.name,240),brand:productCardPlain_(brand,120),
    model:productCardPlain_(typeof p.model==='string'?p.model:p.model && p.model.name,120),
    partNumber:productCardPlain_(p.mpn,120),sku:productCardPlain_(p.sku,120)};
  out.product=fields;
  if (!expected || !['brand','model','partNumber'].every(function(k){return productCardPlain_(expected[k],120);})) {
    out.reason='EXPECTED_EXACT_IDENTITY_REQUIRED';return out;
  }
  // Mismatch is explicit; missing source fields are never a MATCH.
  const norm=s=>s.trim().toLowerCase();
  const pn=[fields.partNumber,fields.sku].filter(Boolean);
  const checks=[fields.brand?norm(fields.brand)===norm(expected.brand):null,
    fields.model?norm(fields.model)===norm(expected.model):null,
    pn.length?pn.some(function (s){return norm(s)===norm(expected.partNumber);}):null];
  out.identityMatch=checks.includes(false)?'MISMATCH':checks.includes(null)?'UNVERIFIED':'EXACT_FIELDS';
  const offers=Array.isArray(p.offers)?p.offers:p.offers?[p.offers]:[];
  if (offers.length!==1 || !offers[0] || !productCardTypes_(offers[0],'Offer')) {
    out.reason='SINGLE_OFFER_REQUIRED';return out;
  }
  const offer=offers[0], price=offer.price, rate=typeof price==='number'?price:
    typeof price==='string' && /^\d+(?:\.\d{1,2})?$/.test(price)?Number(price):NaN;
  if (!supplierIntakeMoney_(rate) || !SUPPLIER_INTAKE.currencies.includes(offer.priceCurrency)) {
    out.reason='PRICE_CURRENCY_UNVERIFIED';return out;
  }
  if (offer.url && (typeof offer.url!=='string' || productCardHost_(offer.url)!==productCardHost_(requestedUrl))) {
    out.reason='OFFER_URL_OTHER_SOURCE';return out;
  }
  const deadline=typeof offer.priceValidUntil==='string'?Date.parse(offer.priceValidUntil):null;
  if (deadline!==null && (!Number.isFinite(deadline) || deadline<Date.parse(nowIso))) {
    out.reason='PRICE_EXPIRED';return out;
  }
  const availability=typeof offer.availability==='string'?
    offer.availability.replace(/^https?:\/\/schema\.org\//i,''):null;
  if (availability && !['InStock','OutOfStock','BackOrder','PreOrder','LimitedAvailability','Discontinued','OnlineOnly'].includes(availability)) {
    out.reason='AVAILABILITY_UNRECOGNIZED';return out;
  }
  out.listedOffer={unitPrice:rate,currency:offer.priceCurrency,
    availability:availability || 'UNKNOWN',priceValidUntil:offer.priceValidUntil || null};
  out.offerSignals=extractTenderOfferSignals_(offer);
  // Listed "InStock" is not a verified executable quantity, nor KZ delivery.
  out.reason=out.identityMatch==='MISMATCH'?'PRODUCT_IDENTITY_MISMATCH':
    out.identityMatch!=='EXACT_FIELDS'?'PRODUCT_IDENTITY_INCOMPLETE':
    'PRICE_OBSERVED_NOT_CONFIRMED';
  out.status='UNREVIEWED_PRODUCT_CARD';
  return out;
}

/** Read only up to five exact direct product URLs after separately approved deploy.
 * Individual HTTP failures are redacted; source content is never logged or stored.
 * Only the existing shared rolling quota ledger is written by pilotBudget_.
 */
function inspectTenderProductCards(shortlist, requests, policy) {
  const start=Date.now(), stamp=new Date(start).toISOString();
  const report={mode:'PRODUCT_CARD_PROBE_READ_ONLY',coverage:'submitted_exact_urls_only',
    issue:null,observedAt:stamp,items:[],verifiedQuotes:0,nationalDecision:'HOLD_NATIONAL',
    sheetsChanged:false,watermarkAdvanced:false,revenueGuaranteed:false};
  if (!policy || policy.approved!==true || policy.allowPublicProductFetch!==true ||
      !shortlist || shortlist.issue || !Array.isArray(shortlist.items) ||
      shortlist.items.length>30 || !Array.isArray(requests) ||
      !requests.length || requests.length>PRODUCT_CARD_PROBE.maxCards ||
      new Set(requests.map(function(x){return x && x.url;})).size!==requests.length ||
      !Number.isFinite(Date.parse(shortlist.observedAt)) ||
      Date.parse(shortlist.observedAt)>start || start-Date.parse(shortlist.observedAt)>300000) {
    report.issue='PRODUCT_CARD_REQUEST_UNVERIFIED';return report;
  }
  const allowedLots=new Set(shortlist.items.filter(function(x){
    return x && x.decision==='SAME_DAY_CANDIDATE' &&
      Number.isFinite(Date.parse(x.deadline)) && Date.parse(x.deadline)>start;
  }).map(function(x){return x.lotId;}));
  if (requests.some(function(card){
    return !allowedLots.has(card && card.lotId) || !productCardAllowed_(card,policy) ||
      !card.expected || !['brand','model','partNumber'].every(function(k){
        return productCardPlain_(card.expected[k],120);
      });
  })) {report.issue='PRODUCT_CARD_SOURCE_NOT_APPROVED';return report;}
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(1000)){report.issue='PRODUCT_CARD_ALREADY_RUNNING';return report;}
  let budget=null, attempts=0;
  try {
    budget=pilotBudget_();
    for (const card of requests) {
      if (Date.now()-start>=PRODUCT_CARD_PROBE.maxRuntimeMs) throw safeApiError_('PRODUCT_CARD_TIME_LIMIT');
      budget.claim();attempts++;
      const item={lotId:card.lotId,productUrl:card.url,provider:card.provider,
        origin:card.origin,observedAt:null,httpStatus:null,contentSha256:null,
        status:'REVIEW',reason:'UNFETCHED',listedOffer:null,product:null,
        identityMatch:'UNVERIFIED',stockVerified:false,deliveryVerified:false,
        priceVerified:false, tsCompliance:'UNVERIFIED',offerSignals:null};
      report.items.push(item);
      let response;
      try {
        response=UrlFetchApp.fetch(card.url,{method:'get',muteHttpExceptions:true,
          followRedirects:false,validateHttpsCertificates:true,
          headers:{Accept:'text/html,application/ld+json'}});
      } catch(e) {item.reason='SOURCE_FETCH_FAILED';continue;}
      if(Date.now()-start>=PRODUCT_CARD_PROBE.maxRuntimeMs) throw safeApiError_('PRODUCT_CARD_LATE_RESULT');
      const code=response.getResponseCode();
      item.httpStatus=code;
      if(code===429){item.reason='SOURCE_RATE_LIMIT';break;}
      if(code!==200){item.reason='SOURCE_HTTP_BLOCKED_OR_UNAVAILABLE';continue;}
      const headers=response.getAllHeaders(), key=Object.keys(headers).find(function(k){return k.toLowerCase()==='content-type';});
      const type=key?String(headers[key]):'';
      if(!/^text\/html(?:\s*;|$)/i.test(type)){item.reason='SOURCE_CONTENT_TYPE_UNVERIFIED';continue;}
      const bytes=response.getContent();
      if(!bytes || bytes.length<10 || bytes.length>PRODUCT_CARD_PROBE.maxBytes){
        item.reason='SOURCE_SIZE_LIMIT';continue;
      }
      // Hash the downloaded bytes, NOT a fictional page/document checksum.
      const hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
        .map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
      const at=new Date().toISOString(),parsed=parseTenderProductCard_(
        response.getContentText('UTF-8'),card.url,card.expected,at);
      item.observedAt=at;item.contentSha256=hash;
      item.status=parsed.status;item.reason=parsed.reason;
      item.product=parsed.product;item.listedOffer=parsed.listedOffer;
      item.offerSignals=parsed.offerSignals;
      item.identityMatch=parsed.identityMatch;
      // Crucially no conversion into CONFIRMED price/stock/delivery or 100% TS.
    }
    report.requests=attempts;
    return nationalSafeReport_(report);
  }catch(e){
    // All-or-nothing on quota / timestamp failures, no partial observed prices.
    return {mode:'PRODUCT_CARD_PROBE_READ_ONLY',coverage:'submitted_exact_urls_only',
      issue:'PRODUCT_CARD_SOURCE_OR_QUOTA_BLOCKED',items:[],verifiedQuotes:0,
      nationalDecision:'HOLD_NATIONAL',requests:attempts,observedAt:new Date().toISOString(),
      sheetsChanged:false,watermarkAdvanced:false,revenueGuaranteed:false};
  }finally{lock.releaseLock();}
}
