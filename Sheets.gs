function setupTenderMvp() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    if (!book) throw new Error('Откройте проект через Google Sheets → Расширения → Apps Script.');
    const props = PropertiesService.getScriptProperties();
    const oldId = props.getProperty(TENDER.sheetIdKey);
    if (oldId && oldId !== book.getId()) {
      throw new Error('Проект уже привязан к другой таблице; существующая привязка сохранена.');
    }
    props.setProperty(TENDER.sheetIdKey, book.getId());
    TENDER.sheets.forEach(function (name) {
      const sheet = book.getSheetByName(name) || book.insertSheet(name);
      const headers = name === 'SETTINGS' ? ['KEY', 'VALUE', 'DESCRIPTION'] :
        name === 'LOGS' ? ['AT', 'LEVEL', 'EVENT', 'DETAILS'] : TENDER.headers;
      if (sheet.getLastRow() === 0) {
        ensureCapacity_(sheet, 1, headers.length);
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      } else {
        const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
        if (actual.join('|') !== headers.join('|')) {
          throw new Error('Лист ' + name + ' имеет другую структуру; данные не перезаписаны.');
        }
      }
      sheet.setFrozenRows(1);
    });
    const sheet = book.getSheetByName('SETTINGS');
    const existing = new Set(sheet.getDataRange().getValues().slice(1).map(function (r) { return r[0]; }));
    [
      ['DAILY_HOUR', 7, 'Час ежедневного запуска, Asia/Almaty. Google выбирает минуту внутри часа.'],
      ['MAX_LOT_AMOUNT_KZT', TENDER.maxAmount, 'Фиксированный предел для одного лота; не сумма закупки.'],
      ['TIMEZONE', TENDER.timezone, 'Часовой пояс Казахстана, UTC+5.'],
      ['API_STATUS', TENDER.apiStatus, 'Справочно; статус кода смотрите через getTenderStatus.']
    ].forEach(function (row) { if (!existing.has(row[0])) sheet.appendRow(row); });
    log_('INFO', 'SETUP', 'Созданы или проверены пять листов. Настройка не меняет существующие триггеры.');
  } finally {
    lock.releaseLock();
  }
}

function ensureCapacity_(sheet, rows, columns) {
  if (rows > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (columns > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

/** Внутренний формат, а не названия полей Goszakup API. */
function validateLot_(lot) {
  if (!lot || typeof lot.id !== 'string' || !lot.id || !/^[0-9]+$/.test(lot.id)) {
    throw new Error('Неверный внутренний идентификатор лота.');
  }
  if (typeof lot.isGoods !== 'boolean' || typeof lot.isActive !== 'boolean') {
    throw new Error('Адаптер не определил тип предмета или активность лота.');
  }
  ['amount', 'quantity'].forEach(function (key) {
    if (typeof lot[key] !== 'number' || !Number.isFinite(lot[key]) || lot[key] < 0) {
      throw new Error('Неверное числовое значение ' + key + ' у лота ' + lot.id);
    }
  });
  ['procurementNumber', 'lotNumber', 'name', 'customerName', 'customerBin', 'status'].forEach(function (key) {
    if (typeof lot[key] !== 'string') throw new Error('Неверный внутренний атрибут ' + key);
  });
  ['publishedAt', 'applicationStart', 'deadline'].forEach(function (key) {
    if (key !== 'publishedAt' && lot[key] === '') return;
    // Дата без смещения неоднозначна. Адаптер должен применять документированную зону API.
    if (typeof lot[key] !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(lot[key]) ||
        !Number.isFinite(Date.parse(lot[key]))) throw new Error('Неверная дата ' + key + ' у лота ' + lot.id);
  });
  if (typeof lot.url !== 'string' || !/^https:\/\/(?:www\.|old\.)?goszakup\.gov\.kz\//.test(lot.url)) {
    throw new Error('Неверная официальная ссылка у лота ' + lot.id);
  }
  return lot;
}

function eligible_(lot) { return lot.isGoods && lot.amount <= TENDER.maxAmount; }

function lotRow_(lot, firstSeen, now) {
  return [lot.id, lot.procurementNumber, lot.lotNumber, lot.name,
    lot.quantity, lot.amount, lot.customerName, lot.customerBin,
    lot.publishedAt, lot.applicationStart, lot.deadline, lot.status, lot.url,
    firstSeen, now, lot.isActive].map(function (v) { return typeof v === 'string' ? safeText_(v) : v; });
}

function readLots_() {
  return spreadsheet_().getSheetByName('ALL_LOTS').getDataRange().getValues().slice(1)
    .filter(function (row) { return row[0] !== ''; });
}

/** Повторная запись страницы безопасна после сбоя перед сохранением курсора. */
function mergeLots_(rows, lots, now, deletedIds) {
  const byId = new Map();
  rows.forEach(function (row) {
    const id = String(row[0]);
    if (byId.has(id)) throw new Error('В ALL_LOTS уже есть дубликат LOT_ID=' + id);
    byId.set(id, row);
  });
  // Сначала проверяем ВСЮ страницу: дефектный ответ не должен частично менять таблицу.
  lots.forEach(validateLot_);
  (deletedIds || []).forEach(function (id) {
    if (typeof id !== 'string' || !/^[0-9]+$/.test(id)) throw new Error('Неверный ID удалённого/исключённого лота.');
    byId.delete(id);
  });
  lots.forEach(function (lot) {
    if (!eligible_(lot)) { byId.delete(lot.id); return; }
    const previous = byId.get(lot.id);
    byId.set(lot.id, lotRow_(lot, previous ? previous[13] : now, now));
  });
  return Array.from(byId.values());
}

function replaceRows_(name, rows) {
  if (name === 'ALL_LOTS') {
    writeAllLots_(rows);
    return;
  }
  const sheet = spreadsheet_().getSheetByName(name);
  const previousLength = Math.max(0, sheet.getLastRow() - 1);
  ensureCapacity_(sheet, rows.length + 1, TENDER.headers.length);
  if (rows.length) {
    formatLotTextColumns_(sheet, rows.length);
    sheet.getRange(2, 1, rows.length, TENDER.headers.length).setValues(rows);
  }
  if (previousLength > rows.length) {
    sheet.getRange(rows.length + 2, 1, previousLength - rows.length, TENDER.headers.length).clearContent();
  }
}

/**
 * Стабильные физические строки: удаление не сдвигает ID остальных лотов.
 * Один setValues обновляет записи и очищает удалённые, без опасного
 * промежутка между уплотнением таблицы и отдельным clearContent хвоста.
 */
function writeAllLots_(rows) {
  const sheet = spreadsheet_().getSheetByName('ALL_LOTS');
  const desired = new Map(rows.map(function (r) { return [String(r[0]), r]; }));
  const previous = sheet.getDataRange().getValues().slice(1);
  const output = previous.map(function (r) {
    const id = String(r[0]);
    if (id && desired.has(id)) {
      const updated = desired.get(id);
      desired.delete(id);
      return updated;
    }
    return new Array(TENDER.headers.length).fill('');
  });
  desired.forEach(function (r) { output.push(r); });
  if (output.length) {
    ensureCapacity_(sheet, output.length + 1, TENDER.headers.length);
    formatLotTextColumns_(sheet, output.length);
    sheet.getRange(2, 1, output.length, TENDER.headers.length).setValues(output);
  }
}

function formatLotTextColumns_(sheet, rowCount) {
  // Сохраняем ведущие нули БИН и точность больших ID при записи в Google.
  sheet.getRange(2, 1, rowCount, 4).setNumberFormat('@');
  sheet.getRange(2, 7, rowCount, 9).setNumberFormat('@');
}

function refreshViews_() {
  const rows = readLots_();
  const now = new Date();
  const day = today_(now);
  replaceRows_('NEW_TODAY', rows.filter(function (r) {
    return today_(new Date(r[8])) === day;
  }));
  replaceRows_('ACTIVE_LOTS', rows.filter(function (r) {
    // Статус API и открытый интервал подачи; завершённые/отменённые не активны.
    return r[15] === true && Date.parse(r[9]) <= now.getTime() && Date.parse(r[10]) > now.getTime();
  }));
}

function log_(level, event, details) {
  spreadsheet_().getSheetByName('LOGS').appendRow([
    new Date().toISOString(), level, event, safeText_(details)
  ]);
}
