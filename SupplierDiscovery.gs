/**
 * Issue #30: bounded supplier-card URL discovery via the documented Brave Web Search API.
 * This is NOT a merchant quote API, price/stock confirmation or approved billable run.
 * No API calls occur without separate owner consent and a Script Properties key.
 * Search results are transient: no persistence, Sheets, cache, console or full response dump.
 *
 * Docs: https://api-dashboard.search.brave.com/api-reference/web/search/get
 */
const TENDER_SUPPLIER_SEARCH = Object.freeze({
  endpoint:'https://api.search.brave.com/res/v1/web/search',
  maxQueries:6, perQuery:5, maxResponseBytes:262144, maxRuntimeMs:30000,
  apiKeyProperty:'BRAVE_SEARCH_API_KEY',
  catalogDomains:Object.freeze({
    'KASPI:KZ':'kaspi.kz',
    'SATU:KZ':'satu.kz',
    'OZON:KZ':'ozon.kz',
    'OZON:RU':'ozon.ru',
    'WILDBERRIES:KZ':'wildberries.kz',
    'WILDBERRIES:RU':'wildberries.ru',
    'ALIBABA:CN':'alibaba.com',
    '1688:CN':'1688.com'
  })
});

function tenderSupplierSearchTerm_(value) {
  return typeof value==='string' && value.length>=1 && value.length<=80 &&
    /^[A-Za-z0-9\u0400-\u04ff\u4e00-\u9fff][A-Za-z0-9\u0400-\u04ff\u4e00-\u9fff ._+()\/-]*$/.test(value) &&
    value.trim()===value && !/\s{2}/.test(value) ? value : null;
}

function tenderSupplierSearchDomain_(target,policy) {
  if (!target || !target.provider || !target.origin) return null;
  const key=target.provider+':'+target.origin;
  const fixed=TENDER_SUPPLIER_SEARCH.catalogDomains[key];
  if (fixed) return !target.domain || target.domain===fixed ? fixed : null;
  if (!['MANUFACTURER','DISTRIBUTOR'].includes(target.provider) ||
      !target.domain || !productCardHost_('https://'+target.domain+'/') ||
      !policy || !Array.isArray(policy.approvedHosts)) return null;
  return policy.approvedHosts.some(function(x) {
    return x && x.approved===true && x.host===target.domain &&
      x.provider===target.provider && x.origin===target.origin;
  }) ? target.domain : null;
}

/** Pure preview is allowed without API subscription or permission to spend. */
function planTenderSupplierDiscovery(shortlist,targets,policy,nowIso) {
  const result={mode:'SUPPLIER_SEARCH_PLAN',coverage:'selected_domains_only',issue:null,
    observedAt:nowIso,queries:[],supplierOffersVerified:0,nationalDecision:'HOLD_NATIONAL',
    sheetsChanged:false,canExecute:false};
  const now=Date.parse(nowIso), observed=shortlist && Date.parse(shortlist.observedAt);
  if (!shortlist || shortlist.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY' ||
      shortlist.coverage!=='sample_only' || shortlist.issue ||
      !Array.isArray(shortlist.items) || shortlist.items.length>30 ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(nowIso || '') ||
      !Number.isFinite(now) || !Number.isFinite(observed) || observed>now ||
      now-observed>300000 || !Array.isArray(targets) || !targets.length ||
      targets.length>TENDER_SUPPLIER_SEARCH.maxQueries ||
      !policy || new Set(shortlist.items.map(function(l){return l && l.lotId;})).size!==shortlist.items.length) {
    result.issue='SUPPLIER_SEARCH_INPUT_INVALID';return result;
  }
  const lots=new Map(shortlist.items.map(function(l){return [l.lotId,l];})), used=new Set();
  for (const t of targets) {
    if (!t || !t.expected || typeof t.lotId!=='string' ||
        !/^[1-9]\d{0,9}$/.test(t.lotId) || Number(t.lotId)>2147483647 ||
        !lots.has(t.lotId)) {result.issue='SEARCH_TARGET_INVALID';break;}
    const lot=lots.get(t.lotId);
    let current=false;
    try {
      current=lot && lot.decision==='SAME_DAY_CANDIDATE' &&
        typeof shortlist.date==='string' && /^\d{4}-\d\d-\d\d$/.test(shortlist.date) &&
        typeof lot.deadlineTimezone==='string' &&
        Utilities.formatDate(new Date(now),lot.deadlineTimezone,'yyyy-MM-dd')===shortlist.date &&
        Number.isFinite(Date.parse(lot.deadline)) && Date.parse(lot.deadline)>now &&
        Number.isFinite(Date.parse(lot.applicationStart)) && Date.parse(lot.applicationStart)<=now;
    } catch(e) {current=false;}
    if (!current) {result.issue='SEARCH_LOT_NOT_CURRENT';break;}
    const parts=['brand','model','partNumber'].map(function(k){return tenderSupplierSearchTerm_(t.expected[k]);});
    const domain=tenderSupplierSearchDomain_(t,policy);
    if (parts.some(function(x){return !x;}) || !domain) {
      result.issue='SEARCH_IDENTITY_OR_DOMAIN_UNVERIFIED';break;
    }
    const id=t.lotId+'|'+domain;
    if (used.has(id)) {result.issue='SEARCH_DUPLICATE_DOMAIN';break;}
    used.add(id);
    const q=parts.map(function(s){return '"'+s+'"';}).join(' ')+' site:'+domain;
    result.queries.push({lotId:t.lotId,provider:t.provider,origin:t.origin,
      domain:domain,expected:{brand:parts[0],model:parts[1],partNumber:parts[2]},
      query:q});
  }
  if (result.issue) result.queries=[];
  return result;
}

/** Search result references are NOT product/price/TS/stock evidence. */
function parseTenderSupplierSearch_(response,planned) {
  if (!response || typeof response!=='object' || !response.query ||
      response.query.original!==planned.query || !response.web ||
      !Array.isArray(response.web.results) ||
      response.web.results.length>TENDER_SUPPLIER_SEARCH.perQuery) {
    throw new Error('SUPPLIER_SEARCH_SCHEMA_UNVERIFIED');
  }
  const found=[],seen=new Set();
  for (const r of response.web.results) {
    if (!r || typeof r.url!=='string' || !supplierIntakeUrl_(r.url) ||
        typeof r.title!=='string' || r.title.length>1000) continue;
    const host=productCardHost_(r.url);
    if (!host || !(host===planned.domain || host.endsWith('.'+planned.domain))) continue;
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    // No merchant-specific product URL/path assumption. Re-fetch exact source
    // with ProductCardProbe, whose result is still UNREVIEWED.
    const visible=(r.title+' '+(typeof r.description==='string'?r.description:'')).toLowerCase();
    found.push({lotId:planned.lotId,provider:planned.provider,origin:planned.origin,
      productUrl:r.url,sourceType:'SEARCH_RESULT_LINK',verification:'PENDING_PRODUCT_CARD',
      possiblePartNumberMention:visible.includes(planned.expected.partNumber.toLowerCase()),
      offerPriceKzt:null,stockVerified:false,deliveryVerified:false,
      tsCompliance:'UNVERIFIED',nationalDecision:'HOLD_NATIONAL'});
  }
  return found;
}

/**
 * Manual, opt-in runtime. To enable, OWNER must separately authorize search API
 * usage/billing, set policy permissions AND store a key in Apps Script properties.
 * It does not install a plan, modify secrets, write Sheets or schedule itself.
 */
function inspectTenderSupplierDiscovery(shortlist,targets,policy) {
  const started=Date.now();
  const report={mode:'SUPPLIER_SEARCH_URL_PREVIEW',coverage:'selected_domains_only',
    issue:null,observedAt:new Date(started).toISOString(),items:[],queriesAttempted:0,
    supplierOffersVerified:0,priceVerified:false,stockVerified:false,
    nationalDecision:'HOLD_NATIONAL',sheetsChanged:false,watermarkAdvanced:false,
    revenueGuaranteed:false};
  const plan=planTenderSupplierDiscovery(shortlist,targets,policy,report.observedAt);
  if (plan.issue) {report.issue=plan.issue;return report;}
  if (!policy || policy.approved!==true || policy.allowSearchApiCall!==true ||
      policy.apiProvider!=='BRAVE_SEARCH' || policy.billingApproved!==true ||
      !Number.isInteger(policy.maxApprovedRequests) ||
      policy.maxApprovedRequests<plan.queries.length ||
      policy.maxApprovedRequests>TENDER_SUPPLIER_SEARCH.maxQueries) {
    report.issue='SEARCH_SUBSCRIPTION_AND_BILLING_APPROVAL_REQUIRED';return report;
  }
  const secret=PropertiesService.getScriptProperties().getProperty(TENDER_SUPPLIER_SEARCH.apiKeyProperty);
  if (typeof secret!=='string' || !/^[\x21-\x7e]{12,256}$/.test(secret) ||
      /[\s]/.test(secret)) {
    report.issue='SEARCH_API_KEY_REQUIRED';return report;
  }
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(1000)){report.issue='SUPPLIER_SEARCH_BUSY';return report;}
  try {
    const budget=pilotBudget_(),seen=new Set();
    for (const p of plan.queries) {
      if (Date.now()-started>=TENDER_SUPPLIER_SEARCH.maxRuntimeMs) throw new Error('TIME_LIMIT');
      const query=TENDER_SUPPLIER_SEARCH.endpoint+'?q='+encodeURIComponent(p.query)+
        '&count='+TENDER_SUPPLIER_SEARCH.perQuery+'&result_filter=web&text_decorations=false';
      budget.claim();report.queriesAttempted++;
      let response;
      try {
        response=UrlFetchApp.fetch(query,{method:'get',followRedirects:false,
          muteHttpExceptions:true,validateHttpsCertificates:true,
          headers:{'Accept':'application/json','X-Subscription-Token':secret}});
      }catch(e){throw new Error('SEARCH_NETWORK_UNAVAILABLE');}
      if(Date.now()-started>=TENDER_SUPPLIER_SEARCH.maxRuntimeMs) throw new Error('LATE_RESULT');
      if (response.getResponseCode()!==200) throw new Error('SEARCH_HTTP_ERROR');
      const headers=response.getAllHeaders(),header=Object.keys(headers).find(function(k){
        return k.toLowerCase()==='content-type';
      });
      if(!header || !/^application\/json(?:\s*;|$)/i.test(String(headers[header]))) {
        throw new Error('SEARCH_CONTENT_TYPE_UNVERIFIED');
      }
      const bytes=response.getContent();
      if(!bytes || !bytes.length || bytes.length>TENDER_SUPPLIER_SEARCH.maxResponseBytes){
        throw new Error('SEARCH_BODY_LIMIT');
      }
      let payload;
      try {payload=JSON.parse(response.getContentText('UTF-8'));}
      catch(e){throw new Error('SEARCH_JSON_INVALID');}
      const found=parseTenderSupplierSearch_(payload,p);
      found.forEach(function(item){
        const key=item.lotId+'|'+item.productUrl;
        if (!seen.has(key)) {seen.add(key);report.items.push(item);}
      });
    }
    return report;
  }catch(e){
    // No partial output, body, query string, token, URLs or upstream errors leaked.
    return {mode:'SUPPLIER_SEARCH_URL_PREVIEW',coverage:'selected_domains_only',
      issue:'SEARCH_API_OR_QUOTA_BLOCKED',observedAt:new Date().toISOString(),
      queriesAttempted:report.queriesAttempted,items:[],supplierOffersVerified:0,
      nationalDecision:'HOLD_NATIONAL',sheetsChanged:false,watermarkAdvanced:false,
      revenueGuaranteed:false};
  }finally{lock.releaseLock();}
}
