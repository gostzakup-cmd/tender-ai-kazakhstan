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
  let after = null, direction = 0, total = null, seen = 0;
  report.complete = false; report.pages = 0; report.items = 0;
  // Only structural pagination evidence (no raw responses or tokens); max 40 pages/run.
  report.pageTrace = [];
  while (true) {
    const response = graphqlResponse_(config, query, {filter: filter, limit: TENDER_PILOT.pageSize, after: after});
    const rows = response.data[root], info = response.extensions && response.extensions.pageInfo;
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
    if (info.hasNextPage && (!rows.length || Number(sourceId_(info.lastId)) !== last || last === after || seen >= total)) {
      throw safeApiError_('PILOT_CURSOR_INVALID');
    }
    consume(rows);
    if (!info.hasNextPage) { report.complete = true; return; }
    after = last;
  }
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
