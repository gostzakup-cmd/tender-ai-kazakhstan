/**
 * TS-first product search terms for KZ/RU/CN selected merchant domains.
 * No brand, model, part number or certificates required. Unverified searches
 * are discovery hints, never confirmed technical compliance or quotations.
 */
const TS_PARAMETER_SEARCH=Object.freeze({
 maxCriteria:20,maxQueries:12,
 domains:Object.freeze([
  {market:'KZ',host:'satu.kz'},
  {market:'KZ',host:'kaspi.kz'},
  {market:'RU',host:'ozon.ru'},
  {market:'RU',host:'wildberries.ru'},
  {market:'CN',host:'alibaba.com'},
  {market:'CN',host:'1688.com'}
 ])
});
function tsProductSearchClean_(x,max){
 return typeof x==='string' && x.length>0 && x.length<=max &&
  x.trim()===x && !/[\u0000-\u001f<>{}"'\\|;]/.test(x) &&
  !/(?:\bsite:|\bOR\b|\bAND\b|https?:\/\/)/i.test(x);
}
function tsProductSearchCriterion_(c){
 if(!c || !/^[A-Za-z0-9_-]{1,64}$/.test(c.id||'') ||
   !/^[A-Z][A-Z0-9_]{1,31}$/.test(c.parameterCode||'') ||
   !['GE','LE','EQ','GT','LT','BETWEEN'].includes(c.operator) ||
   !tsProductSearchClean_(c.unit,20))return false;
 const ok=x=>typeof x==='string' && /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(x);
 return c.operator==='BETWEEN' ? ok(c.minimum)&&ok(c.maximum)&&
   Number(c.minimum)<=Number(c.maximum) && c.value===undefined :
   ok(c.value)&&c.minimum===undefined&&c.maximum===undefined;
}
function planTenderTsParameterSearch(lot,productLabel,criteria,markets){
 const out={mode:'TS_PARAMETER_PRODUCT_SEARCH_PLAN',issue:null,
  lotId:lot&&lot.id||null,queries:[],coverage:'selected_merchant_domains_only',
  technicalDecision:'TECHNICAL_REVIEW',nationalDecision:'HOLD_NATIONAL',
  commercialDecision:'REVIEW',certificateGate:false,
  matchedProductsVerified:0,sheetsChanged:false};
 if(!lot||!/^[1-9]\d{0,9}$/.test(lot.id||'')||lot.isGoods!==true||
   !tsProductSearchClean_(productLabel,90)||
   !Array.isArray(criteria)||criteria.length<1||
   criteria.length>TS_PARAMETER_SEARCH.maxCriteria||
   new Set(criteria.map(x=>x&&x.id)).size!==criteria.length ||
   !criteria.every(tsProductSearchCriterion_)||
   !Array.isArray(markets)||markets.length<1||markets.length>3||
   new Set(markets).size!==markets.length ||
   !markets.every(x=>['KZ','RU','CN'].includes(x))){
  out.issue='TS_PARAMETER_SEARCH_INPUT_INVALID';return out;
 }
 // Input constraints are pre-extracted, NOT inferred to be complete original TS.
 // Each search plan carries every bound requirement even when only the two
 // most distinctive values fit within the bounded query.
 const selected=criteria.slice(0,2);
 for(const d of TS_PARAMETER_SEARCH.domains){
  if(!markets.includes(d.market))continue;
  const bits=selected.map(c=>c.parameterCode+' '+
    (c.operator==='BETWEEN'?c.minimum+' '+c.maximum:c.value)+' '+c.unit);
  const query=productLabel+' '+bits.join(' ')+' site:'+d.host;
  out.queries.push({lotId:lot.id,market:d.market,domain:d.host,
    query,verification:'PENDING_PRODUCT_SEARCH',
    requiredCriteria:criteria.map(c=>Object.assign({},c)),
    certificateRequiredForSearch:false});
 }
 if(out.queries.length>TS_PARAMETER_SEARCH.maxQueries){
  out.issue='TS_PARAMETER_SEARCH_QUERY_LIMIT';out.queries=[];
 }
 return out;
}
