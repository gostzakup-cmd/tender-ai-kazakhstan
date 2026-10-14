/**
 * #30: Bridge TS-parameter searches to exact product-card follow-up.
 * Incoming Brave-style search responses are provided by an approved adapter,
 * not fetched here. Result links are discovery leads, NEVER matched products.
 * All original TS criteria remain attached for independent product evaluation.
 */
const TS_CARD_BRIDGE=Object.freeze({maxQueries:12,maxResultsPerQuery:5,maxCards:5});
function parseTenderTsSearchCardLeads(plan,responses,policy){
 const out={mode:'TS_SEARCH_PRODUCT_CARD_LEADS',issue:null,coverage:'provided_search_responses_only',
  items:[],rejected:[],technicalDecision:'TECHNICAL_REVIEW',
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',
  technicalMatchesVerified:0,certificatesChecked:false,pricesVerified:false,
  sheetsChanged:false,watermarkAdvanced:false};
 if(!plan||plan.issue||plan.mode!=='TS_PARAMETER_PRODUCT_SEARCH_PLAN'||
   !Array.isArray(plan.queries)||plan.queries.length<1||
   plan.queries.length>TS_CARD_BRIDGE.maxQueries||
   !Array.isArray(responses)||responses.length!==plan.queries.length){
   out.issue='SEARCH_PLAN_OR_RESPONSES_INVALID';return out;
 }
 const matched=new Set(),seen=new Set();
 for(const packet of responses){
  if(!packet||!Number.isInteger(packet.queryIndex)||packet.queryIndex<0||
     packet.queryIndex>=plan.queries.length||matched.has(packet.queryIndex)||
     !packet.response||!packet.response.query||
     packet.response.query.original!==plan.queries[packet.queryIndex].query||
     !packet.response.web||!Array.isArray(packet.response.web.results)||
     packet.response.web.results.length>TS_CARD_BRIDGE.maxResultsPerQuery){
   out.issue='SEARCH_RESPONSE_BINDING_INVALID';out.items=[];return out;
  }
  matched.add(packet.queryIndex);
  const planned=plan.queries[packet.queryIndex];
  if(!planned||planned.lotId!==plan.lotId||
     !TS_PARAMETER_SEARCH.domains.some(d=>d.market===planned.market&&d.host===planned.domain)||
     !Array.isArray(planned.requiredCriteria)||planned.requiredCriteria.length<1||
     !planned.requiredCriteria.every(tsProductSearchCriterion_)){
    out.issue='SEARCH_CRITERIA_OR_DOMAIN_INVALID';out.items=[];return out;
  }
  for(const item of packet.response.web.results){
   const url=item&&item.url,host=productCardHost_(url);
   if(!item||typeof item.title!=='string'||item.title.length>1000||
      !host||!(host===planned.domain||host.endsWith('.'+planned.domain))){
    out.rejected.push({queryIndex:packet.queryIndex,reason:'PRODUCT_URL_OUTSIDE_APPROVED_DOMAIN'});
    continue;
   }
   const key=planned.lotId+'|'+url;
   if(seen.has(key))continue;
   seen.add(key);
   if(out.items.length>=TS_CARD_BRIDGE.maxCards){
    out.rejected.push({queryIndex:packet.queryIndex,reason:'CARD_FOLLOWUP_LIMIT'});
    continue;
   }
   // Cards are an investigation step, not a technical datasheet attestation.
   const providers={'satu.kz':'SATU','kaspi.kz':'KASPI','ozon.ru':'OZON',
    'wildberries.ru':'WILDBERRIES','alibaba.com':'ALIBABA','1688.com':'1688'};
   const provider=providers[planned.domain],origin=planned.market;
   const card={lotId:planned.lotId,provider,origin,url};
   if(!productCardAllowed_(card,policy)){
    out.rejected.push({queryIndex:packet.queryIndex,reason:'PRODUCT_CARD_NOT_APPROVED'});
    continue;
   }
   out.items.push({lotId:planned.lotId,market:origin,provider,
    productUrl:url,title:item.title,verification:'PENDING_PRODUCT_CARD',
    requiredCriteria:planned.requiredCriteria.map(c=>Object.assign({},c)),
    candidateIdentity:null,technicalDecision:'TECHNICAL_REVIEW',
    tsCompliancePercent:null,certificateRequiredForSearch:false,
    observedPriceKzt:null,sourceType:'SEARCH_RESULT_LINK'});
  }
 }
 if(matched.size!==plan.queries.length){out.issue='SEARCH_RESPONSES_INCOMPLETE';out.items=[];}
 return out;
}
function planTenderTsCardFollowup(leads){
 if(!leads||leads.issue||leads.mode!=='TS_SEARCH_PRODUCT_CARD_LEADS'||
    !Array.isArray(leads.items)||leads.items.length>TS_CARD_BRIDGE.maxCards)return null;
 return {mode:'TS_PRODUCT_CARD_FOLLOWUP_PLAN',
  verification:'UNREVIEWED',technicalDecision:'TECHNICAL_REVIEW',
  nationalDecision:'HOLD_NATIONAL',commercialDecision:'REVIEW',
  requests:leads.items.map(item=>({lotId:item.lotId,provider:item.provider,
   origin:item.market,url:item.productUrl,expected:null,
   requiredCriteria:item.requiredCriteria.map(c=>Object.assign({},c))})),
  sheetsChanged:false};
}
