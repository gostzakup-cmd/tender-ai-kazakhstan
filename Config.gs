/** Tender AI Kazakhstan — Google Apps Script V8. */
const TENDER = Object.freeze({
  timezone: 'Asia/Almaty',
  maxAmount: 10000000,
  budgetMs: 180000,
  stateKey: 'TENDER_SYNC_STATE',
  sheetIdKey: 'TENDER_SPREADSHEET_ID',
  tokenKey: 'GOSZAKUP_TOKEN',
  legacyTokenKey: 'GOSZAKUP_API_TOKEN',
  apiOrigin: 'https://ows.goszakup.gov.kz',
  apiDocs: 'https://ows.goszakup.gov.kz/help/v3/schema/',
  v3Endpoint: 'https://ows.goszakup.gov.kz/v3/graphql',
  apiStatus: 'V3_RUNTIME_UNVERIFIED',
  headers: [
    'LOT_ID', 'PROCUREMENT_NUMBER', 'LOT_NUMBER', 'PRODUCT_NAME',
    'QUANTITY', 'AMOUNT_KZT', 'CUSTOMER_NAME', 'CUSTOMER_BIN',
    'PUBLISHED_AT', 'APPLICATION_START', 'APPLICATION_DEADLINE',
    'STATUS', 'LOT_URL', 'FIRST_SEEN_AT', 'UPDATED_AT', 'IS_ACTIVE'
  ],
  sheets: ['ALL_LOTS', 'NEW_TODAY', 'ACTIVE_LOTS', 'SETTINGS', 'LOGS']
});

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(TENDER.sheetIdKey);
  if (!id) throw new Error('Сначала выполните setupTenderMvp в привязанном к таблице проекте.');
  return SpreadsheetApp.openById(id);
}

function today_(now) {
  return Utilities.formatDate(now || new Date(), TENDER.timezone, 'yyyy-MM-dd');
}

function setting_(name) {
  const sheet = spreadsheet_().getSheetByName('SETTINGS');
  const rows = sheet.getDataRange().getValues();
  const row = rows.slice(1).find(function (r) { return r[0] === name; });
  if (!row) throw new Error('Отсутствует настройка ' + name);
  return row[1];
}

function dailyHour_() {
  const hour = Number(setting_('DAILY_HOUR'));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('DAILY_HOUR должен быть целым числом от 0 до 23.');
  }
  return hour;
}

/** Не допускаем выполнение формул из названий, полученных извне. */
function safeText_(value) {
  const text = value == null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function state_() {
  const raw = PropertiesService.getScriptProperties().getProperty(TENDER.stateKey);
  return raw ? JSON.parse(raw) : null;
}

function saveState_(state) {
  PropertiesService.getScriptProperties().setProperty(TENDER.stateKey, JSON.stringify(state));
}
