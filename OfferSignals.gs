/**
 * Issue #30 — schema.org Offer public stock/shipping observations.
 *
 * Observations come ONLY from already downloaded HTML JSON-LD; all values
 * remain UNREVIEWED even when syntax is valid. They NEVER establish supplier
 * identity, executable warehouse stock, committed Kazakhstan logistics,
 * payable freight/tax or a commercial quote.
 *
 * Conservative parser: one Offer, one shippingDestination, one shippingDetails
 * route, only exact numeric values and known units. No heuristic HTML scraping.
 */
const TENDER_OFFER_SIGNALS = Object.freeze({
  maxReportedQuantity:100000000, maxShippingDays:365,
  currencies:['KZT','RUB','CNY','USD','EUR']
});
function tenderOfferSignalsNum_(v) {
  const s=typeof v==='number'?String(v):v;
  return typeof s==='string' && /^(?:0|[1-9]\d{0,8})$/.test(s) &&
    Number.isSafeInteger(Number(s)) ? Number(s):null;
}
function tenderOfferSignalsMoney_(v) {
  const s=typeof v==='number'?String(v):v;
  if(typeof s!=='string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(s))return null;
  const n=Number(s);
  return Number.isFinite(n) && n>=0 && n<=1000000000 ? n:null;
}
function tenderOfferSignalsIs_(node,type) {
  const types=Array.isArray(node && node['@type'])?node['@type']:[node && node['@type']];
  return types.includes(type) || types.includes('https://schema.org/'+type) ||
    types.includes('http://schema.org/'+type);
}
function tenderOfferSignalsDays_(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) ||
      !tenderOfferSignalsIs_(value,'QuantitativeValue') ||
      !['DAY','d'].includes(value.unitCode) ||
      (value.minValue!==undefined &&
        (tenderOfferSignalsNum_(value.minValue)===null ||
         tenderOfferSignalsNum_(value.minValue)>tenderOfferSignalsNum_(value.maxValue))) ||
      value.value!==undefined ||
      value.maxValue===undefined) return null;
  const n=tenderOfferSignalsNum_(value.maxValue);
  return n!==null && n<=TENDER_OFFER_SIGNALS.maxShippingDays?n:null;
}
function extractTenderOfferSignals_(offer) {
  const result={verification:'UNREVIEWED',inventory:null,kazakhstanShipping:null,issues:[],
    stockVerified:false,deliveryVerified:false,deliveryPriceVerified:false};
  if(!offer || typeof offer!=='object' || Array.isArray(offer) ||
      !tenderOfferSignalsIs_(offer,'Offer')) {
    result.issues.push('OFFER_SCHEMA_NOT_VERIFIED');return result;
  }
  const inv=offer.inventoryLevel;
  if(inv!==undefined) {
    let q=null;
    if(typeof inv==='number' || typeof inv==='string')q=tenderOfferSignalsNum_(inv);
    else if(inv && typeof inv==='object' && !Array.isArray(inv) &&
        tenderOfferSignalsIs_(inv,'QuantitativeValue') &&
        (inv.unitCode===undefined || inv.unitCode==='C62') &&
        (inv.unitText===undefined ||
          ['item','items','piece','pieces','pcs'].includes(String(inv.unitText).toLowerCase()))) {
      q=tenderOfferSignalsNum_(inv.value);
      if(inv.minValue!==undefined || inv.maxValue!==undefined)q=null;
    }
    if(q!==null && q<=TENDER_OFFER_SIGNALS.maxReportedQuantity) {
      result.inventory={reportedQuantity:q,status:'UNREVIEWED',scope:'PUBLIC_LISTING'};
    } else result.issues.push('INVENTORY_LEVEL_NOT_A_VERIFIED_UNIT_COUNT');
  }
  const details=offer.shippingDetails;
  if(details===undefined)return result;
  if(!details || Array.isArray(details) || typeof details!=='object' ||
      !tenderOfferSignalsIs_(details,'OfferShippingDetails')) {
    result.issues.push('SHIPPING_DETAILS_AMBIGUOUS');return result;
  }
  const destination=details.shippingDestination;
  if(!destination || typeof destination!=='object' || Array.isArray(destination) ||
      !tenderOfferSignalsIs_(destination,'DefinedRegion')) {
    result.issues.push('SHIPPING_DESTINATION_NOT_EXACT');return result;
  }
  const country=destination.addressCountry;
  const countryCode=typeof country==='string'?country:
    country && typeof country==='object' &&
    tenderOfferSignalsIs_(country,'Country')?country.name:null;
  if(!['KZ','Kazakhstan','Қазақстан','Казахстан'].includes(countryCode)) {
    result.issues.push('NO_EXPLICIT_KAZAKHSTAN_DESTINATION');return result;
  }
  // A destination country is not an address, city or contractual deliverability.
  const route={destinationCountry:'KZ',status:'UNREVIEWED',
    maxReportedDeliveryDays:null,reportedShippingRate:null,
    shippingRateCurrency:null};
  const delivery=details.deliveryTime;
  if(delivery && !Array.isArray(delivery) && typeof delivery==='object' &&
      tenderOfferSignalsIs_(delivery,'ShippingDeliveryTime')) {
    const h=tenderOfferSignalsDays_(delivery.handlingTime);
    const t=tenderOfferSignalsDays_(delivery.transitTime);
    if(h!==null && t!==null && h+t<=TENDER_OFFER_SIGNALS.maxShippingDays) {
      route.maxReportedDeliveryDays=h+t;
    } else result.issues.push('DELIVERY_TIME_COMPONENTS_UNVERIFIED');
  } else result.issues.push('DELIVERY_TIME_NOT_SPECIFIED');
  const rate=details.shippingRate;
  if(rate && typeof rate==='object' && !Array.isArray(rate) &&
      tenderOfferSignalsIs_(rate,'MonetaryAmount') &&
      TENDER_OFFER_SIGNALS.currencies.includes(rate.currency)) {
    const amount=tenderOfferSignalsMoney_(rate.value);
    if(amount!==null) {
      route.reportedShippingRate=amount;
      route.shippingRateCurrency=rate.currency;
    } else result.issues.push('SHIPPING_RATE_UNVERIFIED');
  } else result.issues.push('SHIPPING_RATE_NOT_SINGLE_KNOWN_AMOUNT');
  // ShippingRate can be per parcel, destination, or conditional. Never use
  // in total landed cost without independent scope/quantity/tax review.
  result.kazakhstanShipping=route;
  return result;
}
