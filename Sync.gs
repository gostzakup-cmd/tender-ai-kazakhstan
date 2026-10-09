/** Полный обход: новые записи и обновления ранее сохранённых лотов. */
function syncTenderLots() {
  // До catch: запрет не должен создавать continuation даже при старом state.
  assertApiReady_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    assertSheetsReady_();
    const started = Date.now();
    let state = state_();
    if (!state) {
      state = { version: 1, cursor: null, startedAt: new Date().toISOString(), pages: 0, failures: 0 };
      saveState_(state);
      log_('INFO', 'SYNC_START', 'Начат полный обход API.');
    }
    if (state.version !== 1) throw new Error('Неподдерживаемая версия состояния синхронизации.');
    // Страховка от жёсткого завершения Google без catch/finally.
    scheduleContinuation_(420000);
    while (Date.now() - started < TENDER.budgetMs) {
      const page = fetchGoszakupPage_(state.cursor);
      validatePage_(page, state.cursor);
      const merged = mergeLots_(readLots_(), page.lots, new Date().toISOString(), page.deletedIds);
      replaceRows_('ALL_LOTS', merged);
      SpreadsheetApp.flush(); // Запись данных предшествует продвижению курсора.
      state.pages += 1;
      state.failures = 0;
      if (page.nextCursor === null) {
        refreshViews_();
        SpreadsheetApp.flush();
        log_('INFO', 'SYNC_COMPLETE', 'Страниц: ' + state.pages + '; лотов: ' + merged.length);
        PropertiesService.getScriptProperties().deleteProperty(TENDER.stateKey);
        removeContinuationTriggers_();
        return;
      }
      state.cursor = page.nextCursor;
      saveState_(state);
    }
    refreshViews_();
    scheduleContinuation_(60000);
    log_('INFO', 'SYNC_PAUSED', 'Курсор сохранён; продолжение через минуту.');
  } catch (error) {
    // Не пишем ответ сервера, URL с параметрами, заголовки или ключи в журналы.
    const state = state_();
    if (state) {
      state.failures = (state.failures || 0) + 1;
      saveState_(state);
      if (state.failures <= 3) scheduleContinuation_(Math.max(state.failures * 300000, error.retryAfterMs || 0));
      else removeContinuationTriggers_();
    }
    log_('ERROR', 'SYNC_FAILED', error.tenderSafeMessage || 'Синхронизация остановлена. Курсор сохранён; проверьте настройки/API и повторите запуск.');
    // Ошибка остаётся видимой в Apps Script Executions, без секретного сообщения.
    throw new Error(error.tenderSafeMessage || 'Tender sync failed; see LOGS.');
  } finally {
    lock.releaseLock();
  }
}

function validatePage_(page, cursor) {
  if (!page || !Array.isArray(page.lots) ||
      !(page.nextCursor === null || typeof page.nextCursor === 'string')) {
    throw new Error('Адаптер вернул неверную страницу.');
  }
  if (page.nextCursor !== null && (!page.nextCursor || page.nextCursor === cursor)) {
    throw new Error('API не продвинул курсор; обход остановлен.');
  }
  page.lots.forEach(validateLot_);
  if (page.deletedIds !== undefined && (!Array.isArray(page.deletedIds) ||
      page.deletedIds.some(function (id) { return typeof id !== 'string' || !/^[0-9]+$/.test(id); }))) {
    throw new Error('Неверный список удалённых/исключённых ID.');
  }
}

function dailyTenderSync() { syncTenderLots(); }
function continueTenderSync() { syncTenderLots(); }

function removeContinuationTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'continueTenderSync') ScriptApp.deleteTrigger(trigger);
  });
}

function scheduleContinuation_(delayMs) {
  removeContinuationTriggers_();
  ScriptApp.newTrigger('continueTenderSync').timeBased().after(delayMs).create();
}

function installDailyTrigger() {
  assertSheetsReady_();
  assertApiReady_();
  const hour = dailyHour_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing = ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === 'dailyTenderSync';
    });
    // Сначала создаём новый: при превышении квоты старый сохранится.
    ScriptApp.newTrigger('dailyTenderSync').timeBased().atHour(hour)
      .everyDays(1).inTimezone(TENDER.timezone).create();
    existing.forEach(function (t) { ScriptApp.deleteTrigger(t); });
    log_('INFO', 'TRIGGER_INSTALLED', 'Ежедневно в течение часа ' + hour + ':00, ' + TENDER.timezone);
  } finally {
    lock.releaseLock();
  }
}

function removeTenderTriggers() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (['dailyTenderSync', 'continueTenderSync'].indexOf(t.getHandlerFunction()) !== -1) {
        ScriptApp.deleteTrigger(t);
      }
    });
    log_('INFO', 'TRIGGERS_REMOVED', 'Триггеры Tender AI удалены, данные и курсор сохранены.');
  } finally { lock.releaseLock(); }
}
