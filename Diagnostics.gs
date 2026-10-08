/** Меню привязанного к таблице проекта. onOpen не запрашивает API. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tender AI Kazakhstan')
    .addItem('1. Создать / проверить листы', 'setupTenderMvp')
    .addItem('2. Проверить ядро без API', 'runTenderSelfTests')
    .addItem('3. Проверить API V3 и поля лотов', 'testGoszakupV3Connection')
    .addItem('Справочник статусов API', 'inspectGoszakupStatusReference')
    .addItem('Проверить старый REST-реестр', 'testGoszakupConnection')
    .addItem('Статус проекта', 'showTenderStatus')
    .addSeparator()
    .addItem('Запустить синхронизацию', 'syncTenderLots')
    .addItem('Установить ежедневный триггер', 'installDailyTrigger')
    .addItem('Удалить триггеры Tender AI', 'removeTenderTriggers')
    .addToUi();
}

function assertSheetsReady_() {
  const book = spreadsheet_();
  TENDER.sheets.forEach(function (name) {
    const sheet = book.getSheetByName(name);
    if (!sheet) throw safeApiError_('SETUP_REQUIRED: отсутствует лист ' + name + '; выполните setupTenderMvp.');
    const headers = name === 'SETTINGS' ? ['KEY', 'VALUE', 'DESCRIPTION'] :
      name === 'LOGS' ? ['AT', 'LEVEL', 'EVENT', 'DETAILS'] : TENDER.headers;
    if (sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('|') !== headers.join('|')) {
      throw safeApiError_('SHEET_SCHEMA_MISMATCH: неверные заголовки листа ' + name + '.');
    }
  });
}

/** Не изменяет лоты, курсор, настройки или триггеры. Только LOGS. */
function testGoszakupConnection() {
  assertSheetsReady_();
  try {
    const first = fetchGoszakupRawPage_(null);
    let pages = 1;
    let checked = first.items.length;
    let endReached = first.nextCursor === null;
    if (first.nextCursor !== null) {
      const second = fetchGoszakupRawPage_(first.nextCursor);
      if (second.nextCursor === first.nextCursor) throw safeApiError_('API_CURSOR_STALLED');
      const firstIds = new Set(first.items.map(function (item) { return sourceId_(item.id); }));
      if (second.items.some(function (item) { return firstIds.has(sourceId_(item.id)); })) {
        throw safeApiError_('API_PAGE_OVERLAP: первые две страницы повторяют ID; требуется проверка стабильности API.');
      }
      pages += 1;
      checked += second.items.length;
      endReached = second.nextCursor === null;
    }
    const report = {
      connectionOk: true, mvpReady: false, endpoint: TENDER.apiOrigin + '/lots',
      pagesChecked: pages, itemsChecked: checked, reportedTotal: first.total,
      paginationEndReached: endReached,
      fullPaginationChecked: endReached && checked === first.total,
      blockingIssue: TENDER.apiStatus
    };
    log_('INFO', 'API_CONNECTION_OK', JSON.stringify(report));
    return report;
  } catch (error) {
    const message = error.tenderSafeMessage || 'API_CONNECTION_FAILED: проверьте сетевой доступ и выполнение в Google.';
    log_('ERROR', 'API_CONNECTION_FAILED', message);
    throw new Error(message);
  }
}

/** Метаданные без токена, его фрагментов и значений других секретов. */
function getTenderStatus() {
  const props = PropertiesService.getScriptProperties();
  const report = {
    apiStatus: TENDER.apiStatus, documentation: TENDER.apiDocs,
    tokenPresent: Boolean((props.getProperty(TENDER.tokenKey) || props.getProperty(TENDER.legacyTokenKey) || '').trim()),
    spreadsheetBound: Boolean(props.getProperty(TENDER.sheetIdKey)),
    sheetsReady: false, syncInProgress: false, pagesSaved: 0,
    consecutiveFailures: 0, dailyTriggers: 0, continuationTriggers: 0,
    timezone: TENDER.timezone, maxLotAmountKzt: TENDER.maxAmount, mvpReady: false
  };
  if (report.spreadsheetBound) {
    try { assertSheetsReady_(); report.sheetsReady = true; }
    catch (error) { report.setupIssue = error.tenderSafeMessage || 'SHEETS_UNAVAILABLE'; }
  }
  try {
    const state = state_();
    if (state) {
      report.syncInProgress = true;
      report.pagesSaved = state.pages || 0;
      report.consecutiveFailures = state.failures || 0;
    }
  } catch (error) { report.stateIssue = 'SYNC_STATE_INVALID'; }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyTenderSync') report.dailyTriggers += 1;
    if (t.getHandlerFunction() === 'continueTenderSync') report.continuationTriggers += 1;
  });
  try {
    const config = v3Config_();
    report.v3ConfigurationIssues = v3RuntimeIssues_(config);
    report.v3LiveVerified = props.getProperty(V3_PROOF_KEY) === config.fingerprint;
    report.mvpReady = report.sheetsReady && report.tokenPresent && report.v3LiveVerified && !report.v3ConfigurationIssues.length;
    report.apiStatus = report.mvpReady ? 'V3_VERIFIED' :
      report.v3ConfigurationIssues.length ? 'V3_CONFIG_REQUIRED' : 'V3_LIVE_CHECK_REQUIRED';
  } catch (error) {
    report.v3ConfigurationIssues = ['V3_ENDPOINT_OR_FIELD_CONFIG_REQUIRED'];
    report.apiStatus = 'V3_CONFIG_REQUIRED';
  }
  return report;
}

function showTenderStatus() {
  SpreadsheetApp.getUi().alert('Tender AI Kazakhstan', JSON.stringify(getTenderStatus(), null, 2),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Реальный GraphQL-запрос и introspection с токеном из Script Properties.
 * До двух страниц; никаких изменений ALL_LOTS, курсора и триггеров.
 */
function testGoszakupV3Connection() {
  assertSheetsReady_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  const props = PropertiesService.getScriptProperties();
  try {
    props.deleteProperty(V3_PROOF_KEY);
    props.deleteProperty(V3_DIAGNOSTIC_KEY); // Не экспортировать старый успех после нового сбоя.
    const config = v3Config_();
    const mapping = inspectV3Schema_(config);
    const first = v3RawPage_(config, null, true);
    const second = first.nextCursor === null ? {items: [], nextCursor: null,
      paginationVerified: first.paginationVerified} : v3RawPage_(config, first.nextCursor, true);
    const items = first.items.concat(second.items);
    const issues = v3RuntimeIssues_(config);
    if (!first.paginationVerified || !second.paginationVerified) issues.push('V3_PAGE_INFO_UNVERIFIED');
    let eligibleSamples = 0;
    const normalizationErrors = [];
    if (!issues.length) items.forEach(function (item) {
      try {
        const result = normalizeV3Lot_(item, config);
        if (result.lot) eligibleSamples += 1;
      } catch (error) {
        const code = (error.tenderSafeMessage || 'NORMALIZATION_FAILED').split(':')[0];
        if (!normalizationErrors.includes(code)) normalizationErrors.push(code);
      }
    });
    const ready = !issues.length && !normalizationErrors.length && eligibleSamples > 0;
    if (!items.length) issues.push('NO_REAL_LOT_SAMPLE');
    else if (!issues.length && !eligibleSamples) issues.push('NO_ELIGIBLE_NORMALIZED_SAMPLE');
    const token = apiToken_();
    function limited(value) {
      if (Array.isArray(value)) return value.slice(0, 5).map(limited);
      if (typeof value === 'string') return value.split(token).join('[REDACTED]').slice(0, 160);
      if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
      return '[unexpected value type]';
    }
    const samples = items.slice(0, 2).map(function (item) {
      const sample = {};
      Object.keys(config.fields).forEach(function (key) {
        sample[key] = limited(field_(item, config.fields[key]));
      });
      return sample;
    });
    const report = {
      version: 3, checkedAt: new Date().toISOString(), connectionOk: true,
      schemaVerified: true, mvpReady: ready,
      endpointVerifiedByResponse: config.endpoint,
      mapping: mapping, pagesChecked: first.nextCursor === null ? 1 : 2,
      itemsChecked: items.length,
      paginationVerified: first.paginationVerified && second.paginationVerified,
      paginationEndReached: second.paginationVerified && second.nextCursor === null,
      pageInfo: [first.pageInfo, second.pageInfo].filter(Boolean).map(function (p) {
        return {hasNextPage: p.hasNextPage, lastId: p.lastId, totalCount: p.totalCount, limitPage: p.limitPage};
      }),
      eligibleNormalizedSamples: eligibleSamples, configurationIssues: issues,
      normalizationErrors: normalizationErrors, samples: samples,
      fullCountryCoverageVerified: false, actualDailyTriggerVerified: false
    };
    // Whitelist выше + редактирование возможного отражения секрета в строковых полях.
    const safeJson = JSON.stringify(report).split(token).join('[REDACTED]');
    const safeReport = JSON.parse(safeJson);
    log_('INFO', 'API_V3_DIAGNOSTIC', safeJson);
    if (safeJson.length <= 8000) props.setProperty(V3_DIAGNOSTIC_KEY, safeJson);
    else props.deleteProperty(V3_DIAGNOSTIC_KEY); // полный отчёт остаётся в LOGS
    if (ready) props.setProperty(V3_PROOF_KEY, config.fingerprint);
    console.log(safeJson);
    return safeReport;
  } catch (error) {
    props.deleteProperty(V3_PROOF_KEY);
    const message = error.tenderSafeMessage || 'API_V3_DIAGNOSTIC_FAILED: см. настройки и официальную схему; секретные ответы не выводятся.';
    log_('ERROR', 'API_V3_DIAGNOSTIC_FAILED', message);
    throw new Error(message);
  } finally { lock.releaseLock(); }
}

function exportTenderApiDiagnostic() {
  const raw = PropertiesService.getScriptProperties().getProperty(V3_DIAGNOSTIC_KEY);
  if (!raw) throw new Error('Сначала запустите testGoszakupV3Connection. Если отчёт большой, скопируйте API_V3_DIAGNOSTIC из LOGS.');
  console.log(raw);
  return JSON.parse(raw);
}

/** Справочник из официальной /help; не определяет активность по имени наугад. */
function inspectGoszakupStatusReference() {
  assertSheetsReady_();
  try {
    const token = apiToken_();
    const result = fetchJsonWithRetry_(TENDER.apiOrigin + '/v3/refs/ref_lots_status', {
      method: 'get', contentType: 'application/json',
      headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'}
    });
    if (!result || !Array.isArray(result.items) || typeof result.next_page !== 'string' ||
        !Number.isInteger(result.total)) throw safeApiError_('API_REFERENCE_SCHEMA_MISMATCH');
    const statuses = result.items.map(function (item) {
      if (!item || typeof item.code !== 'string' || typeof item.name_ru !== 'string') {
        throw safeApiError_('API_REFERENCE_SCHEMA_MISMATCH');
      }
      return {id: sourceId_(item.id), code: item.code.split(token).join('[REDACTED]').slice(0, 160),
        nameRu: item.name_ru.split(token).join('[REDACTED]').slice(0, 160)};
    });
    const report = {source: TENDER.apiOrigin + '/v3/refs/ref_lots_status',
      complete: result.next_page === '' && statuses.length === result.total,
      statuses: statuses, reportedTotal: result.total,
      note: 'Коды активных статусов выбираются по официальной семантике; автоматического угадывания по названиям нет.'};
    log_('INFO', 'API_STATUS_REFERENCE', JSON.stringify(report));
    console.log(JSON.stringify(report));
    return report;
  } catch (error) {
    const message = error.tenderSafeMessage || 'API_STATUS_REFERENCE_FAILED';
    log_('ERROR', 'API_STATUS_REFERENCE_FAILED', message);
    throw new Error(message);
  }
}
