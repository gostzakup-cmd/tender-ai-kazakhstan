/** Manual bounded experiment. Never writes ALL_LOTS or promotes a daily watermark. */
const TENDER_PILOT = Object.freeze({
  pageSize: 20, maxRequests: 40, maxDailyRequests: 200, maxLots: 200,
  maxRuntimeMs: 120000, maxWindowMs: 3600000, maxRows: 2000, maxPlanIds: 100,
  headers: {
    PILOT_LOTS: ['LOT_ID', 'HASH', 'STATUS', 'CLASSIFICATION', 'PLANNED_METHOD_ID',
      'ACTUAL_METHOD_ID', 'PUBLISHED_RAW', 'NORMALIZED_JSON', 'FIRST_OBSERVED', 'LAST_OBSERVED', 'REVISION'],
    PILOT_EVENTS: ['EVENT_KEY', 'LOT_ID', 'EVENT', 'PREVIOUS_STATUS', 'STATUS', 'CLASSIFICATION', 'OBSERVED_AT'],
    PILOT_QUARANTINE: ['LOT_ID', 'REASON', 'OBSERVED_AT'],
    PILOT_RUNS: ['AT', 'REPORT_JSON']
  }
});

function pilotWindow_(config) {
  let window;
  try { window = JSON.parse(PropertiesService.getScriptProperties().getProperty('TENDER_PILOT_WINDOW')); }
  catch (e) { throw safeApiError_('PILOT_WINDOW_REQUIRED'); }
  if (!window || Object.keys(window).sort().join(',') !== 'from,to' ||
      ![window.from, window.to].every(function (s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s); })) {
    throw safeApiError_('PILOT_WINDOW_REQUIRED: JSON с from/to в подтверждённой зоне API.');
  }
  window.start = Date.parse(apiDate_(window.from, config.dateTimezone, false));
  window.end = Date.parse(apiDate_(window.to, config.dateTimezone, false));
  if (window.start >= window.end || window.end - window.start > TENDER_PILOT.maxWindowMs || window.end > Date.now()) {
    throw safeApiError_('PILOT_WINDOW_INVALID: прошедший интервал не более одного часа.');
  }
  return window;
}

/** Call under the script lock. Rolling 24h attempt ledger; retries consume quota too. */
function pilotBudget_() {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  let count = 0;
  return {
    used: function () { return count; },
    claim: function () {
      if (Date.now() - started >= TENDER_PILOT.maxRuntimeMs) throw safeApiError_('PILOT_TIME_LIMIT');
      if (count >= TENDER_PILOT.maxRequests) throw safeApiError_('PILOT_REQUEST_LIMIT');
      let ledger;
      try { ledger = JSON.parse(props.getProperty('TENDER_PILOT_QUOTA') || '[]'); }
      catch (e) { throw safeApiError_('PILOT_QUOTA_STATE_INVALID'); }
      if (!Array.isArray(ledger) || ledger.length > TENDER_PILOT.maxDailyRequests ||
          ledger.some(function (n) { return !Number.isSafeInteger(n) || n < 0 || n > Date.now(); })) {
        throw safeApiError_('PILOT_QUOTA_STATE_INVALID');
      }
      ledger = ledger.filter(function (n) { return n > Date.now() - 86400000; });
      if (ledger.length >= TENDER_PILOT.maxDailyRequests) throw safeApiError_('PILOT_DAILY_LIMIT');
      ledger.push(Date.now());
      props.setProperty('TENDER_PILOT_QUOTA', JSON.stringify(ledger));
      count += 1;
    }
  };
}

/** Filtered pageInfo contract must be demonstrated independently of the unfiltered probe. */
function pilotScan_(config, root, filter, fields, consume, report) {
  const query = 'query TenderPilot($filter: ' + root + 'FiltersInput!, $limit: Int!, $after: Int) { ' +
    root + '(filter: $filter, limit: $limit, after: $after) { ' + fields + ' } }';
  let after = null, direction = 0, total = null, seen = 0, expectTerminalNull = false;
  report.complete = false; report.pages = 0; report.items = 0;
  // Only structural pagination evidence (no raw responses or tokens); max 40 pages/run.
  report.pageTrace = [];
  while (true) {
    const response = graphqlResponse_(config, query, {filter: filter, limit: TENDER_PILOT.pageSize, after: after});
    const rows = response.data[root], info = response.extensions && response.extensions.pageInfo;
    // Real filtered Lots.indexDate in the owner's one-minute window returned
    // explicitly null for zero results (not an empty array). Accept only
    // the first-page, exact zero-result terminal metadata for this stream.
    // Other Lots filters and TrdBuy keep their existing strict behavior.
    if (root === 'Lots' && Object.keys(filter).length === 1 &&
        Object.prototype.hasOwnProperty.call(filter, 'indexDate') &&
        Array.isArray(filter.indexDate) && filter.indexDate.length === 2 &&
        after === null && seen === 0 && total === null &&
        Object.prototype.hasOwnProperty.call(response.data, 'Lots') &&
        rows === null && info && typeof info === 'object' && !Array.isArray(info) &&
        info.limitPage === TENDER_PILOT.pageSize &&
        info.totalCount === 0 && info.hasNextPage === false && info.lastId === 0) {
      report.pages = 1;
      report.items = 0;
      report.reportedTotal = 0;
      report.pageTrace.push({after: null, returned: 0, firstId: null,
        lastRowId: null, pageInfoLastId: 0, hasNextPage: false,
        cumulativeItems: 0, totalCount: 0, emptyNull: true});
      report.emptyNullConfirmed = true;
      report.complete = true;
      return;
    }
    // Observed on real OWS Lots pages: exactly totalCount rows can still have
    // hasNextPage=true; an additional page returns data.Lots=null and lastId=0.
    // Only a strictly matching terminal marker after the exact counted rows
    // is accepted. Missing fields, malformed metadata and extra rows fail closed.
    if (expectTerminalNull) {
      if (root !== 'Lots' || !Object.prototype.hasOwnProperty.call(response.data, root) ||
          rows !== null || !info || typeof info !== 'object' || Array.isArray(info) ||
          info.limitPage !== TENDER_PILOT.pageSize || info.hasNextPage !== false ||
          info.totalCount !== total || info.lastId !== 0 || seen !== total || total <= 0) {
        throw safeApiError_('PILOT_TERMINAL_PAGE_UNVERIFIED');
      }
      report.pages += 1;
      report.pageTrace.push({after: after, returned: 0, firstId: null, lastRowId: null,
        pageInfoLastId: 0, hasNextPage: false, cumulativeItems: seen,
        totalCount: total, terminalNull: true});
      report.terminalNullConfirmed = true;
      report.complete = true;
      return;
    }
    if (!Array.isArray(rows) || rows.length > TENDER_PILOT.pageSize || !info ||
        info.limitPage !== TENDER_PILOT.pageSize || typeof info.hasNextPage !== 'boolean' ||
        !Number.isInteger(info.totalCount) || info.totalCount < 0 ||
        (total !== null && total !== info.totalCount)) throw safeApiError_('PILOT_PAGE_INFO_UNVERIFIED');
    total = info.totalCount;
    let last = after;
    rows.forEach(function (row) {
      const id = Number(sourceId_(row.id));
      if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw safeApiError_('PILOT_ID_INVALID');
      if (last !== null) {
        const step = Math.sign(id - last);
        if (!step || (direction && step !== direction)) throw safeApiError_('PILOT_CURSOR_ORDER');
        direction = step;
      }
      last = id;
    });
    seen += rows.length; report.pages += 1; report.items = seen; report.reportedTotal = total;
    // Record the final page *before* throwing on contradictory hasNextPage/lastId.
    // This lets the owner distinguish a service count bug from a cursor mismatch
    // without weakening any coverage checks or making extra API requests.
    const infoLastId = typeof info.lastId === 'number' && Number.isSafeInteger(info.lastId) ? info.lastId :
      typeof info.lastId === 'string' && /^\d{1,10}$/.test(info.lastId) ? Number(info.lastId) : null;
    report.pageTrace.push({after: after, returned: rows.length,
      firstId: rows.length ? Number(sourceId_(rows[0].id)) : null, lastRowId: rows.length ? last : null,
      pageInfoLastId: infoLastId, hasNextPage: info.hasNextPage,
      cumulativeItems: seen, totalCount: total});
    if (seen > total || (!info.hasNextPage && seen !== total)) throw safeApiError_('PILOT_COUNT_MISMATCH');
    if (info.hasNextPage && (!rows.length || Number(sourceId_(info.lastId)) !== last ||
        last === after || (seen === total && root !== 'Lots'))) {
      throw safeApiError_('PILOT_CURSOR_INVALID');
    }
    consume(rows);
    if (!info.hasNextPage) { report.complete = true; return; }
    // Do not infer completion solely from the count: check exactly one more
    // server page, under the existing pilot request/time/day limits.
    if (seen === total) expectTerminalNull = true;
    after = last;
  }
}

/**
 * Manual, read-only probe of ONE page after a recorded filtered-pagination
 * contradiction. Does not call pilotSave_, claim coverage, or advance cursors.
 * The normal pilot still stops on PILOT_CURSOR_INVALID without this diagnostic.
 */
function inspectTenderPilotPaginationConflict() {
  assertSheetsReady_();
  const config = assertV3Ready_(), window = pilotWindow_(config);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw safeApiError_('PILOT_ALREADY_RUNNING');
  try {
    const sheet = spreadsheet_().getSheetByName('PILOT_RUNS');
    if (!sheet || sheet.getLastRow() < 2 ||
        sheet.getRange(1, 1, 1, 2).getValues()[0].join('|') !== TENDER_PILOT.headers.PILOT_RUNS.join('|')) {
      throw safeApiError_('PILOT_CURSOR_PROBE_REPORT_REQUIRED');
    }
    let previous;
    try {
      previous = JSON.parse(sheet.getRange(sheet.getLastRow(), 2, 1, 1).getValues()[0][0]);
    } catch (e) { throw safeApiError_('PILOT_CURSOR_PROBE_REPORT_INVALID'); }
    const stream = previous && Array.isArray(previous.streams) &&
      previous.streams.find(function (s) { return s && s.name === 'Lots.lastUpdateDate' && s.complete === false; });
    const trace = stream && Array.isArray(stream.pageTrace) && stream.pageTrace;
    const last = trace && trace.length && trace[trace.length - 1];
    const cursor = last && last.lastRowId;
    // Probe only this specific confirmed contradiction, never a guessed ID.
    if (previous.from !== window.from || previous.to !== window.to ||
        previous.sourceDateTimezone !== config.dateTimezone ||
        !['PILOT_CURSOR_INVALID', 'PILOT_TERMINAL_PAGE_UNVERIFIED'].includes(previous.issue) || !last ||
        last.hasNextPage !== true || last.cumulativeItems !== last.totalCount ||
        last.lastRowId !== last.pageInfoLastId || !Number.isSafeInteger(cursor) ||
        cursor < 1 || cursor > 2147483647 || !Number.isSafeInteger(last.totalCount) ||
        last.totalCount < 1 || (last.after !== null && (!Number.isSafeInteger(last.after) ||
        last.after < 1 || last.after === cursor))) {
      throw safeApiError_('PILOT_CURSOR_PROBE_NOT_APPLICABLE');
    }

    // Same filter, limit and selection as the pilot; only 'after' differs.
    config.requestBudget = pilotBudget_();
    const fields = selection_(Object.assign({}, config.fields, {
      plannedMethod: 'refTradeMethodsId', actualMethod: 'refBuyTradeMethodsId',
      lotUpdated: 'lastUpdateDate', lotIndexed: 'indexDate'
    }));
    const query = 'query TenderPilot($filter: LotsFiltersInput!, $limit: Int!, $after: Int) { ' +
      'Lots(filter: $filter, limit: $limit, after: $after) { ' + fields + ' } }';
    const response = graphqlResponse_(config, query, {
      filter: {lastUpdateDate: [window.from, window.to]},
      limit: TENDER_PILOT.pageSize, after: cursor
    });
    const rows = response.data.Lots, info = response.extensions && response.extensions.pageInfo;
    // A GraphQL nullable list can be explicitly null, omitted, or a non-array type.
    // Only log a fixed category; never serialize the untrusted response body.
    const lotsResultKind = !Object.prototype.hasOwnProperty.call(response.data, 'Lots') ? 'missing' :
      rows === null ? 'null' : Array.isArray(rows) ? 'array' : typeof rows;
    // The third page may have no pageInfo, or internally contradictory fields.
    // This is a READ-ONLY diagnostic, so report only whitelisted structural
    // evidence instead of throwing away the evidence. Never certify coverage.
    const pageInfoIssues = [];
    if (!Array.isArray(rows)) pageInfoIssues.push('LOTS_NOT_ARRAY');
    else if (rows.length > TENDER_PILOT.pageSize) pageInfoIssues.push('LOTS_PAGE_TOO_LARGE');
    if (!info || typeof info !== 'object' || Array.isArray(info)) pageInfoIssues.push('PAGE_INFO_MISSING');
    else {
      if (info.limitPage !== TENDER_PILOT.pageSize) pageInfoIssues.push('LIMIT_PAGE_MISMATCH');
      if (typeof info.hasNextPage !== 'boolean') pageInfoIssues.push('HAS_NEXT_PAGE_INVALID');
      if (!Number.isSafeInteger(info.totalCount) || info.totalCount < 0) pageInfoIssues.push('TOTAL_COUNT_INVALID');
    }
    const validRows = Array.isArray(rows) && rows.length <= TENDER_PILOT.pageSize;
    let ids = [];
    if (validRows) {
      try { ids = rows.map(function (row) { return Number(sourceId_(row && row.id)); }); }
      catch (e) { ids = []; pageInfoIssues.push('LOT_ID_INVALID'); }
    }
    const orderValid = validRows && ids.length === rows.length && ids.every(function (id, i) {
      return Number.isSafeInteger(id) && id > 0 && id < (i ? ids[i - 1] : cursor);
    });
    const lastReturnedId = ids.length ? ids[ids.length - 1] : null;
    let infoLastId = null;
    if (info && info.lastId != null) {
      try { infoLastId = Number(sourceId_(info.lastId)); }
      catch (e) { pageInfoIssues.push('PAGE_INFO_LAST_ID_INVALID'); }
    }
    const report = {
      mode: 'READ_ONLY_SINGLE_PAGE', from: window.from, to: window.to,
      sourceDateTimezone: config.dateTimezone, stream: 'Lots.lastUpdateDate',
      requestedAfter: cursor, priorReportedTotal: last.totalCount,
      priorCumulativeItems: last.cumulativeItems,
      nextPageReturned: validRows ? rows.length : null, firstId: ids.length ? ids[0] : null,
      lastId: lastReturnedId, pageInfoLastId: infoLastId,
      hasNextPage: info && typeof info.hasNextPage === 'boolean' ? info.hasNextPage : null,
      totalCount: info && Number.isSafeInteger(info.totalCount) ? info.totalCount : null,
      pageInfoIssues: pageInfoIssues, lotsResultKind: lotsResultKind,
      terminalNullCandidate: lotsResultKind === 'null' && !!info &&
        info.limitPage === TENDER_PILOT.pageSize && info.hasNextPage === false &&
        info.totalCount === last.totalCount && last.cumulativeItems === last.totalCount &&
        info.lastId === 0,
      pageInfoPresent: !!info && typeof info === 'object' && !Array.isArray(info),
      extensionsPresent: !!response.extensions && typeof response.extensions === 'object',
      pageInfoLimitPage: info && Number.isSafeInteger(info.limitPage) ? info.limitPage : null,
      pageInfoLimitPageType: info ? typeof info.limitPage : 'missing',
      pageInfoHasNextPageType: info ? typeof info.hasNextPage : 'missing',
      pageInfoTotalCountType: info ? typeof info.totalCount : 'missing',
      descendingOrderValid: orderValid,
      lastIdMatches: infoLastId === null && lastReturnedId === null ? null : lastReturnedId === infoLastId,
      priorTotalStillMatches: info && Number.isSafeInteger(info.totalCount) ? info.totalCount === last.totalCount : null,
      contradictoryExtraRows: validRows && rows.length > 0 && last.cumulativeItems >= last.totalCount,
      requests: config.requestBudget.used(),
      complete: false, countryCoverageVerified: false, watermarkAdvanced: false
    };
    console.log(JSON.stringify(report));
    return report;
  } finally { lock.releaseLock(); }
}

/**
 * Manual ONE-request probe of the first Lots.indexDate page after the bounded
 * pilot stops on PILOT_PAGE_INFO_UNVERIFIED before consuming that stream.
 * This diagnostic does not update snapshots, events, production cursors or
 * triggers. A quota entry is reserved for the one permitted API request.
 */
function inspectTenderPilotIndexDatePage() {
  assertSheetsReady_();
  const config = assertV3Ready_(), window = pilotWindow_(config);
  if (JSON.stringify(config.fields) !== JSON.stringify(V3_FIELDS)) {
    throw safeApiError_('PILOT_DEFAULT_MAPPING_REQUIRED');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw safeApiError_('PILOT_ALREADY_RUNNING');
  try {
    const sheet = spreadsheet_().getSheetByName('PILOT_RUNS');
    if (!sheet || sheet.getLastRow() < 2 ||
        sheet.getRange(1, 1, 1, 2).getValues()[0].join('|') !== TENDER_PILOT.headers.PILOT_RUNS.join('|')) {
      throw safeApiError_('PILOT_INDEX_PROBE_REPORT_REQUIRED');
    }
    let previous;
    try {
      previous = JSON.parse(sheet.getRange(sheet.getLastRow(), 2, 1, 1).getValues()[0][0]);
    } catch (e) { throw safeApiError_('PILOT_INDEX_PROBE_REPORT_INVALID'); }
    const streams = previous && previous.streams;
    const last = Array.isArray(streams) && streams[streams.length - 1];
    if (previous.from !== window.from || previous.to !== window.to ||
        previous.sourceDateTimezone !== config.dateTimezone ||
        previous.issue !== 'PILOT_PAGE_INFO_UNVERIFIED' || !last ||
        last.name !== 'Lots.indexDate' || last.complete !== false ||
        last.pages !== 0 || last.items !== 0 ||
        !Array.isArray(last.pageTrace) || last.pageTrace.length !== 0) {
      throw safeApiError_('PILOT_INDEX_PROBE_NOT_APPLICABLE');
    }
    config.requestBudget = pilotBudget_();
    // Match the original pilot filter, variable types, and selected fields.
    const fields = selection_(Object.assign({}, config.fields, {
      plannedMethod: 'refTradeMethodsId', actualMethod: 'refBuyTradeMethodsId',
      lotUpdated: 'lastUpdateDate', lotIndexed: 'indexDate'
    }));
    const query = 'query TenderPilot($filter: LotsFiltersInput!, $limit: Int!, $after: Int) { ' +
      'Lots(filter: $filter, limit: $limit, after: $after) { ' + fields + ' } }';
    const response = graphqlResponse_(config, query, {
      filter: {indexDate: [window.from, window.to]},
      limit: TENDER_PILOT.pageSize, after: null
    });
    const rows = response.data.Lots, info = response.extensions && response.extensions.pageInfo;
    const lotsResultKind = !Object.prototype.hasOwnProperty.call(response.data, 'Lots') ? 'missing' :
      rows === null ? 'null' : Array.isArray(rows) ? 'array' : typeof rows;
    const issues = [];
    if (!Array.isArray(rows)) issues.push('LOTS_NOT_ARRAY');
    else if (rows.length > TENDER_PILOT.pageSize) issues.push('LOTS_PAGE_TOO_LARGE');
    if (!info || typeof info !== 'object' || Array.isArray(info)) issues.push('PAGE_INFO_MISSING');
    else {
      if (info.limitPage !== TENDER_PILOT.pageSize) issues.push('LIMIT_PAGE_MISMATCH');
      if (typeof info.hasNextPage !== 'boolean') issues.push('HAS_NEXT_PAGE_INVALID');
      if (!Number.isSafeInteger(info.totalCount) || info.totalCount < 0) issues.push('TOTAL_COUNT_INVALID');
    }
    const ids = [];
    if (Array.isArray(rows) && rows.length <= TENDER_PILOT.pageSize) {
      rows.forEach(function (item) {
        try {
          const id = Number(sourceId_(item && item.id));
          if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new Error('id');
          ids.push(id);
        } catch (e) { issues.push('LOT_ID_INVALID'); }
      });
    }
    const lastId = info && Number.isSafeInteger(info.lastId) ? info.lastId : null;
    const pageInfoValid = issues.length === 0;
    const report = {
      mode: 'READ_ONLY_INDEX_FIRST_PAGE', from: window.from, to: window.to,
      sourceDateTimezone: config.dateTimezone, stream: 'Lots.indexDate',
      requestedAfter: null, lotsResultKind: lotsResultKind,
      returned: Array.isArray(rows) && rows.length <= TENDER_PILOT.pageSize ? rows.length : null,
      firstId: ids.length ? ids[0] : null, lastRowId: ids.length ? ids[ids.length - 1] : null,
      pageInfoIssues: Array.from(new Set(issues)),
      pageInfoPresent: !!info && typeof info === 'object' && !Array.isArray(info),
      hasNextPage: info && typeof info.hasNextPage === 'boolean' ? info.hasNextPage : null,
      totalCount: info && Number.isSafeInteger(info.totalCount) ? info.totalCount : null,
      lastId: lastId,
      limitPage: info && Number.isSafeInteger(info.limitPage) ? info.limitPage : null,
      lastIdType: info ? typeof info.lastId : 'missing',
      totalCountType: info ? typeof info.totalCount : 'missing',
      emptyNullCandidate: lotsResultKind === 'null' && !!info &&
        info.limitPage === TENDER_PILOT.pageSize && info.totalCount === 0 &&
        info.hasNextPage === false && info.lastId === 0,
      pageInfoStructurallyValid: pageInfoValid,
      requests: config.requestBudget.used(),
      complete: false, countryCoverageVerified: false,
      dailyCoverageVerified: false, watermarkAdvanced: false
    };
    console.log(JSON.stringify(report));
    return report;
  } finally { lock.releaseLock(); }
}

function pilotWithin_(raw, config, window) {
  const instant = Date.parse(apiDate_(raw, config.dateTimezone, false));
  if (instant < window.start || instant > window.end) throw safeApiError_('PILOT_FILTER_RANGE_MISMATCH');
}

/** Recover subject evidence only by explicit pointList IDs, never from a lot number. */
function pilotResolvePlans_(rows, config, cache) {
  const needed = new Set();
  rows.forEach(function (row) {
    if (row.isDeleted !== 0 || !Array.isArray(row.pointList)) return;
    row.pointList.forEach(function (id) {
      if (Number.isInteger(id) && id > 0 && id <= 2147483647 &&
          !(row.Plans || []).some(function (p) { return p && p.id === id && Number.isInteger(p.refSubjectTypeId); }) && !cache.has(id)) needed.add(id);
    });
  });
  const ids = Array.from(needed);
  // Bound total resolved IDs per run; surplus evidence stays in quarantine.
  const allowed = ids.slice(0, Math.max(0, TENDER_PILOT.maxPlanIds - cache.size));
  for (let offset = 0; offset < allowed.length; offset += TENDER_PILOT.pageSize) {
    const batch = allowed.slice(offset, offset + TENDER_PILOT.pageSize);
    const result = [];
    pilotScan_(config, 'Plans', {id: batch}, 'id refSubjectTypeId', function (plans) {
      plans.forEach(function (p) {
        if (!batch.includes(p.id) || !Number.isInteger(p.refSubjectTypeId)) throw safeApiError_('PILOT_PLAN_RESPONSE_INVALID');
        result.push(p);
      });
    }, {});
    batch.forEach(function (id) { cache.set(id, result.find(function (p) { return p.id === id; }) || null); });
  }
  return rows.map(function (row) {
    if (!Array.isArray(row.pointList) || !Array.isArray(row.Plans)) return row;
    const plans = row.Plans.slice();
    row.pointList.forEach(function (id) {
      if (!plans.some(function (p) { return p && p.id === id; }) && cache.get(id)) plans.push(cache.get(id));
    });
    return Object.assign({}, row, {Plans: plans});
  });
}

function pilotClassify_(row, config) {
  try {
    if (['refTradeMethodsId', 'refBuyTradeMethodsId'].some(function (key) {
      return row[key] != null && (!Number.isInteger(row[key]) || row[key] < 1);
    })) throw safeApiError_('API_LOT_METHOD_INVALID');
    // Stronger evidence than a parent announcement type: every explicit plan matches a point.
    if (row.isDeleted === 0 && (!Array.isArray(row.pointList) || !row.pointList.length ||
        row.pointList.some(function (id) { return !Number.isInteger(id) || id < 1; }) ||
        !Array.isArray(row.Plans) || row.Plans.some(function (p) { return !p || !row.pointList.includes(p.id) || !Number.isInteger(p.refSubjectTypeId); }) ||
        new Set(row.Plans.map(function (p) { return p.id; })).size !== row.Plans.length)) {
      throw safeApiError_('API_LOT_SUBJECT_TYPE_UNVERIFIED');
    }
    const result = normalizeV3Lot_(row, config);
    return result.lot ? {kind: 'ELIGIBLE_GOODS', lot: result.lot} :
      {kind: row.isDeleted === 1 ? 'DELETED' : 'EXCLUDED'};
  } catch (e) {
    return {kind: 'QUARANTINE', reason: e.tenderSafeMessage ? e.tenderSafeMessage.split(':')[0] : 'NORMALIZATION_INVALID'};
  }
}

function pilotSafe_(value) {
  let text = value == null ? '' : String(value);
  const props = PropertiesService.getScriptProperties();
  [TENDER.tokenKey, TENDER.legacyTokenKey].forEach(function (key) {
    const secret = props.getProperty(key);
    if (secret && secret.trim()) text = text.split(secret).join('[REDACTED]').split(secret.trim()).join('[REDACTED]');
  });
  return safeText_(text);
}

function pilotSheets_() {
  const book = spreadsheet_(), sheets = {};
  // Validate all existing structures before creating anything.
  Object.keys(TENDER_PILOT.headers).forEach(function (name) {
    const sheet = book.getSheetByName(name), headers = TENDER_PILOT.headers[name];
    if (sheet && sheet.getLastRow() && sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('|') !== headers.join('|')) {
      throw safeApiError_('PILOT_SHEET_STRUCTURE_INVALID');
    }
    if (sheet && sheet.getLastRow() > TENDER_PILOT.maxRows + 1) throw safeApiError_('PILOT_STORAGE_LIMIT');
  });
  Object.keys(TENDER_PILOT.headers).forEach(function (name) {
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    if (!sheet.getLastRow()) sheet.appendRow(TENDER_PILOT.headers[name]);
    sheets[name] = sheet;
  });
  return sheets;
}

function pilotWrite_(sheet, rows, width) {
  const old = Math.max(0, sheet.getLastRow() - 1);
  const output = rows.concat(Array.from({length: Math.max(0, old - rows.length)}, function () { return new Array(width).fill(''); }));
  if (output.length) {
    ensureCapacity_(sheet, output.length + 1, width);
    sheet.getRange(2, 1, output.length, width).setNumberFormat('@');
    sheet.getRange(2, 1, output.length, width).setValues(output);
  }
}

/** An observed change is not a complete historical audit of transitions between polls. */
function pilotSave_(sheets, items, config, window) {
  const now = new Date().toISOString(), snapshots = new Map(), quarantine = new Map();
  sheets.PILOT_LOTS.getDataRange().getValues().slice(1).filter(function (r) { return r[0]; }).forEach(function (r) {
    if (snapshots.has(String(r[0])) || !Number.isInteger(Number(r[10])) || Number(r[10]) < 1) throw safeApiError_('PILOT_SNAPSHOT_INVALID');
    snapshots.set(String(r[0]), r);
  });
  sheets.PILOT_QUARANTINE.getDataRange().getValues().slice(1).filter(function (r) { return r[0]; }).forEach(function (r) { quarantine.set(String(r[0]), r); });
  const keys = new Set(sheets.PILOT_EVENTS.getDataRange().getValues().slice(1).map(function (r) { return String(r[0]); }));
  const events = [];
  items.forEach(function (row, id) {
    const classification = pilotClassify_(row, config), status = row.RefLotsStatus && row.RefLotsStatus.code || '';
    const publication = row.TrdBuy && row.TrdBuy.publishDate || '';
    const safeLot = classification.lot && Object.keys(classification.lot).reduce(function (result, key) {
      const value = classification.lot[key];
      result[key] = typeof value === 'string' ? pilotSafe_(value) : value;
      return result;
    }, {});
    const normalized = safeLot ? JSON.stringify(safeLot) : '';
    const points = Array.isArray(row.pointList) ? row.pointList.slice().sort(function (a, b) { return a - b; }) : [];
    const plans = Array.isArray(row.Plans) ? row.Plans.map(function (p) { return p ? [p.id, p.refSubjectTypeId] : [null, null]; }).sort(function (a, b) { return a[0] - b[0]; }) : [];
    const hash = fingerprint_(JSON.stringify([status, classification.kind, classification.reason || '', publication,
      row.isDeleted, row.amount, row.count, row.refTradeMethodsId, row.refBuyTradeMethodsId, points, plans, normalized]));
    const old = snapshots.get(id), revision = old ? Number(old[10]) : 0;
    if (!old || old[1] !== hash) {
      let type = old ? (old[2] !== pilotSafe_(status) ? 'STATUS_CHANGED' : 'LOT_UPDATED') : 'FIRST_OBSERVED';
      if (!old && publication) {
        try {
          const published = Date.parse(apiDate_(publication, config.dateTimezone, false));
          if (published >= window.start && published <= window.end) type = 'NEW_PUBLICATION';
        } catch (e) { /* Unknown publication must not be called a new publication. */ }
      }
      const key = fingerprint_(JSON.stringify([id, revision, hash]));
      if (!keys.has(key)) { events.push([key, id, type, old ? old[2] : '', pilotSafe_(status), classification.kind, now]); keys.add(key); }
      snapshots.set(id, [id, hash, pilotSafe_(status), classification.kind, Number.isInteger(row.refTradeMethodsId) ? row.refTradeMethodsId : '',
        Number.isInteger(row.refBuyTradeMethodsId) ? row.refBuyTradeMethodsId : '', pilotSafe_(publication), normalized, old ? old[8] : now, now, revision + 1]);
    }
    if (classification.kind === 'QUARANTINE') quarantine.set(id, [id, classification.reason, now]); else quarantine.delete(id);
  });
  if (snapshots.size > TENDER_PILOT.maxRows || keys.size > TENDER_PILOT.maxRows) throw safeApiError_('PILOT_STORAGE_LIMIT');
  // Event first + durable flush: retry after a snapshot failure reuses the same event key.
  events.forEach(function (r) { sheets.PILOT_EVENTS.appendRow(r); });
  SpreadsheetApp.flush();
  pilotWrite_(sheets.PILOT_LOTS, Array.from(snapshots.values()), TENDER_PILOT.headers.PILOT_LOTS.length);
  pilotWrite_(sheets.PILOT_QUARANTINE, Array.from(quarantine.values()), TENDER_PILOT.headers.PILOT_QUARANTINE.length);
  SpreadsheetApp.flush();
  return {eventsAdded: events.length, snapshotCount: snapshots.size, quarantineCount: quarantine.size};
}

function runTenderBoundedPilot() {
  assertSheetsReady_();
  const config = assertV3Ready_(), window = pilotWindow_(config);
  // Pilot queries use the exact documented structure; custom mappings require separate review.
  if (JSON.stringify(config.fields) !== JSON.stringify(V3_FIELDS)) throw safeApiError_('PILOT_DEFAULT_MAPPING_REQUIRED');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw safeApiError_('PILOT_ALREADY_RUNNING');
  try {
    const sheets = pilotSheets_();
    if (sheets.PILOT_RUNS.getLastRow() >= TENDER_PILOT.maxRows + 1) throw safeApiError_('PILOT_STORAGE_LIMIT');
    config.requestBudget = pilotBudget_();
    const items = new Map(), plans = new Map();
    const report = {from: window.from, to: window.to, sourceDateTimezone: config.dateTimezone,
      displayTimezone: 'Asia/Almaty', displayUtcOffset: '+05:00', streams: [], complete: false,
      countryCoverageVerified: false, dailyCoverageVerified: false, watermarkAdvanced: false, mvpReady: false};
    const fields = selection_(Object.assign({}, config.fields, {plannedMethod: 'refTradeMethodsId', actualMethod: 'refBuyTradeMethodsId',
      lotUpdated: 'lastUpdateDate', lotIndexed: 'indexDate'}));
    function collect(rows) {
      rows.forEach(function (row) {
        const id = sourceId_(row.id);
        if (!items.has(id) && items.size >= TENDER_PILOT.maxLots) throw safeApiError_('PILOT_LOT_LIMIT');
        // Retain latest response for a duplicate ID. Cross-stream inconsistencies forbid a coverage claim.
        if (items.has(id) && fingerprint_(JSON.stringify(items.get(id))) !== fingerprint_(JSON.stringify(row))) report.sourceChangedDuringRun = true;
        items.set(id, row);
      });
    }
    try {
      [['TrdBuy', 'publishDate'], ['Lots', 'lastUpdateDate'], ['TrdBuy', 'lastUpdateDate'], ['Lots', 'indexDate']].forEach(function (stream) {
        const root = stream[0], field = stream[1], stats = {name: root + '.' + field, children: []};
        report.streams.push(stats);
        const filter = {}; filter[field] = [window.from, window.to];
        pilotScan_(config, root, filter, root === 'Lots' ? fields : 'id ' + field, function (rows) {
          rows.forEach(function (row) { pilotWithin_(row[field], config, window); });
          if (root === 'Lots') { collect(rows); return; }
          if (!rows.length) return;
          const ids = rows.map(function (row) { return row.id; }), child = {};
          stats.children.push(child);
          pilotScan_(config, 'Lots', {trdBuyId: ids}, fields, function (lots) {
            if (lots.some(function (lot) { return !ids.includes(lot.trdBuyId); })) throw safeApiError_('PILOT_PARENT_FILTER_MISMATCH');
            collect(lots);
          }, child);
        }, stats);
      });
      const rows = Array.from(items.values());
      for (let i = 0; i < rows.length; i += TENDER_PILOT.pageSize) {
        pilotResolvePlans_(rows.slice(i, i + TENDER_PILOT.pageSize), config, plans).forEach(function (row) { items.set(sourceId_(row.id), row); });
      }
      report.complete = !report.sourceChangedDuringRun;
    } catch (e) { report.issue = e.tenderSafeMessage ? e.tenderSafeMessage.split(':')[0] : 'PILOT_OPERATION_FAILED'; }
    report.requests = config.requestBudget.used(); report.uniqueLots = items.size;
    // Incomplete runs retain observations, but never advance any progress/watermark.
    try { Object.assign(report, pilotSave_(sheets, items, config, window)); }
    catch (e) { report.complete = false; report.writeIssue = e.tenderSafeMessage ? e.tenderSafeMessage.split(':')[0] : 'PILOT_WRITE_FAILED'; }
    sheets.PILOT_RUNS.appendRow([new Date().toISOString(), JSON.stringify(report)]);
    console.log(JSON.stringify(report));
    return report;
  } finally { lock.releaseLock(); }
}
