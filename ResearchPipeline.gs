/** Pure offline evaluation of reviewed evidence. No search, AI or Google writes.
 * CONFIRMED inputs must be supplied by trusted source-review adapters, not AI
 * assertions. GO is conditional on a planned bid, never guaranteed revenue. */
const TENDER_COST_ITEMS = Object.freeze(['DELIVERY','CUSTOMS','IMPORT_VAT','NONRECOVERABLE_VAT',
  'OUTPUT_VAT_NET','BID_SECURITY_COST','PERFORMANCE_SECURITY_COST','CERTIFICATION','PLATFORM_FEES','BANK_FEES','FINANCING','INSURANCE','PACKAGING','CONTINGENCY','OTHER']);
function evaluateTenderResearch(input, policy, nowIso) {
  const result = {schemaVersion: 1, decision: 'REVIEW', researchAllowed: false,
    nationalDecision: 'HOLD_NATIONAL', compliance: 'UNVERIFIED', reasons: [],
    validQuoteIds: [], unconfirmedQuotes: [], missingCosts: [], finance: null, revenueGuaranteed: false};
  if (!input || typeof input !== 'object' || input.schemaVersion !== 1) { result.reasons.push('INPUT_REQUIRED'); return result; }
  const gate = assessTenderNationalEvidence(input.lot, input.nationalProof, policy && policy.national, nowIso);
  result.nationalDecision = gate.decision;
  if (!gate.allowedResearch || input.researchAuthorized !== true) {
    result.reasons.push(gate.allowedResearch ? 'OWNER_AUTHORIZATION_REQUIRED' : 'NATIONAL_GATE_BLOCKED'); return result;
  }
  result.researchAllowed = true;
  const now = Date.parse(nowIso), text = function (v) { return typeof v === 'string' && !!v.trim(); };
  const fresh = function (proof) {
    if (!proof || proof.status !== 'CONFIRMED' || !/^https:\/\//.test(proof.url || '') ||
        !/^[a-f0-9]{64}$/.test(proof.sha256 || '') || !text(proof.locator) ||
        !policy || !Number.isFinite(policy.maxEvidenceAgeMs) || policy.maxEvidenceAgeMs <= 0) return false;
    if (typeof proof.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(proof.observedAt)) return false;
    const stamp = Date.parse(proof.observedAt);
    return Number.isFinite(stamp) && stamp <= now && now - stamp <= policy.maxEvidenceAgeMs;
  };
  const cents = function (n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 ||
        !Number.isSafeInteger(Math.round(n * 100)) || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) return null;
    return Math.round(n * 100);
  };
  if (!text(input.lot.unit)) { result.reasons.push('LOT_UNIT_UNVERIFIED'); return result; }
  const ts = input.ts, candidate = input.candidate;
  if (!ts || ts.origin !== 'ORIGINAL_PROCUREMENT_DOCUMENT' || ts.fullDocumentReviewed !== true ||
      ts.currentVersionVerified !== true || !text(ts.version) || ts.lotId !== input.lot.id ||
      ts.announcementId !== input.lot.announcementId || !fresh(ts.evidence) ||
      !Array.isArray(ts.criteria) || !ts.criteria.length || ts.criteria.length > 200 ||
      new Set(ts.criteria.map(function (c) { return c && c.id; })).size !== ts.criteria.length ||
      Array.from(ts.criteria).some(function (c) { return !c || !text(c.id) || !text(c.requirement) ||
        typeof c.critical !== 'boolean' || !fresh(c.evidence) || c.evidence.sha256 !== ts.evidence.sha256; })) {
    result.reasons.push('FULL_TS_OR_CRITERIA_UNVERIFIED'); return result;
  }
  if (!candidate || !['brand','model','partNumber'].every(function (k) { return text(candidate[k]); }) ||
      !fresh(candidate.identityEvidence) || !Array.isArray(candidate.assessment) ||
      candidate.assessment.length !== ts.criteria.length ||
      new Set(candidate.assessment.map(function (a) { return a && a.criterionId; })).size !== ts.criteria.length) {
    result.reasons.push('EXACT_CANDIDATE_OR_ASSESSMENT_REQUIRED'); return result;
  }
  let fail = false, unknown = false;
  ts.criteria.forEach(function (criterion) {
    const a = candidate.assessment.find(function (item) { return item && item.criterionId === criterion.id; });
    if (!a || a.requirement !== criterion.requirement || a.tsSha256 !== ts.evidence.sha256 ||
        a.candidateIdentitySha256 !== candidate.identityEvidence.sha256 || !fresh(a.evidence) || !['MATCH','FAIL','UNKNOWN'].includes(a.result)) unknown = true;
    else if (a.result === 'FAIL') fail = true;
    else if (a.result !== 'MATCH') unknown = true;
  });
  if (fail) { result.decision = 'NO-GO'; result.compliance = 'NONCOMPLIANT'; result.reasons.push('TS_REQUIREMENT_FAILED'); return result; }
  if (unknown) { result.reasons.push('TS_REQUIREMENT_UNVERIFIED'); return result; }
  result.compliance = 'TS_COMPLIANCE_100_PERCENT';
  const quotes = Array.isArray(input.quotes) ? input.quotes : [], seenIds = new Set(), groups = new Set(), valid = [];
  if (quotes.length > 30) { result.reasons.push('QUOTE_LIMIT'); return result; }
  quotes.forEach(function (q) {
    const issues = [];
    if (!q || !text(q.id) || seenIds.has(q.id)) issues.push('QUOTE_ID_INVALID_OR_DUPLICATE');
    if (q && text(q.id)) seenIds.add(q.id);
    if (!q || !text(q.supplierId) || !text(q.independenceGroup) || !fresh(q.identityEvidence)) issues.push('SUPPLIER_IDENTITY_UNVERIFIED');
    if (!q || !['SUPPLIER_OFFER','OFFICIAL_CATALOG'].includes(q.sourceKind) || !fresh(q.priceEvidence) ||
        !Number.isFinite(Date.parse(q.validUntil)) || Date.parse(q.validUntil) <= now || Date.parse(q.validUntil) < Date.parse(input.lot.deadline)) issues.push('PRICE_UNCONFIRMED_OR_EXPIRED');
    if (!q || ['brand','model','partNumber'].some(function (k) { return q[k] !== candidate[k]; }) || q.unit !== input.lot.unit) issues.push('QUOTE_PRODUCT_OR_UNIT_MISMATCH');
    if (!q || q.stock !== 'IN_STOCK' || q.stockContradicted !== false ||
        !Number.isFinite(q.availableQuantity) || q.availableQuantity < input.lot.quantity || !fresh(q.stockEvidence)) issues.push('STOCK_UNVERIFIED');
    if (!q || !Number.isFinite(q.leadTimeDays) || q.leadTimeDays < 0 || q.deliveryCompatible !== true || !fresh(q.deliveryEvidence)) issues.push('DELIVERY_UNVERIFIED');
    let unitCost = q && cents(q.unitPrice), rate = 1;
    if (q && q.currency !== 'KZT') {
      if (!/^[A-Z]{3}$/.test(q.currency || '') || !q.fx || !Number.isFinite(q.fx.rateKztPerUnit) || q.fx.rateKztPerUnit <= 0 || !fresh(q.fx.evidence) || q.fx.spreadReviewed !== true) issues.push('FX_UNVERIFIED');
      else rate = q.fx.rateKztPerUnit;
    }
    if (unitCost === null || unitCost <= 0) issues.push('UNIT_PRICE_INVALID');
    if (issues.length) { result.unconfirmedQuotes.push({id: q && q.id || null, issues: issues}); return; }
    const partyCost = Math.ceil(unitCost * rate * input.lot.quantity);
    if (!Number.isSafeInteger(partyCost)) { result.unconfirmedQuotes.push({id:q.id,issues:['COST_OVERFLOW']}); return; }
    valid.push({id:q.id,group:q.independenceGroup,partyCost:partyCost});groups.add(q.independenceGroup);
  });
  // Duplicate IDs invalidate the entire collection, including an earlier duplicate.
  if (quotes.some(function (q, i) { return q && quotes.slice(0,i).some(function (p) { return p && p.id === q.id; }); })) {
    result.reasons.push('DUPLICATE_QUOTE_ID'); return result;
  }
  const supplierGroups = new Map();
  if (quotes.some(function (q) {
    if (!q || !valid.some(function (v) { return v.id === q.id; })) return false;
    if (supplierGroups.has(q.supplierId) && supplierGroups.get(q.supplierId) !== q.independenceGroup) return true;
    supplierGroups.set(q.supplierId,q.independenceGroup); return false;
  })) { result.reasons.push('SUPPLIER_INDEPENDENCE_CONFLICT'); return result; }
  result.validQuoteIds = valid.map(function (q) { return q.id; });
  if (groups.size < 3 || new Set(quotes.filter(function(q){return q && valid.some(function(v){return v.id===q.id;});}).map(function(q){return q.supplierId;})).size < 3) {
    result.reasons.push('THREE_INDEPENDENT_QUOTES_REQUIRED'); return result;
  }
  const selected = valid.find(function (q) { return q.id === input.selectedQuoteId; });
  if (!selected) { result.reasons.push('SELECTED_QUOTE_REQUIRED'); return result; }
  const costs = Array.isArray(input.costs) ? input.costs : [], required = TENDER_COST_ITEMS;
  if (costs.length !== required.length || new Set(costs.map(function (c) { return c && c.kind; })).size !== required.length) result.reasons.push('COST_INVENTORY_INVALID');
  let extras = 0;
  required.forEach(function (kind) {
    const c = costs.find(function (item) { return item && item.kind === kind; });
    const value = c && cents(c.amountKzt);
    if (!c || c.quoteId !== selected.id || c.currency !== 'KZT' || value === null || !fresh(c.evidence)) result.missingCosts.push(kind);
    else extras += value;
  });
  const bid = input.bid, revenue = bid && cents(bid.totalKzt), tax = input.profitTax;
  if (!bid || bid.basis !== 'PLANNED_OFFER' || revenue === null || revenue <= 0 ||
      revenue > cents(input.lot.amountKzt) || !fresh(bid.evidence)) result.reasons.push('PLANNED_BID_UNVERIFIED_OR_OVER_BUDGET');
  if (!tax || tax.model !== 'PROPORTIONAL' || !['PROFIT','REVENUE'].includes(tax.basis) || !Number.isFinite(tax.rate) || tax.rate < 0 || tax.rate > 1 || !fresh(tax.evidence)) result.reasons.push('PROFIT_TAX_UNVERIFIED');
  if (!input.taxTreatment || input.taxTreatment.reviewed !== true || !fresh(input.taxTreatment.evidence)) result.reasons.push('TAX_TREATMENT_UNVERIFIED');
  ['competition','legal'].forEach(function (k) { if (!input[k] || input[k].result !== 'ACCEPTABLE' || !fresh(input[k].evidence)) result.reasons.push(k.toUpperCase()+'_UNVERIFIED'); });
  if (result.missingCosts.length || result.reasons.length) return result;
  valid.sort(function (a,b) { return a.partyCost-b.partyCost || a.id.localeCompare(b.id); });
  const purchase = selected.partyCost, beforeTaxCost = purchase + extras, preTaxProfit = revenue - beforeTaxCost;
  const incomeTax = function (amount) { return Math.ceil((tax.basis === 'REVENUE' ? amount : Math.max(0,amount-beforeTaxCost))*tax.rate); };
  const profitTax = incomeTax(revenue), total = beforeTaxCost+profitTax, net = revenue-total;
  if (![purchase,extras,total,net,revenue].every(Number.isSafeInteger)) { result.reasons.push('MONEY_OVERFLOW'); return result; }
  const threshold = function (margin) {
    if (margin === 0 && tax.basis === 'PROFIT') return beforeTaxCost/100;
    const factor = 1-margin-tax.rate;
    if (factor <= 0) return null;
    let low = beforeTaxCost, high = Math.ceil(beforeTaxCost*(tax.basis === 'PROFIT' ? 1-tax.rate : 1)/factor) + Math.ceil(1/factor);
    const feasible = function (amount) { const netAt = amount-beforeTaxCost-incomeTax(amount); return margin === 0 ? netAt >= 0 : netAt*5 >= amount; };
    if (!Number.isSafeInteger(high) || high > Number.MAX_SAFE_INTEGER/5 || !feasible(high)) return null;
    while (low < high) { const mid = low+Math.floor((high-low)/2); if (feasible(mid)) high=mid; else low=mid+1; }
    return low/100;
  };
  result.finance = {quoteId:selected.id,currency:'KZT',partyPurchaseCost:purchase/100,
    additionalCost:extras/100,profitTax:profitTax/100,totalLandedCost:total/100,
    plannedBid:revenue/100,netProfit:net/100,netMarginPercent:net/revenue*100,
    markupPercent:total>0?net/total*100:null,breakEvenBid:threshold(0),
    minimumBidFor20Percent:threshold(0.2)};
  result.decision = net*5 >= revenue ? 'GO' : 'NO-GO';
  result.reasons.push(result.decision==='GO'?'VERIFIED_INPUTS_PLANNED_SCENARIO':'NET_MARGIN_BELOW_20_PERCENT');
  return result;
}
