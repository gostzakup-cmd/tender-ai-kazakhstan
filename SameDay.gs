/** Bounded, manual closing-day preview. No Sheets, scheduler or watermark writes. */
function shortlistTenderSameDay(rows, selection, policy, observedAt) {
  const report = {mode: 'SAME_DAY_SELECTED_IDS_READ_ONLY', coverage: 'sample_only',
    dailyCoverageVerified: false, date: selection && selection.date, observedAt: observedAt,
    items: [], issue: null, sheetsChanged: false, watermarkAdvanced: false};
  const now = Date.parse(observedAt);
  if (!selection || !Array.isArray(selection.ids) || !selection.ids.length || selection.ids.length > 30 ||
      selection.ids.some(function (id) { return !Number.isInteger(id) || id < 1 || id > 2147483647; }) ||
      new Set(selection.ids).size !== selection.ids.length ||
      !/^\d{4}-\d{2}-\d{2}$/.test(selection.date || '') ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt || '') || !Number.isFinite(now)) {
    report.issue = 'SELECTION_INVALID'; return report;
  }
  report.requestedIds = selection.ids.slice();
  report.returnedCount = Array.isArray(rows) ? rows.length : 0;
  if (!Array.isArray(rows) || rows.length > selection.ids.length || rows.some(function (row) {
    return !row || !selection.ids.includes(row.id);
  })) { report.issue = 'RESPONSE_SCOPE_INVALID'; return report; }
  const seen = new Map();
  rows.forEach(function (row) {
    if (!seen.has(row.id)) seen.set(row.id, row);
    else seen.set(row.id, null); // conflicting or repeated identity never becomes eligible
  });
  let datePolicy = false;
  try {
    datePolicy = !!policy && policy.approved === true && policy.timezoneVerified === true &&
      /^https:\/\//.test(policy.timezoneProofUrl || '') && !!policy.sourceTimezone && !!policy.portalTimezone &&
      Utilities.formatDate(new Date(now), policy.portalTimezone, 'yyyy-MM-dd') === selection.date &&
      policy.repeatSelectionVerified === true;
  } catch (e) { /* Unverified date stays REVIEW_DATE. */ }
  selection.ids.forEach(function (id) {
    const row = seen.get(id);
    const item = {lotId: String(id), observedAt: observedAt, decision: 'REVIEW_DATE',
      nationalDecision: 'HOLD_NATIONAL', commercialDecision: 'REVIEW', reason: 'DATE_POLICY_UNVERIFIED',
      deadline: null, sourceUrl: null};
    report.items.push(item);
    if (!row) { item.reason = seen.has(id) ? 'DUPLICATE_ID' : 'LOT_NOT_RETURNED'; return; }
    const safe = function (value) { return typeof value === 'string' ? value.slice(0, 200) : null; };
    item.lotNumber = safe(row.lotNumber); item.announcementNumber = safe(row.trdBuyNumberAnno);
    item.announcementId = row.trdBuyId; item.amountKzt = row.amount;
    item.plannedMethodId = row.refTradeMethodsId; item.actualMethodId = row.refBuyTradeMethodsId;
    item.status = row.RefLotsStatus && safe(row.RefLotsStatus.code);
    item.deadlineRaw = row.TrdBuy && safe(row.TrdBuy.endDate);
    item.repeatDeadlineRaw = row.TrdBuy && safe(row.TrdBuy.repeatEndDate);
    if (!datePolicy) return;
    const points = row.pointList, plans = row.Plans;
    if (row.isDeleted !== 0 || !Array.isArray(points) || !points.length || points.length > 30 ||
        points.some(function (p) { return !Number.isInteger(p) || p <= 0; }) || new Set(points).size !== points.length ||
        !Array.isArray(plans) || plans.length !== points.length || new Set(plans.map(function (p) { return p && p.id; })).size !== points.length ||
        plans.some(function (p) { return !p || !points.includes(p.id) || p.refSubjectTypeId !== 1; }) ||
        !Number.isFinite(row.amount) || row.amount < 0 || row.amount > 10000000 ||
        !Number.isFinite(row.count) || row.count <= 0 || !item.lotNumber || !item.announcementNumber ||
        !Number.isInteger(row.trdBuyId) || row.trdBuyId <= 0 || !row.TrdBuy || row.TrdBuy.id !== row.trdBuyId) {
      item.decision = 'REVIEW'; item.reason = 'GOODS_OR_IDENTITY_OR_BUDGET_UNVERIFIED'; return;
    }
    item.quantity = row.count; item.planIds = points.map(function (id) { return String(id); });
    const scope = Array.isArray(policy.methodStatuses) && policy.methodStatuses.find(function (s) {
      return s && s.approved === true && s.actualMethodId === row.refBuyTradeMethodsId &&
        Array.isArray(s.codes) && s.codes.includes(item.status);
    });
    if (!scope || !Number.isInteger(row.refTradeMethodsId) || row.refTradeMethodsId <= 0) {
      item.reason = 'METHOD_STATUS_UNVERIFIED'; return;
    }
    try {
      const buy = row.TrdBuy;
      const repeated = !!buy.repeatStartDate || !!buy.repeatEndDate;
      if (repeated && (!buy.repeatStartDate || !buy.repeatEndDate)) throw new Error('repeat');
      const start = apiDate_(repeated ? buy.repeatStartDate : buy.startDate, policy.sourceTimezone, false);
      const end = apiDate_(repeated ? buy.repeatEndDate : buy.endDate, policy.sourceTimezone, false);
      if (Date.parse(start) >= Date.parse(end)) throw new Error('interval');
      item.applicationStart = start; item.deadline = end; item.deadlineTimezone = policy.portalTimezone;
      item.deadlineOrigin = repeated ? 'TrdBuy.repeatEndDate' : 'TrdBuy.endDate';
      const template = policy.lotUrlTemplate;
      if (policy.lotUrlVerified === true && typeof template === 'string' &&
          /^https:\/\/(?:old\.|v3bl\.|www\.)?goszakup\.gov\.kz\/[^?#\s]+$/.test(template) &&
          template.includes('{id}') && !/\{(?!id\}|trdBuyId\})/.test(template)) {
        item.sourceUrl = template.replace(/\{id\}/g, String(id)).replace(/\{trdBuyId\}/g, String(row.trdBuyId));
      }
      if (Utilities.formatDate(new Date(end), policy.portalTimezone, 'yyyy-MM-dd') !== selection.date) {
        item.decision = 'NOT_SAME_DAY'; item.reason = 'EFFECTIVE_DEADLINE_OTHER_DAY';
      } else if (Date.parse(end) <= now) { item.decision = 'EXPIRED'; item.reason = 'DEADLINE_PASSED'; }
      else if (Date.parse(start) > now) { item.reason = 'ACCEPTANCE_NOT_STARTED'; }
      else { item.decision = 'SAME_DAY_CANDIDATE'; item.reason = 'CURRENT_ACCEPTANCE_DEADLINE_TODAY'; }
    } catch (e) { item.reason = 'EFFECTIVE_DEADLINE_UNVERIFIED'; }
  });
  return report;
}

/** Manual owner-selected IDs only. Policy is reviewed caller configuration, not API evidence. */
function inspectTenderSameDay(selection, policy) {
  const started = Date.now(), lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw safeApiError_('SAME_DAY_ALREADY_RUNNING');
  let budget = null;
  try {
    const preflight = shortlistTenderSameDay([], selection, policy, new Date().toISOString());
    if (preflight.issue) return preflight;
    const config = v3Config_();
    if (config.endpoint !== TENDER.v3Endpoint || JSON.stringify(config.fields) !== JSON.stringify(V3_FIELDS)) {
      throw safeApiError_('SAME_DAY_DEFAULT_SOURCE_REQUIRED');
    }
    const shared = pilotBudget_();
    budget = {used: function () { return shared.used(); }, claim: function () {
      if (Date.now() - started >= 30000 || shared.used() >= 4) throw safeApiError_('SAME_DAY_QUOTA_LIMIT');
      shared.claim();
    }};
    config.requestBudget = budget;
    const rows = [], fields = selection_(Object.assign({}, V3_FIELDS, {
      announcementIdentity: 'TrdBuy.id', plannedMethod: 'refTradeMethodsId', actualMethod: 'refBuyTradeMethodsId'
    }));
    for (let i = 0; i < selection.ids.length; i += 10) {
      const ids = selection.ids.slice(i, i + 10);
      const result = graphqlResponse_(config,
        'query SameDay($filter: LotsFiltersInput!, $limit: Int!) { Lots(filter: $filter, limit: $limit) { ' + fields + ' } }',
        {filter: {id: ids}, limit: ids.length});
      if (Date.now() - started >= 30000 || !Array.isArray(result.data.Lots) || result.data.Lots.length > ids.length ||
          result.data.Lots.some(function (row) { return !row || !ids.includes(row.id); })) throw safeApiError_('SAME_DAY_RESPONSE_INVALID');
      rows.push.apply(rows, result.data.Lots);
    }
    const report = shortlistTenderSameDay(rows, selection, policy, new Date().toISOString());
    report.requests = budget.used();
    return nationalSafeReport_(report);
  } catch (e) {
    return {mode: 'SAME_DAY_SELECTED_IDS_READ_ONLY', coverage: 'sample_only', items: [],
      issue: 'SAME_DAY_SOURCE_OR_QUOTA_BLOCKED', requests: budget ? budget.used() : 0,
      observedAt: new Date().toISOString(), dailyCoverageVerified: false, sheetsChanged: false, watermarkAdvanced: false};
  } finally { lock.releaseLock(); }
}
