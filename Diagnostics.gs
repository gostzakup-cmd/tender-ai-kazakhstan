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
  report.fullSyncEnabled = false;
  report.dailyTriggerEnabled = false;
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
 * До двух страниц + необязательная проверка ≤5 явных ID.
 * Никаких изменений ALL_LOTS, курсора и триггеров.
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
    let targetedItems = [];
    const rawIds = props.getProperty('GOSZAKUP_DIAGNOSTIC_LOT_IDS');
    if (rawIds) {
      let ids;
      try { ids = JSON.parse(rawIds); } catch (e) { throw safeApiError_('API_DIAGNOSTIC_IDS_INVALID'); }
      if (!Array.isArray(ids) || !ids.length || ids.length > 5 || new Set(ids).size !== ids.length ||
          ids.some(function (id) { return !Number.isInteger(id) || id < 1 || id > 2147483647; })) {
        throw safeApiError_('API_DIAGNOSTIC_IDS_INVALID');
      }
      const data = graphql_(config, 'query TenderSample($ids: [Int!]!) { Lots(filter: {id: $ids}, limit: 5) { ' +
        selection_(config.fields) + ' } }', {ids: ids});
      targetedItems = data.Lots;
      if (!Array.isArray(targetedItems) || targetedItems.length !== ids.length ||
          new Set(targetedItems.map(function (item) { return field_(item, config.fields.id); })).size !== ids.length ||
          targetedItems.some(function (item) { return !ids.includes(field_(item, config.fields.id)); })) {
        throw safeApiError_('API_DIAGNOSTIC_IDS_MISMATCH');
      }
    }
    const issues = v3RuntimeIssues_(config);
    if (!first.paginationVerified || !second.paginationVerified) issues.push('V3_PAGE_INFO_UNVERIFIED');
    let eligibleSamples = 0, subjectTypeQuarantineSamples = 0;
    const subjectTypeQuarantineIds = [], normalizationErrors = [];
    if (!issues.length) items.concat(targetedItems).forEach(function (item) {
      try {
        const result = normalizeV3Lot_(item, config);
        if (result.lot) eligibleSamples += 1;
      } catch (error) {
        const code = (error.tenderSafeMessage || 'NORMALIZATION_FAILED').split(':')[0];
        // A missing/ambiguous Plans relation is normal in public registry pages.
        // Pilot.gs treats such records as QUARANTINE, never as eligible goods.
        // All other normalization failures still block the readiness proof.
        if (code === 'API_LOT_SUBJECT_TYPE_UNVERIFIED') {
          subjectTypeQuarantineSamples += 1;
          const id = item && item.id;
          if (Number.isInteger(id) && subjectTypeQuarantineIds.length < 10) subjectTypeQuarantineIds.push(id);
        } else if (!normalizationErrors.includes(code)) normalizationErrors.push(code);
      }
    });
    const ready = !issues.length && !normalizationErrors.length && eligibleSamples > 0;
    if (!items.length && !targetedItems.length) issues.push('NO_REAL_LOT_SAMPLE');
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
      targetedItemsChecked: targetedItems.length,
      paginationVerified: first.paginationVerified && second.paginationVerified,
      paginationEndReached: second.paginationVerified && second.nextCursor === null,
      pageInfo: [first.pageInfo, second.pageInfo].filter(Boolean).map(function (p) {
        return {hasNextPage: p.hasNextPage, lastId: p.lastId, totalCount: p.totalCount, limitPage: p.limitPage};
      }),
      eligibleNormalizedSamples: eligibleSamples, configurationIssues: issues,
      normalizationErrors: normalizationErrors, subjectTypeQuarantineSamples: subjectTypeQuarantineSamples,
      subjectTypeQuarantineIds: subjectTypeQuarantineIds, samples: samples,
      boundedPilotOnly: true, fullCountryCoverageVerified: false, actualDailyTriggerVerified: false
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

/**
 * Этап 2: только чтение известных лотов по документированным фильтрам id/lotNumber.
 * Не меняет Sheets, Script Properties, курсор, доказательство готовности или триггеры.
 * Публичные примеры не доказывают полноту реестра, зону API или все активные статусы.
 */
function inspectTenderStage2Evidence() {
  try {
    const config = v3Config_();
    const token = apiToken_();
    const references = [
      {id: 43495954, trdBuyId: 17735121, lotNumber: '88105345-ЗЦП1', method: 'ЗЦП'},
      {id: 43534707, trdBuyId: 17752933, lotNumber: '88119672-ОК1', method: 'Открытый конкурс'},
      {id: 33822625, trdBuyId: 13633135, lotNumber: '74666464-АУК1', method: 'Аукцион (с 2022)'},
      {id: 43534654, trdBuyId: 17752918, lotNumber: '88017458-ОИ3', method: 'Из одного источника'},
      {id: 43534519, trdBuyId: 17752865, lotNumber: '87727613-КРБС1', method: 'Конкурс РБС'}
    ];
    const filterType = graphql_(config, '{ __type(name: "LotsFiltersInput") { inputFields { name } } }').__type;
    if (!filterType || !Array.isArray(filterType.inputFields)) throw safeApiError_('API_STAGE2_FILTER_SCHEMA_MISSING');
    const filterNames = filterType.inputFields.map(function (field) { return field && field.name; });
    if (['id', 'lotNumber', 'refLotStatusId'].some(function (name) { return !filterNames.includes(name); })) {
      throw safeApiError_('API_STAGE2_FILTER_SCHEMA_MISMATCH');
    }
    const query = 'query TenderStage2($filter: LotsFiltersInput, $limit: Int) {' +
      ' Lots(filter: $filter, limit: $limit) {' +
      ' id lotNumber trdBuyId trdBuyNumberAnno refTradeMethodsId refBuyTradeMethodsId count amount isDeleted pointList' +
      ' Plans { id refSubjectTypeId }' +
      ' RefLotsStatus { id code nameRu }' +
      ' TrdBuy { id numberAnno refTradeMethodsId publishDate startDate endDate repeatStartDate repeatEndDate }' +
      ' } }';
    function lookup(filter, limit) {
      const data = graphql_(config, query, {filter: filter, limit: limit});
      if (!Array.isArray(data.Lots) || data.Lots.length > limit ||
          data.Lots.some(function (row) { return !row || !Number.isInteger(row.id); }) ||
          new Set(data.Lots.map(function (row) { return row.id; })).size !== data.Lots.length) {
        throw safeApiError_('API_STAGE2_LOOKUP_INVALID');
      }
      return data.Lots;
    }
    function pick(object, keys) {
      if (!object || typeof object !== 'object' || Array.isArray(object)) return null;
      const result = {};
      keys.forEach(function (key) {
        const value = object[key];
        result[key] = typeof value === 'string' ? value.split(token).join('[REDACTED]').slice(0, 200) :
          value === null || typeof value === 'number' || typeof value === 'boolean' ? value : null;
      });
      return result;
    }
    function sample(row) {
      if (!row) return null;
      const result = pick(row, ['id', 'lotNumber', 'trdBuyId', 'trdBuyNumberAnno',
        'refTradeMethodsId', 'refBuyTradeMethodsId', 'count', 'amount', 'isDeleted']);
      result.pointList = Array.isArray(row.pointList) ? row.pointList.slice(0, 10).map(function (id) {
        return Number.isInteger(id) ? id : null;
      }) : null;
      result.Plans = Array.isArray(row.Plans) ? row.Plans.slice(0, 10).map(function (plan) {
        return pick(plan, ['id', 'refSubjectTypeId']);
      }) : null;
      result.planSampleTruncated = Boolean((row.pointList || []).length > 10 || (row.Plans || []).length > 10);
      result.allPlanPointsCovered = Boolean(Array.isArray(row.pointList) && row.pointList.length &&
        Array.isArray(row.Plans) && row.pointList.every(function (id) {
          return row.Plans.some(function (plan) { return plan && plan.id === id; });
        }));
      result.RefLotsStatus = pick(row.RefLotsStatus, ['id', 'code', 'nameRu']);
      result.TrdBuy = pick(row.TrdBuy, ['id', 'numberAnno', 'refTradeMethodsId',
        'publishDate', 'startDate', 'endDate', 'repeatStartDate', 'repeatEndDate']);
      return result;
    }
    const byId = lookup({id: references.map(function (row) { return row.id; })}, references.length);
    if (byId.some(function (row) { return !references.some(function (ref) { return ref.id === row.id; }); })) {
      throw safeApiError_('API_STAGE2_FILTER_NOT_RESPECTED');
    }
    const byNumber = lookup({lotNumber: references[0].lotNumber}, 2);
    // Известные опубликованные статусы; не полный набор разрешающих подачу кодов.
    const published = lookup({refLotStatusId: [210, 220, 230, 240]}, 20);
    const checks = references.map(function (ref) {
      const row = byId.find(function (item) { return item.id === ref.id; });
      return {expected: ref, publicUrl: 'https://old.goszakup.gov.kz/ru/subpriceoffer/index/' + ref.trdBuyId + '/' + ref.id,
        apiIdentityMatches: Boolean(row && row.lotNumber === ref.lotNumber && row.trdBuyId === ref.trdBuyId),
        apiSample: sample(row)};
    });
    const primary = byId.find(function (row) { return row.id === references[0].id; });
    const portalDates = {publishDate: '2026-10-07 11:28:44', startDate: '2026-10-07 11:30:00',
      endDate: '2026-10-09 11:30:00'};
    const report = {checkedAt: new Date().toISOString(), readOnly: true,
      filtersVerifiedByIntrospection: true, isDeletedFilterAvailable: filterNames.includes('isDeleted'),
      primaryIdRelationVerified: checks[0].apiIdentityMatches && byNumber.some(function (row) {
        return row.id === references[0].id && row.lotNumber === references[0].lotNumber && row.trdBuyId === references[0].trdBuyId;
      }), checks: checks, primaryByNumber: byNumber.map(sample),
      primaryDateComparison: {portalDates: portalDates,
        rawStringsMatch: Boolean(primary && primary.TrdBuy && Object.keys(portalDates).every(function (key) {
          return primary.TrdBuy[key] === portalDates[key];
        })), note: 'Совпадение строк не подтверждает IANA-зону и правила исторических дат.'},
      publishedProbe: {statusIds: [210, 220, 230, 240], limit: 20, returned: published.length,
        deleted: published.filter(function (row) { return row.isDeleted === 1; }).length,
        withTrdBuy: published.filter(function (row) { return Boolean(row.TrdBuy); }).length,
        withPlans: published.filter(function (row) { return Array.isArray(row.Plans) && row.Plans.length; }).length,
        samples: published.filter(function (row) { return row.isDeleted === 0; }).slice(0, 3).map(sample)},
      configurationIssues: v3RuntimeIssues_(config),
      apiDateTimezoneVerified: false, fullActiveStatusSetVerified: false,
      allProcurementMethodUrlsVerified: false, fullCountryCoverageVerified: false, mvpReady: false};
    const safeJson = JSON.stringify(report).split(token).join('[REDACTED]');
    // Console может обрезать длинную строку; нумерованные части можно собрать без потерь.
    for (let offset = 0; offset < safeJson.length; offset += 4000) {
      console.log('STAGE2_JSON_PART_' + (offset / 4000 + 1) + ': ' + safeJson.slice(offset, offset + 4000));
    }
    return JSON.parse(safeJson);
  } catch (error) {
    throw new Error(error.tenderSafeMessage || 'API_STAGE2_DIAGNOSTIC_FAILED: секретные ответы не выводятся.');
  }
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
