/**
 * Issue #30 — end-to-end, read-only orchestration and export.
 * No evidence is upgraded here. Search -> exact card follow-up -> reviewed
 * supplier/TS/national/cost engine, in that order of data sensitivity.
 * The existing assessTenderNationalEvidence / acceptTenderOriginalDocument /
 * evaluateTenderResearch functions remain the only commercial decision path.
 */
const TENDER_WORKFLOW = Object.freeze({
  maxLots:30,maxSearchLinks:30,maxCardRequests:5,maxAgeMs:300000
});

function tenderWorkflowTime_(iso) {
  if (typeof iso!=='string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(iso)) return NaN;
  return Date.parse(iso);
}

function tenderWorkflowFresh_(at,now,previous,maxAge) {
  const value=tenderWorkflowTime_(at);
  return Number.isFinite(value) && value>=previous && value<=now && now-value<=maxAge;
}

/**
 * Turn validated search-result URLs into requests for PR #35. No network.
 * Exact lot/market/domain binding, no inferred identity from snippets.
 * National restriction is not bypassed by this research queue: no GO here.
 */
function planTenderProductCardFollowup(shortlist,searchPlan,searchReport,policy,nowIso) {
  const result={mode:'PRODUCT_CARD_FOLLOWUP_PLAN',issue:null,coverage:'search_links_only',
    requests:[],rejected:[],verifiedQuotes:0,nationalDecision:'HOLD_NATIONAL',
    sheetsChanged:false};
  const now=tenderWorkflowTime_(nowIso),observed=shortlist && tenderWorkflowTime_(shortlist.observedAt);
  if (!shortlist || shortlist.issue || shortlist.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY' ||
      shortlist.coverage!=='sample_only' || !Array.isArray(shortlist.items) ||
      shortlist.items.length>30 || !Number.isFinite(now) || !Number.isFinite(observed) ||
      observed>now || now-observed>TENDER_WORKFLOW.maxAgeMs ||
      !searchPlan || searchPlan.issue || searchPlan.mode!=='SUPPLIER_SEARCH_PLAN' ||
      !Array.isArray(searchPlan.queries) || searchPlan.queries.length<1 || searchPlan.queries.length>6 ||
      !searchReport || searchReport.issue || searchReport.mode!=='SUPPLIER_SEARCH_URL_PREVIEW' ||
      searchReport.coverage!=='selected_domains_only' || !Array.isArray(searchReport.items) ||
      searchReport.items.length>TENDER_WORKFLOW.maxSearchLinks ||
      !Number.isInteger(searchReport.queriesAttempted) ||
      searchReport.queriesAttempted!==searchPlan.queries.length ||
      !tenderWorkflowFresh_(searchReport.observedAt,now,observed,TENDER_WORKFLOW.maxAgeMs)) {
    result.issue='CURRENT_SEARCH_REPORT_REQUIRED';return result;
  }
  const lots=new Map(shortlist.items.map(function(x){return [x.lotId,x];}));
  const pairs=new Set(),keys=new Set();
  for(const p of searchPlan.queries) {
    if(!p || !lots.has(p.lotId) ||
        p.domain!==tenderSupplierSearchDomain_(p,policy) ||
        !p.expected || !['brand','model','partNumber'].every(function(k){
          return tenderSupplierSearchTerm_(p.expected[k]);
        })) {result.issue='SEARCH_PLAN_BINDING_UNVERIFIED';break;}
    const lot=lots.get(p.lotId);
    if (!lot || lot.decision!=='SAME_DAY_CANDIDATE' ||
        !(Date.parse(lot.deadline)>now) || !(Date.parse(lot.applicationStart)<=now)) {
      result.issue='SEARCH_LOT_EXPIRED';break;
    }
    const key=p.lotId+'|'+p.provider+'|'+p.origin+'|'+p.domain;
    if(keys.has(key)) {result.issue='SEARCH_PLAN_DUPLICATE';break;}
    keys.add(key);pairs.add(key);
  }
  if(result.issue) return result;
  const seen=new Set();
  for(const link of searchReport.items) {
    const key=link && link.lotId+'|'+link.provider+'|'+link.origin;
    const p=searchPlan.queries.find(function(x){
      return x.lotId===link.lotId && x.provider===link.provider &&
        x.origin===link.origin && productCardHost_(link.productUrl) &&
        (productCardHost_(link.productUrl)===x.domain ||
         productCardHost_(link.productUrl).endsWith('.'+x.domain));
    });
    const safeKey=link && link.lotId+'|'+link.productUrl;
    if(!p || !pairs.has(key+'|'+p.domain) ||
        link.verification!=='PENDING_PRODUCT_CARD' ||
        link.sourceType!=='SEARCH_RESULT_LINK' ||
        !productCardAllowed_({lotId:p.lotId,provider:p.provider,origin:p.origin,url:link.productUrl},policy) ||
        seen.has(safeKey)) {
      result.rejected.push({lotId:link && link.lotId || null,reason:'SEARCH_LINK_UNBOUND_OR_DUPLICATE'});
      continue;
    }
    seen.add(safeKey);
    if (result.requests.length>=TENDER_WORKFLOW.maxCardRequests) {
      result.rejected.push({lotId:link.lotId,reason:'FOLLOWUP_CARD_LIMIT'});
      continue;
    }
    result.requests.push({lotId:p.lotId,provider:p.provider,origin:p.origin,
      url:link.productUrl,expected:{brand:p.expected.brand,
        model:p.expected.model,partNumber:p.expected.partNumber}});
  }
  return result;
}

/**
 * Single presentation/report join. Only analyzeTenderSameDay can assign GO.
 * Raw search/card data are NEVER passed as CONFIRMED quotes, never plugged into
 * tax/cost arithmetic; they are visible only as source-review work items.
 */
function compileTenderWorkflow(shortlist,reviewedInputs,researchPolicy,searchReport,cardReport,nowIso) {
  const report={mode:'TENDER_WORKFLOW_READ_ONLY',issue:null,coverage:'sample_only',
    dailyCoverageVerified:false,observedAt:nowIso,rows:[],counts:{GO:0,REVIEW:0,'NO-GO':0,SKIP:0},
    searchLinks:0,cardObservations:0,conditionalRevenueOnly:true,
    verifiedByLivePilot:false,sheetsChanged:false,watermarkAdvanced:false};
  const now=tenderWorkflowTime_(nowIso),observed=shortlist && tenderWorkflowTime_(shortlist.observedAt);
  if(!shortlist || shortlist.issue || shortlist.mode!=='SAME_DAY_SELECTED_IDS_READ_ONLY' ||
      shortlist.coverage!=='sample_only' || !Array.isArray(shortlist.items) ||
      shortlist.items.length>30 || !Array.isArray(reviewedInputs) || reviewedInputs.length>30 ||
      !Number.isFinite(now) || !Number.isFinite(observed) || observed>now ||
      !researchPolicy || !Number.isFinite(researchPolicy.shortlistMaxAgeMs) ||
      researchPolicy.shortlistMaxAgeMs<=0 || researchPolicy.shortlistMaxAgeMs>300000 ||
      now-observed>researchPolicy.shortlistMaxAgeMs) {
    report.issue='WORKFLOW_CURRENT_INPUT_REQUIRED';return report;
  }
  const ids=new Set();
  for(const item of shortlist.items) {
    if(!item || typeof item.lotId!=='string' || ids.has(item.lotId)) {
      report.issue='WORKFLOW_DUPLICATE_LOT';return report;
    }
    ids.add(item.lotId);
  }
  const research=analyzeTenderSameDay(shortlist,reviewedInputs,researchPolicy,nowIso);
  if(research.issue || !Array.isArray(research.items) || research.items.length!==shortlist.items.length) {
    report.issue='WORKFLOW_RESEARCH_NOT_CURRENT';return report;
  }
  let links=[],cards=[];
  if(searchReport!==null && searchReport!==undefined) {
    if(searchReport.issue || searchReport.mode!=='SUPPLIER_SEARCH_URL_PREVIEW' ||
        searchReport.coverage!=='selected_domains_only' ||
        !Array.isArray(searchReport.items) || searchReport.items.length>30 ||
        !tenderWorkflowFresh_(searchReport.observedAt,now,observed,300000)) {
      report.issue='WORKFLOW_SEARCH_EVIDENCE_UNVERIFIED';return report;
    }
    links=searchReport.items.filter(function(x){
      return x && ids.has(x.lotId) && x.verification==='PENDING_PRODUCT_CARD' &&
        x.sourceType==='SEARCH_RESULT_LINK' && productCardHost_(x.productUrl);
    });
  }
  if(cardReport!==null && cardReport!==undefined) {
    if(cardReport.issue || cardReport.mode!=='PRODUCT_CARD_PROBE_READ_ONLY' ||
        !Array.isArray(cardReport.items) || cardReport.items.length>5 ||
        !tenderWorkflowFresh_(cardReport.observedAt,now,observed,300000)) {
      report.issue='WORKFLOW_CARD_EVIDENCE_UNVERIFIED';return report;
    }
    cards=cardReport.items.filter(function(x){
      return x && ids.has(x.lotId) && typeof x.productUrl==='string' &&
        links.some(function(y){return y.lotId===x.lotId && y.productUrl===x.productUrl;});
    });
  }
  report.searchLinks=links.length;report.cardObservations=cards.length;
  shortlist.items.forEach(function(item,index){
    const r=research.items[index];
    const input=reviewedInputs.find(function(x){return x && x.lot && x.lot.id===item.lotId;});
    const quote=input && input.quotes && input.quotes.find(function(x){
      return r && r.finance && x && x.id===r.finance.quoteId &&
        Array.isArray(r.validQuoteIds) && r.validQuoteIds.includes(x.id);
    });
    const original=r && r.originalTs && r.originalTs.url || null;
    const decision=r && ['GO','NO-GO','SKIP'].includes(r.decision)?r.decision:'REVIEW';
    const confidence=decision==='GO' && r.compliance==='TS_COMPLIANCE_100_PERCENT' &&
      r.nationalDecision==='PASS_TO_TS' && r.finance && quote?'HIGH':
      r && r.compliance==='TS_COMPLIANCE_100_PERCENT'?'MED':'LOW';
    let reason=r && r.reason || 'RESEARCH_NOT_AVAILABLE';
    if(!quote && (decision==='GO' || decision==='NO-GO')) {
      // Don't let a malformed report claim a commercially verified outcome.
      reason='WORKFLOW_VERIFIED_QUOTE_BINDING_REQUIRED';
    }
    const commercial=reason==='WORKFLOW_VERIFIED_QUOTE_BINDING_REQUIRED'?'REVIEW':decision;
    const lotCards=cards.filter(function(x){return x.lotId===item.lotId;});
    const row={tenderNo:item.announcementNumber || null,lotNo:item.lotNumber || null,
      lotId:item.lotId,productName:item.name || null,requiredQty:item.quantity || null,
      lotAmountKzt:item.amountKzt===undefined?null:item.amountKzt,
      foundProduct:quote?quote.brand+' '+quote.model+' '+quote.partNumber:null,
      unitPriceKzt:r && r.finance && item.quantity>0 ? r.finance.partyPurchaseCost/item.quantity:null,
      totalCostKzt:r && r.finance?r.finance.totalLandedCost:null,
      profitKzt:r && r.finance?r.finance.netProfit:null,
      profitPercent:r && r.finance?r.finance.netMarginPercent:null,
      tsCompliancePercent:r && r.compliance==='TS_COMPLIANCE_100_PERCENT'?100:null,
      confidence:commercial==='REVIEW' && confidence==='HIGH'?'LOW':confidence,
      supplier:quote?quote.supplierId:null,lotLink:item.sourceUrl||null,
      sourceLink:quote && quote.priceEvidence?quote.priceEvidence.url:null,
      nationalDecision:r && r.nationalDecision || 'HOLD_NATIONAL',
      decision:commercial,reason:reason,originalTsUrl:original,
      originalTsSha256:r && r.originalTs && r.originalTs.sha256 || null,
      selectedQuoteId:quote?quote.id:null,
      foundSearchLinks:links.filter(function(x){return x.lotId===item.lotId;}).length,
      unreviewedCardObservations:lotCards.length,
      observedUnitPrices:lotCards.filter(function(x){
        return x.status==='UNREVIEWED_PRODUCT_CARD' && x.listedOffer &&
          x.identityMatch==='EXACT_FIELDS';
      }).map(function(x){return {url:x.productUrl,unitPrice:x.listedOffer.unitPrice,
        currency:x.listedOffer.currency,verification:'UNREVIEWED'};})};
    report.rows.push(row);report.counts[commercial]++;
  });
  const priority={HIGH:0,MED:1,LOW:2};
  report.rows.sort(function(a,b){
    return priority[a.confidence]-priority[b.confidence] ||
      (a.decision==='GO'?-1:0)-(b.decision==='GO'?-1:0) ||
      String(a.lotId).localeCompare(String(b.lotId));
  });
  return report;
}

/** CSV is a preview string only: no SpreadsheetApp, Drive or file modification. */
function exportTenderWorkflowCsv(report) {
  if(!report || report.issue || report.mode!=='TENDER_WORKFLOW_READ_ONLY' ||
      !Array.isArray(report.rows) || report.rows.length>30) return null;
  const fields=['tenderNo','lotNo','productName','requiredQty','lotAmountKzt',
    'foundProduct','unitPriceKzt','totalCostKzt','profitKzt','profitPercent',
    'tsCompliancePercent','confidence','supplier','lotLink','sourceLink',
    'nationalDecision','decision','reason','originalTsUrl','lotId'];
  const esc=function(v) {
    let s=String(v===null || v===undefined?'':v).replace(/[\r\n\t]/g,' ').slice(0,1600);
    // Prevent Excel, Google Sheets & LibreOffice formula injection (incl. leading spaces).
    if (/^\s*[=+\-@\u0000-\u001f]/.test(s)) s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  return [fields.map(esc).join(',')].concat(report.rows.map(function(row){
    return fields.map(function(k){return esc(row[k]);}).join(',');
  })).join('\r\n');
}

/** One owner-authorized, bounded official read + offline review. No paid supplier
 * search is invoked, and no Sheets, triggers, Apps Script publication or bids.
 */
function inspectTenderIntegratedOnce(reviewedInputs,policy) {
  const out={mode:'TENDER_WORKFLOW_READ_ONLY',coverage:'sample_only',rows:[],
    issue:'WORKFLOW_OWNER_APPROVAL_REQUIRED',sheetsChanged:false};
  if(!policy || policy.approved!==true || policy.allowOfficialDiscovery!==true ||
      !policy.closingDay || !policy.research || !Array.isArray(reviewedInputs) ||
      reviewedInputs.length>30) return out;
  try {
    const shortlist=inspectTenderClosingDayDiscovery(policy.closingDay);
    if(shortlist.issue) {out.issue='WORKFLOW_OFFICIAL_DISCOVERY_BLOCKED';return out;}
    return compileTenderWorkflow(shortlist,reviewedInputs,policy.research,null,null,new Date().toISOString());
  } catch(e) {out.issue='WORKFLOW_OFFICIAL_DISCOVERY_BLOCKED';return out;}
}
