/**
 * Bounded, read-only auto-discovery of CLOSING-DAY sample candidates (#30).
 * No bid, sheet, sync, watermark, scheduler, paid service or national inference.
 * Four one-page official OWS V3 change/publication samples, plus bounded Lots lookup.
 * A source window is NOT the acceptance-deadline window; only the existing
 * shortlistTenderSameDay gate decides whether the current deadline is today.
 */
const CLOSING_DISCOVERY = Object.freeze({
  pageSize: 10, maxAttempts: 10, maxRuntimeMs: 30000,
  maxAnnouncementIds: 20, maxLotIds: 30, windowMs: 3600000
});

function closingDiscoveryDatePolicy_(policy, config, at) {
  if (!policy || policy.approved !== true || policy.timezoneVerified !== true ||
      policy.repeatSelectionVerified !== true || !/^https:\/\//.test(policy.timezoneProofUrl || '') ||
      !policy.portalTimezone || !policy.sourceTimezone ||
      policy.sourceTimezone !== config.dateTimezone) {
    throw safeApiError_('DISCOVERY_DATE_POLICY_UNVERIFIED');
  }
  let date, from, to;
  try {
    date = Utilities.formatDate(new Date(at), policy.portalTimezone, 'yyyy-MM-dd');
    from = Utilities.formatDate(new Date(at - CLOSING_DISCOVERY.windowMs), policy.sourceTimezone, 'yyyy-MM-dd HH:mm:ss');
    to = Utilities.formatDate(new Date(at), policy.sourceTimezone, 'yyyy-MM-dd HH:mm:ss');
    if (Utilities.formatDate(new Date(at), policy.portalTimezone, 'yyyy-MM-dd') !== date ||
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(to)) throw new Error('date');
  } catch (e) { throw safeApiError_('DISCOVERY_TIMEZONE_INVALID'); }
  return {date: date, from: from, to: to};
}

/** One bounded page. PageInfo is checked; hasNextPage=true means partial, NOT complete. */
function closingDiscoveryPage_(config, root, filter, fields) {
  if (!['Lots', 'TrdBuy'].includes(root)) throw safeApiError_('DISCOVERY_ROOT_INVALID');
  const query = 'query ClosingDiscovery($filter: ' + root + 'FiltersInput!, $limit: Int!) { ' +
    root + '(filter: $filter, limit: $limit) { ' + fields + ' } }';
  const response = graphqlResponse_(config, query, {filter: filter, limit: CLOSING_DISCOVERY.pageSize});
  const info = response.extensions && response.extensions.pageInfo;
  let rows = response.data[root];
  if (!info || typeof info !== 'object' || Array.isArray(info) ||
      info.limitPage !== CLOSING_DISCOVERY.pageSize || typeof info.hasNextPage !== 'boolean' ||
      !Number.isSafeInteger(info.totalCount) || info.totalCount < 0 ||
      !Number.isSafeInteger(info.lastId) || info.lastId < 0) {
    throw safeApiError_('DISCOVERY_PAGE_INFO_UNVERIFIED');
  }
  // Real OWS can use an explicit null only for an EXACT empty Lots result.
  if (root === 'Lots' && rows === null && info.totalCount === 0 &&
      info.hasNextPage === false && info.lastId === 0) rows = [];
  if (!Array.isArray(rows) || rows.length > CLOSING_DISCOVERY.pageSize ||
      rows.length > info.totalCount || (!info.hasNextPage && rows.length !== info.totalCount) ||
      (info.hasNextPage && rows.length === 0)) {
    throw safeApiError_('DISCOVERY_PAGE_UNVERIFIED');
  }
  let direction = 0, prior = null;
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || row.id > 2147483647) {
      throw safeApiError_('DISCOVERY_ROW_ID_INVALID');
    }
    if (prior !== null) {
      const step = Math.sign(row.id - prior);
      if (!step || (direction && step !== direction)) throw safeApiError_('DISCOVERY_PAGE_ORDER_INVALID');
      direction = step;
    }
    prior = row.id;
  }
  if (info.hasNextPage && (info.lastId !== prior || rows.length === 0)) {
    throw safeApiError_('DISCOVERY_CURSOR_UNVERIFIED');
  }
  return {rows: rows, hasMore: info.hasNextPage, totalReported: info.totalCount};
}

function closingDiscoveryInWindow_(raw, timezone, low, high) {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    const time = Date.parse(apiDate_(raw, timezone, false));
    return Number.isFinite(time) && time >= low && time <= high;
  } catch (e) { return false; }
}

/**
 * Pure processing of bounded source batches, reusable with offline fixtures.
 * All returned IDs are genuine source IDs; conflicting observations are quarantined.
 * Retains existing shortlist mode so analyzeTenderSameDay can consume this report.
 */
function assembleTenderClosingDiscovery(source, day, policy, observedAt) {
  const report = {mode:'SAME_DAY_SELECTED_IDS_READ_ONLY', discoveryMode:'OWS_V3_BOUNDED_AUTO',
    coverage:'sample_only', dailyCoverageVerified:false, sourceWindow: day && {from:day.from,to:day.to},
    date:day && day.date, observedAt:observedAt, items:[], streams:[],
    issue:null, sheetsChanged:false, watermarkAdvanced:false};
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day.date || '') ||
      !source || !Array.isArray(source.streams) || source.streams.length !== 5 ||
      !Number.isFinite(Date.parse(observedAt)) || !Array.isArray(source.lots)) {
    report.issue = 'DISCOVERY_SOURCE_INVALID'; return report;
  }
  const lots = new Map(), disputed = new Set(), scope = new Set();
  source.streams.forEach(function (s) {
    if (!s || typeof s.name !== 'string' || !Number.isInteger(s.returned) ||
        typeof s.hasMore !== 'boolean' || !Number.isSafeInteger(s.totalReported)) {
      report.issue = 'DISCOVERY_SOURCE_INVALID'; return;
    }
    report.streams.push({name:s.name, returned:s.returned, totalReported:s.totalReported,
      hasMore:s.hasMore, completePage:s.hasMore === false});
  });
  if (report.issue) return report;
  for (const row of source.lots) {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || row.id > 2147483647) {
      report.issue = 'DISCOVERY_SOURCE_INVALID'; return report;
    }
    scope.add(row.id);
    if (lots.has(row.id)) {
      if (JSON.stringify(lots.get(row.id)) !== JSON.stringify(row)) disputed.add(row.id);
    } else lots.set(row.id, row);
  }
  const ids = Array.from(scope).sort(function (a,b) {return b-a;}).slice(0, CLOSING_DISCOVERY.maxLotIds);
  report.discoveredUniqueLots = scope.size;
  report.lotCapReached = scope.size > ids.length;
  report.requests = source.requests;
  report.sourceScope = 'recent_change_and_publication_window_only';
  if (!ids.length) {report.issue=null;return report;}
  const shortlist = shortlistTenderSameDay(ids.map(function(id){return lots.get(id);}),
    {date:day.date,ids:ids},policy,observedAt);
  if (shortlist.issue) {report.issue = 'DISCOVERY_SHORTLIST_INVALID';return report;}
  report.items = shortlist.items;
  report.items.forEach(function(item) {
    if (disputed.has(Number(item.lotId))) {
      item.decision = 'REVIEW'; item.nationalDecision = 'HOLD_NATIONAL';
      item.commercialDecision = 'REVIEW'; item.reason = 'SOURCE_CHANGED_DURING_SAMPLE';
    }
  });
  return report;
}

/**
 * Authorized owner may call this manually after separate Apps Script deployment
 * approval. This does NOT start a job/trigger and does NOT write owner Sheets.
 * Policy must be separately verified. Shared rolling 24h quota is still charged.
 */
function inspectTenderClosingDayDiscovery(policy) {
  const started = Date.now(), lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw safeApiError_('DISCOVERY_ALREADY_RUNNING');
  let used = 0;
  try {
    const config = v3Config_();
    if (config.endpoint !== TENDER.v3Endpoint ||
        JSON.stringify(config.fields) !== JSON.stringify(V3_FIELDS)) {
      throw safeApiError_('DISCOVERY_DEFAULT_SOURCE_REQUIRED');
    }
    const day = closingDiscoveryDatePolicy_(policy, config, started);
    const shared = pilotBudget_();
    config.requestBudget = {used:function(){return used;}, claim:function(){
      if (Date.now() - started >= CLOSING_DISCOVERY.maxRuntimeMs ||
          used >= CLOSING_DISCOVERY.maxAttempts) throw safeApiError_('DISCOVERY_QUOTA_OR_TIME_LIMIT');
      shared.claim(); used++;
    }};
    const lotFields = selection_(Object.assign({},V3_FIELDS,{
      plannedMethod:'refTradeMethodsId',actualMethod:'refBuyTradeMethodsId',
      announcementIdentity:'TrdBuy.id', lotUpdated:'lastUpdateDate', lotIndexed:'indexDate'
    }));
    const buyFields = 'id refSubjectTypeId publishDate lastUpdateDate';
    const streams = [], lots = [], announcementIds = new Set();
    const windowFilter = [day.from,day.to], low = Date.parse(apiDate_(day.from,policy.sourceTimezone,false));
    const high = Date.parse(apiDate_(day.to,policy.sourceTimezone,false));
    if (!Number.isFinite(low) || !Number.isFinite(high) ||
        high <= low || high - low > CLOSING_DISCOVERY.windowMs + 1000) {
      throw safeApiError_('DISCOVERY_WINDOW_INVALID');
    }
    const configs = [
      {root:'TrdBuy', name:'TrdBuy.publishDate', field:'publishDate'},
      {root:'TrdBuy', name:'TrdBuy.lastUpdateDate', field:'lastUpdateDate'},
      {root:'Lots', name:'Lots.lastUpdateDate', field:'lastUpdateDate'},
      {root:'Lots', name:'Lots.indexDate', field:'indexDate'}
    ];
    configs.forEach(function(s){
      const filter = {}; filter[s.field] = windowFilter;
      if (s.root === 'TrdBuy') filter.refSubjectTypeId = 1;
      const page = closingDiscoveryPage_(config,s.root,filter,
        s.root === 'Lots' ? lotFields : buyFields);
      if (Date.now() - started >= CLOSING_DISCOVERY.maxRuntimeMs) {
        throw safeApiError_('DISCOVERY_LATE_RESPONSE');
      }
      if (page.rows.some(function(row){
        return !closingDiscoveryInWindow_(row[s.field],policy.sourceTimezone,low,high) ||
          (s.root === 'TrdBuy' && row.refSubjectTypeId !== 1);
      })) throw safeApiError_('DISCOVERY_FILTER_NOT_VERIFIED');
      streams.push({name:s.name,returned:page.rows.length,
        totalReported:page.totalReported,hasMore:page.hasMore});
      if (s.root === 'Lots') lots.push.apply(lots,page.rows);
      else page.rows.forEach(function(row){announcementIds.add(row.id);});
    });
    const ids = Array.from(announcementIds).sort(function(a,b){return b-a;})
      .slice(0,CLOSING_DISCOVERY.maxAnnouncementIds);
    const groups = [];
    for (let i=0; i<ids.length; i+=10) groups.push(ids.slice(i,i+10));
    let childrenMore = false, childrenTotal = 0;
    groups.forEach(function(group){
      const page = closingDiscoveryPage_(config,'Lots',{trdBuyId:group},lotFields);
      if (Date.now() - started >= CLOSING_DISCOVERY.maxRuntimeMs) {
        throw safeApiError_('DISCOVERY_LATE_RESPONSE');
      }
      if (page.rows.some(function(row){return !group.includes(row.trdBuyId);})) {
        throw safeApiError_('DISCOVERY_CHILD_SCOPE_INVALID');
      }
      childrenMore = childrenMore || page.hasMore;
      childrenTotal += page.totalReported;
      lots.push.apply(lots,page.rows);
    });
    streams.push({name:'Lots.byTrdBuyId',returned:lots.length -
      streams.filter(function(s){return s.name.startsWith('Lots.');})
        .reduce(function(n,s){return n+s.returned;},0),
      totalReported:childrenTotal,hasMore:childrenMore});
    if (Date.now() - started >= CLOSING_DISCOVERY.maxRuntimeMs ||
        Utilities.formatDate(new Date(),policy.portalTimezone,'yyyy-MM-dd') !== day.date) {
      throw safeApiError_('DISCOVERY_DAY_CHANGED_OR_LATE');
    }
    const report = assembleTenderClosingDiscovery({streams:streams,lots:lots,requests:used},
      day,policy,new Date().toISOString());
    report.attempts = used;
    report.announcementIdsSampled = ids.length;
    report.announcementIdsTruncated = announcementIds.size > ids.length;
    return nationalSafeReport_(report);
  } catch (e) {
    return {mode:'SAME_DAY_SELECTED_IDS_READ_ONLY',discoveryMode:'OWS_V3_BOUNDED_AUTO',
      coverage:'sample_only',dailyCoverageVerified:false,items:[],
      issue:'DISCOVERY_SOURCE_OR_POLICY_BLOCKED',attempts:used,
      observedAt:new Date().toISOString(),sheetsChanged:false,watermarkAdvanced:false};
  } finally {lock.releaseLock();}
}
