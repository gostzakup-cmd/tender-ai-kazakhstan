// Local test harness only. No real API calls, credentials or Google writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

function harness() {
  let time = Date.parse('2026-10-08T08:00:00+05:00');
  let locked = false;
  let flushFails = false;
  let nextTriggerFails = false;
  const properties = new Map();
  const sheets = new Map();
  const triggers = [];
  const responses = [];
  const fetchCalls = [];
  const sleeps = [];
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.maxRows = 100; this.maxCols = 26; }
    getLastRow() { return this.rows.length; }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    insertRowsAfter(after, n) { this.maxRows += n; }
    insertColumnsAfter(after, n) { this.maxCols += n; }
    setFrozenRows() {}
    appendRow(row) { this.rows.push([...row]); }
    getDataRange() { return { getValues: () => this.rows.map(r => [...r]) }; }
    getRange(row, col, height, width) {
      return {
        setNumberFormat: () => {},
        getValues: () => Array.from({length: height}, (_, i) =>
          Array.from({length: width}, (_, j) => this.rows[row - 1 + i]?.[col - 1 + j] ?? '')),
        setValues: values => {
          assert.equal(values.length, height);
          values.forEach((r, i) => {
            assert.equal(r.length, width);
            this.rows[row - 1 + i] ||= [];
            r.forEach((v, j) => { this.rows[row - 1 + i][col - 1 + j] = v; });
          });
        },
        clearContent: () => {
          for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
              if (this.rows[row - 1 + i]) this.rows[row - 1 + i][col - 1 + j] = '';
            }
          }
          while (this.rows.length && this.rows.at(-1).every(v => v === '')) this.rows.pop();
        }
      };
    }
  }
  const book = {
    getId: () => 'test-book',
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => { const s = new Sheet(name); sheets.set(name, s); return s; }
  };
  const props = {
    getProperty: key => properties.get(key) ?? null,
    setProperty: (key, value) => properties.set(key, value),
    deleteProperty: key => properties.delete(key)
  };
  const context = vm.createContext({
    Date: TestDate,
    console: { log: () => {} },
    PropertiesService: { getScriptProperties: () => props },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => book,
      openById: id => { assert.equal(id, 'test-book'); return book; },
      flush: () => { if (flushFails) { flushFails = false; throw new Error('test flush failure'); } }
    },
    LockService: { getScriptLock: () => ({
      tryLock: () => !locked,
      waitLock: () => { if (locked) throw new Error('locked'); },
      releaseLock: () => {}
    }) },
    Utilities: {
      DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'UTF-8'},
      computeDigest: (algorithm, value) => Array.from(crypto.createHash(algorithm).update(value).digest()),
      parseDate: (value, zone, format) => {
        assert.equal(zone, 'Asia/Almaty'); assert.equal(format, 'yyyy-MM-dd HH:mm:ss');
        return new Date(value.replace(' ', 'T') + '+05:00');
      },
      formatDate: (date, zone, format) => {
        assert.equal(zone, 'Asia/Almaty');
        if (format === 'yyyy-MM-dd HH:mm:ss') return new Date(date.getTime() + 5 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
        assert.equal(format, 'yyyy-MM-dd');
        return new Date(date.getTime() + 5 * 3600000).toISOString().slice(0, 10);
      },
      sleep: ms => sleeps.push(ms)
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1),
      newTrigger: handler => {
        const data = { handler, getHandlerFunction: () => handler };
        const chain = {
          timeBased: () => chain,
          after: ms => { data.delay = ms; return chain; },
          atHour: hour => { data.hour = hour; return chain; },
          everyDays: days => { data.days = days; return chain; },
          inTimezone: zone => { data.zone = zone; return chain; },
          create: () => {
            if (nextTriggerFails) { nextTriggerFails = false; throw new Error('quota'); }
            triggers.push(data); return data;
          }
        };
        return chain;
      }
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        fetchCalls.push({url, options});
        const response = responses.shift();
        if (response instanceof Error) throw response;
        if (!response) throw new Error('No mock response');
        return {
          getResponseCode: () => response.status,
          getContentText: () => response.body,
          getAllHeaders: () => response.headers || {}
        };
      }
    }
  });
  for (const name of ['Config.gs', 'Sheets.gs', 'Api.gs', 'V3.gs', 'Sync.gs', 'Diagnostics.gs', 'SelfTests.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, {filename: name});
  }
  return {
    c: context, sheets, triggers, properties, responses, fetchCalls, sleeps,
    advance: ms => { time += ms; },
    lock: () => { locked = true; },
    failFlush: () => { flushFails = true; },
    failNextTrigger: () => { nextTriggerFails = true; },
    setup: () => context.setupTenderMvp(),
    api: fetchPage => { context.assertApiReady_ = () => {}; context.fetchGoszakupPage_ = fetchPage; }
  };
}

// Entirely invented INTERNAL fixture; this is not an asserted Goszakup response.
function lot(id = '101', overrides = {}) {
  return {
    id, procurementNumber: 'TEST-P-1', lotNumber: 'TEST-L-' + id,
    name: 'Тестовый товар', quantity: 2, amount: 10000000,
    customerName: 'Тестовый заказчик', customerBin: '000000000001',
    publishedAt: '2026-10-08T07:00:00+05:00',
    applicationStart: '2026-10-08T07:30:00+05:00',
    deadline: '2026-10-10T18:00:00+05:00',
    status: 'INTERNAL_TEST_OPEN', url: 'https://goszakup.gov.kz/test-only/' + id,
    isGoods: true, isActive: true, ...overrides
  };
}
function data(h, name = 'ALL_LOTS') { return h.sheets.get(name).rows.slice(1); }
function json(value) { return JSON.parse(JSON.stringify(value)); }
const now = '2026-10-08T03:00:00Z';

test('setup creates five sheets and is repeatable without losing data/settings', () => {
  const h = harness(); h.setup();
  h.sheets.get('SETTINGS').rows[1][1] = 9;
  h.c.replaceRows_('ALL_LOTS', h.c.mergeLots_([], [lot()], now));
  h.setup();
  assert.equal(h.sheets.size, 5);
  assert.equal(data(h).length, 1);
  assert.equal(h.c.dailyHour_(), 9);
  assert.equal(h.triggers.length, 0);
});

test('setup does not overwrite an incompatible sheet', () => {
  const h = harness(); h.setup();
  h.sheets.get('ALL_LOTS').rows[0][0] = 'USER_DATA';
  assert.throws(() => h.setup(), /другую структуру/);
  assert.equal(h.sheets.get('ALL_LOTS').rows[0][0], 'USER_DATA');
});

test('inclusive per-lot limit accepts 10M and rejects expensive/non-goods lots', () => {
  const h = harness();
  const rows = h.c.mergeLots_([], [lot(), lot('102', {amount: 10000000.01}),
    lot('103', {isGoods: false}), lot('104', {amount: 0})], now);
  assert.deepEqual(json(rows.map(r => r[0])), ['101', '104']);
});

test('replay and updates deduplicate ID while preserving first discovery', () => {
  const h = harness();
  const first = h.c.mergeLots_([], [lot(), lot()], now);
  const updated = h.c.mergeLots_(first, [lot('101', {name: 'Обновлённый', amount: 500})], 'later');
  assert.equal(updated.length, 1);
  assert.equal(updated[0][3], 'Обновлённый');
  assert.equal(updated[0][5], 500);
  assert.equal(updated[0][13], now);
  assert.equal(updated[0][14], 'later');
});

test('changed eligibility removes an already stored lot', () => {
  const h = harness();
  const first = h.c.mergeLots_([], [lot()], now);
  assert.equal(h.c.mergeLots_(first, [lot('101', {amount: 10000001})], now).length, 0);
  assert.equal(h.c.mergeLots_(first, [lot('101', {isGoods: false})], now).length, 0);
});

test('invalid page data cannot partially mutate previous rows', () => {
  const h = harness();
  const first = h.c.mergeLots_([], [lot()], now);
  assert.throws(() => h.c.mergeLots_(first,
    [lot('101', {name: 'Changed'}), lot('102', {amount: NaN})], now), /числовое/);
  assert.equal(first[0][3], 'Тестовый товар');
});

test('bad IDs, missing booleans, negative quantity and ambiguous dates rejected', () => {
  const h = harness();
  for (const bad of [{id: '1e3'}, {isGoods: undefined}, {isActive: null},
    {quantity: -1}, {publishedAt: '2026-10-08 08:00:00'}, {amount: '10000000'},
    {url: 'https://goszakup.gov.kz.evil.example/a'}]) {
    assert.throws(() => h.c.validateLot_(lot('101', bad)));
  }
});

test('pre-existing duplicate IDs stop the merge', () => {
  const h = harness(); const rows = h.c.mergeLots_([], [lot()], now);
  assert.throws(() => h.c.mergeLots_([rows[0], rows[0]], [], now), /дубликат/);
});

test('external text cannot inject formulas', () => {
  const h = harness();
  const rows = h.c.mergeLots_([], [lot('101', {name: '=IMPORTXML("secret")'})], now);
  assert.equal(rows[0][3], '\'=IMPORTXML("secret")');
});

test('NEW_TODAY uses Kazakhstan publication day, ACTIVE uses status and interval', () => {
  const h = harness(); h.setup();
  h.c.replaceRows_('ALL_LOTS', h.c.mergeLots_([], [lot(),
    lot('102', {publishedAt: '2026-10-07T23:30:00Z', isActive: false}),
    lot('103', {publishedAt: '2026-10-07T01:00:00+05:00', deadline: '2026-10-08T07:59:00+05:00'}),
    lot('104', {applicationStart: '2026-10-09T00:00:00+05:00'})], now));
  h.c.refreshViews_();
  assert.deepEqual(data(h, 'NEW_TODAY').map(r => r[0]), ['101', '102', '104']);
  assert.deepEqual(data(h, 'ACTIVE_LOTS').map(r => r[0]), ['101']);
});

test('empty intermediate page does not stop full pagination', () => {
  const h = harness(); h.setup();
  const cursors = [];
  h.api(cursor => {
    cursors.push(cursor);
    if (cursor === null) return {lots: [lot()], nextCursor: 'a'};
    if (cursor === 'a') return {lots: [], nextCursor: 'b'};
    return {lots: [lot('102'), lot('101', {amount: 100})], nextCursor: null};
  });
  h.c.syncTenderLots();
  assert.deepEqual(cursors, [null, 'a', 'b']);
  assert.equal(data(h).length, 2);
  assert.equal(data(h)[0][5], 100);
  assert.equal(h.c.state_(), null);
  assert.equal(h.triggers.length, 0);
  assert.equal(h.sheets.get('LOGS').rows.at(-1)[2], 'SYNC_COMPLETE');
});

test('budget exhaustion checkpoints and resumes the next page', () => {
  const h = harness(); h.setup(); const cursors = [];
  h.api(cursor => {
    cursors.push(cursor);
    if (cursor === null) { h.advance(180001); return {lots: [lot()], nextCursor: 'a'}; }
    return {lots: [lot('102')], nextCursor: null};
  });
  h.c.syncTenderLots();
  assert.equal(h.c.state_().cursor, 'a');
  assert.equal(h.triggers.length, 1);
  assert.equal(h.triggers[0].delay, 60000);
  h.c.continueTenderSync();
  assert.deepEqual(cursors, [null, 'a']);
  assert.equal(data(h).length, 2);
  assert.equal(h.c.state_(), null);
});

test('failure after sheet write preserves cursor; replay creates no duplicate', () => {
  const h = harness(); h.setup(); const cursors = [];
  h.api(cursor => {
    cursors.push(cursor);
    return cursor === null ? {lots: [lot()], nextCursor: 'a'} : {lots: [], nextCursor: null};
  });
  h.failFlush();
  assert.throws(() => h.c.syncTenderLots(), /Tender sync failed/);
  assert.equal(h.c.state_().cursor, null);
  assert.equal(data(h).length, 1);
  h.c.syncTenderLots();
  assert.deepEqual(cursors, [null, null, 'a']);
  assert.equal(data(h).length, 1);
  assert.equal(h.c.state_(), null);
});

test('unchanged cursor and malformed page cannot be marked complete', () => {
  const h = harness();
  assert.throws(() => h.c.validatePage_({lots: [], nextCursor: 'a'}, 'a'), /курсор/);
  assert.throws(() => h.c.validatePage_({lots: []}, null), /страницу/);
  assert.throws(() => h.c.validatePage_({lots: [], nextCursor: ''}, null), /курсор/);
});

test('concurrent invocation does not fetch or create triggers', () => {
  const h = harness(); h.setup(); h.lock();
  h.api(() => { throw new Error('must not fetch'); });
  h.c.syncTenderLots();
  assert.equal(h.c.state_(), null);
  assert.equal(h.triggers.length, 0);
});

test('daily trigger setup is repeatable and preserves unrelated triggers', () => {
  const h = harness(); h.setup(); h.api(() => {});
  h.c.ScriptApp.newTrigger('userTask').timeBased().after(1000).create();
  h.c.installDailyTrigger(); h.c.installDailyTrigger();
  assert.equal(h.triggers.filter(t => t.handler === 'dailyTenderSync').length, 1);
  assert.equal(h.triggers.find(t => t.handler === 'dailyTenderSync').zone, 'Asia/Almaty');
  h.c.removeTenderTriggers();
  assert.deepEqual(h.triggers.map(t => t.handler), ['userTask']);
});

test('failed daily trigger replacement retains original trigger', () => {
  const h = harness(); h.setup(); h.api(() => {}); h.c.installDailyTrigger();
  const original = h.triggers[0]; h.failNextTrigger();
  assert.throws(() => h.c.installDailyTrigger(), /quota/);
  assert.equal(h.triggers[0], original);
});

test('unverified production adapter blocks sync and daily trigger creation', () => {
  const h = harness(); h.setup();
  assert.throws(() => h.c.syncTenderLots(), /API_TOKEN_MISSING/);
  assert.throws(() => h.c.installDailyTrigger(), /API_TOKEN_MISSING/);
  assert.equal(h.triggers.length, 0);
  assert.equal(data(h).length, 0);
});

test('HTTP 429 and 503 retry then parse JSON with TLS verification enabled', () => {
  const h = harness();
  h.responses.push({status: 429, headers: {'Retry-After': '2'}},
    {status: 503}, {status: 200, body: '{"test":true}'});
  assert.equal(h.c.fetchJsonWithRetry_('https://ows.goszakup.gov.kz/test-only').test, true);
  assert.deepEqual(h.sleeps, [2000, 2000]);
  assert.equal(h.fetchCalls.length, 3);
  for (const call of h.fetchCalls) {
    assert.equal(call.options.validateHttpsCertificates, true);
    assert.equal(call.options.followRedirects, false);
  }
});

test('HTTP auth failure does not retry or disclose secret response', () => {
  const h = harness(); h.responses.push({status: 401, body: 'TOP_SECRET'});
  assert.throws(() => h.c.fetchJsonWithRetry_('https://ows.goszakup.gov.kz/test-only'),
    e => e.message.includes('API_HTTP_401') && !e.message.includes('TOP_SECRET'));
  assert.equal(h.fetchCalls.length, 1);
});

test('network exceptions retry four times without disclosing original error', () => {
  const h = harness(); h.responses.push(...Array.from({length: 4}, () => new Error('TOP_SECRET')));
  assert.throws(() => h.c.fetchJsonWithRetry_('https://ows.goszakup.gov.kz/test-only'), /API_NETWORK_ERROR/);
  assert.equal(h.fetchCalls.length, 4);
});

test('invalid JSON cannot be treated as an empty last page', () => {
  const h = harness(); h.responses.push({status: 200, body: '<html>not JSON</html>'});
  assert.throws(() => h.c.fetchJsonWithRetry_('https://ows.goszakup.gov.kz/test-only'), /API_INVALID_JSON/);
});

test('long Retry-After defers instead of sleeping past Apps Script budget', () => {
  const h = harness(); h.responses.push({status: 429, headers: {'retry-after': '900'}});
  assert.throws(() => h.c.fetchJsonWithRetry_('https://ows.goszakup.gov.kz/test-only'),
    e => e.retryAfterMs === 900000);
  assert.equal(h.sleeps.length, 0);
});

test('HTTP helper rejects unrelated hosts and deceptive hostname prefixes', () => {
  const h = harness();
  for (const url of ['http://ows.goszakup.gov.kz/a',
    'https://ows.goszakup.gov.kz.evil.example/a', 'https://example.com']) {
    assert.throws(() => h.c.fetchJsonWithRetry_(url), /официальный HTTPS/);
  }
  assert.equal(h.fetchCalls.length, 0);
});

test('manifest has V8 and required Google service scopes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.timeZone, 'Asia/Almaty');
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp'
  ]);
});

// Published fragment from official /help, not an authenticated live response.
const officialExample = JSON.parse(fs.readFileSync(
  path.join(root, 'tests/fixtures/official-help-lots.json'), 'utf8'));
function authorize(h) { h.properties.set('GOSZAKUP_API_TOKEN', 'TEST_ONLY_SECRET'); }
function rawResponse(h, payload) { h.responses.push({status: 200, body: JSON.stringify(payload)}); }

test('published official /lots example parses and uses documented Bearer header', () => {
  const h = harness(); authorize(h); rawResponse(h, officialExample);
  const page = h.c.fetchGoszakupRawPage_(null);
  assert.equal(page.items[0].lot_number, '4497906-АУК1');
  assert.equal(page.nextCursor, '/lots?page=next&search_after=836127');
  assert.equal(h.fetchCalls[0].url, 'https://ows.goszakup.gov.kz/lots');
  assert.equal(h.fetchCalls[0].options.headers.Authorization, 'Bearer TEST_ONLY_SECRET');
});

test('missing token stops connection test before any HTTP request', () => {
  const h = harness(); h.setup();
  assert.throws(() => h.c.testGoszakupConnection(), /API_TOKEN_MISSING/);
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.sheets.get('LOGS').rows.at(-1)[2], 'API_CONNECTION_FAILED');
});

test('CONNECT 403 is diagnosed as proxy failure, without accusing token or retrying', () => {
  const h = harness(); h.setup(); authorize(h);
  h.responses.push(new Error('CONNECT tunnel failed, response 403 TEST_ONLY_SECRET'));
  assert.throws(() => h.c.testGoszakupConnection(),
    e => /API_PROXY_CONNECT_403/.test(e.message) && !/TEST_ONLY_SECRET/.test(e.message));
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.sleeps.length, 0);
  assert.ok(!JSON.stringify(h.sheets.get('LOGS').rows).includes('TEST_ONLY_SECRET'));
});

test('HTTP 403 response remains distinct from CONNECT 403', () => {
  const h = harness(); authorize(h);
  h.responses.push({status: 403, body: 'TEST_ONLY_SECRET'});
  assert.throws(() => h.c.fetchGoszakupRawPage_(null),
    e => /API_HTTP_403/.test(e.message) && !/API_PROXY_CONNECT_403/.test(e.message));
});

test('connection test checks two mocked pages without writing lots or installing triggers', () => {
  const h = harness(); h.setup(); authorize(h);
  rawResponse(h, officialExample);
  // Second page is explicitly SYNTHETIC using documented field names.
  rawResponse(h, {...officialExample, next_page: '',
    items: [{...officialExample.items[0], id: 836126}]});
  const report = h.c.testGoszakupConnection();
  assert.equal(report.connectionOk, true);
  assert.equal(report.mvpReady, false);
  assert.equal(report.pagesChecked, 2);
  assert.equal(report.itemsChecked, 2);
  assert.equal(report.fullPaginationChecked, false);
  assert.equal(report.paginationEndReached, true);
  assert.equal(h.fetchCalls[1].url,
    'https://ows.goszakup.gov.kz/lots?page=next&search_after=836127');
  assert.equal(data(h).length, 0);
  assert.equal(h.c.state_(), null);
  assert.equal(h.triggers.length, 0);
  assert.ok(!JSON.stringify(h.sheets.get('LOGS').rows).includes('TEST_ONLY_SECRET'));
});

test('same IDs on consecutive diagnostic pages are reported as overlap', () => {
  const h = harness(); h.setup(); authorize(h);
  rawResponse(h, officialExample);
  rawResponse(h, {...officialExample, next_page: ''});
  assert.throws(() => h.c.testGoszakupConnection(), /API_PAGE_OVERLAP/);
});

test('missing next_page and non-JSON contract cannot mean end of pagination', () => {
  const h = harness(); authorize(h);
  const payload = {...officialExample}; delete payload.next_page;
  rawResponse(h, payload);
  assert.throws(() => h.c.fetchGoszakupRawPage_(null), /API_SCHEMA_MISMATCH/);
});

test('raw API fields are checked against official schema', () => {
  const h = harness(); authorize(h);
  const item = {...officialExample.items[0]}; delete item.lot_number;
  rawResponse(h, {...officialExample, items: [item]});
  assert.throws(() => h.c.fetchGoszakupRawPage_(null), /API_SCHEMA_MISMATCH/);
});

test('opaque next_page cannot exfiltrate authorization to another host or endpoint', () => {
  const h = harness(); authorize(h);
  for (const next of ['https://evil.example/lots?page=next&search_after=1',
    '/subject?page=next&search_after=1', '/lots?page=next&search_after=1&token=secret',
    '/lots?page=next&page=next&search_after=1']) {
    rawResponse(h, {...officialExample, next_page: next});
    assert.throws(() => h.c.fetchGoszakupRawPage_(null), /API_CURSOR_INVALID/);
  }
  assert.equal(h.fetchCalls.length, 4); // Initial /lots only; malicious cursor never requested.
});

test('canonical cursor detects stalled pagination even if parameters are reordered', () => {
  const h = harness(); authorize(h);
  rawResponse(h, {...officialExample, next_page: '/lots?search_after=836127&page=next'});
  assert.throws(() => h.c.fetchGoszakupRawPage_('/lots?page=next&search_after=836127'), /API_CURSOR_STALLED/);
});

test('source IDs larger than JS safe integer are rejected instead of rounded', () => {
  const h = harness();
  assert.throws(() => h.c.sourceId_(Number.MAX_SAFE_INTEGER + 1), /точным целым/);
  assert.equal(h.c.sourceId_('9007199254740993'), '9007199254740993');
});

test('status exposes only secret presence and reports incomplete MVP accurately', () => {
  const h = harness(); h.setup(); authorize(h);
  const report = h.c.getTenderStatus();
  assert.equal(report.tokenPresent, true);
  assert.equal(report.sheetsReady, true);
  assert.equal(report.apiStatus, 'V3_CONFIG_REQUIRED');
  assert.equal(report.mvpReady, false);
  assert.ok(!JSON.stringify(report).includes('TEST_ONLY_SECRET'));
});

test('Apps Script self-tests run all twelve cases without API calls or Sheet writes', () => {
  const h = harness();
  const report = h.c.runTenderSelfTests();
  assert.equal(report.passed, 12);
  assert.equal(report.total, 12);
  assert.equal(report.apiTested, false);
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.sheets.size, 0);
});

test('canonical storage deletes without shifting other IDs or duplicating a stale tail', () => {
  const h = harness(); h.setup();
  h.c.replaceRows_('ALL_LOTS', h.c.mergeLots_([], [lot('101'), lot('102'), lot('103')], now));
  const changed = h.c.mergeLots_(h.c.readLots_(), [lot('101', {isGoods: false}), lot('104')], now);
  h.c.replaceRows_('ALL_LOTS', changed);
  const physical = h.sheets.get('ALL_LOTS').rows;
  assert.equal(physical[1][0], '');
  assert.equal(physical[2][0], '102');
  assert.equal(physical[3][0], '103');
  assert.equal(physical[4][0], '104');
  h.c.replaceRows_('ALL_LOTS', h.c.mergeLots_(h.c.readLots_(), [lot('101', {isGoods: false}), lot('104')], now));
  assert.deepEqual(json(h.c.readLots_().map(r => r[0])), ['102', '103', '104']);
});

// SYNTHETIC live replies built with field/type names from saved official SDL.
function introspectionFromOfficialSdl() {
  const scalars = ['Int', 'Float', 'String', 'Boolean', 'ID'];
  function ref(type) {
    if (type.startsWith('[')) return {kind: 'LIST', name: null, ofType: ref(type.slice(1, -1))};
    return {kind: scalars.includes(type) ? 'SCALAR' : 'OBJECT', name: type, ofType: null};
  }
  const data = {__schema: {queryType: {name: 'Query'}}};
  ['query', 'lots', 'trdbuy', 'plnpoint', 'reflotsstatus'].forEach((file, i) => {
    const sdl = fs.readFileSync(path.join(root, 'docs/v3-schema', file + '.graphql'), 'utf8');
    const typeName = sdl.match(/^type\s+(\w+)/)[1];
    const fields = sdl.split('\n').map(line => line.match(/^(\w+)(?:\(([^)]*)\))?:\s*(\[?\w+\]?)/)).filter(Boolean)
      .map(m => ({name: m[1], type: ref(m[3]), args: (m[2] || '').split(',').filter(Boolean).map(arg => {
        const match = arg.trim().match(/^(\w+):\s*(\[?\w+\]?)/);
        return {name: match[1], type: ref(match[2])};
      })}));
    data['t' + i] = {name: typeName, fields};
  });
  return data;
}
function configureV3(h, runtime = true) {
  authorize(h);
  // Test-only URL, never supplied as a production default or verified endpoint.
  h.properties.set('GOSZAKUP_V3_ENDPOINT', 'https://ows.goszakup.gov.kz/test-only-graphql');
  if (runtime) {
    h.properties.set('GOSZAKUP_API_DATE_TIMEZONE', 'Asia/Almaty');
    h.properties.set('GOSZAKUP_ACTIVE_STATUS_CODES', '["INTERNAL_TEST_OPEN"]');
    h.properties.set('GOSZAKUP_LOT_URL_TEMPLATE', 'https://goszakup.gov.kz/test-only/{trdBuyId}/lot/{id}');
  }
  return h.c.v3Config_();
}
function v3Lot(id = 102, overrides = {}) {
  return {
    id, lotNumber: 'TEST-' + id, trdBuyNumberAnno: 'TEST-ANNOUNCEMENT',
    nameRu: 'Тестовый товар', nameKz: 'Тест', count: 2, amount: 10000000,
    customerNameRu: 'Тестовый заказчик', customerNameKz: 'Тест', customerBin: '000000000001',
    trdBuyId: 555, isDeleted: 0, pointList: [777], refLotStatusId: 240,
    Plans: [{id: 777, refSubjectTypeId: 1, amount: 999999999}],
    TrdBuy: {publishDate: '2026-10-08 07:00:00', startDate: '2026-10-08 07:30:00',
      endDate: '2026-10-10 18:00:00', repeatStartDate: null, repeatEndDate: null, totalSum: 999999999},
    RefLotsStatus: {code: 'INTERNAL_TEST_OPEN', nameRu: 'Тестовый статус'}, ...overrides
  };
}
function graphResponse(h, data, errors, pageInfo) {
  rawResponse(h, {data, ...(errors ? {errors} : {}), ...(Array.isArray(data.Lots) ? {
    extensions: {pageInfo: pageInfo || {limitPage: 100, totalCount: 1000,
      hasNextPage: data.Lots.length > 0, lastId: data.Lots.length ? data.Lots.at(-1).id : null}}
  } : {})});
}

test('V3 field paths and scalar types match published official SDL', () => {
  const h = harness(), config = configureV3(h);
  graphResponse(h, introspectionFromOfficialSdl());
  const mapping = h.c.inspectV3Schema_(config);
  assert.deepEqual(json(mapping.find(x => x.target === 'amount')), {target: 'amount', path: 'amount', type: 'Float'});
  assert.deepEqual(json(mapping.find(x => x.target === 'quantity')), {target: 'quantity', path: 'count', type: 'Float'});
  assert.equal(h.fetchCalls[0].options.method, 'post');
});

test('V3 adapter uses Lots.amount/count, ignoring plan and announcement amounts', () => {
  const h = harness(), config = configureV3(h);
  const normalized = h.c.normalizeV3Lot_(v3Lot(), config).lot;
  assert.equal(normalized.amount, 10000000);
  assert.equal(normalized.quantity, 2);
  assert.equal(normalized.procurementNumber, 'TEST-ANNOUNCEMENT');
  assert.equal(normalized.customerBin, '000000000001');
  assert.equal(normalized.publishedAt, '2026-10-08T02:00:00.000Z');
});

test('V3 source money/quantity cannot be mapped to Plans or TrdBuy', () => {
  const h = harness(); configureV3(h);
  h.properties.set('GOSZAKUP_V3_FIELD_MAP', '{"amount":"Plans.amount"}');
  assert.throws(() => h.c.v3Config_(), /API_LOT_VALUES_REQUIRED/);
});

test('configurable field mapping rejects unknown targets, injected query syntax and prototype paths', () => {
  const h = harness(); configureV3(h);
  for (const mapping of [{madeUp: 'id'}, {name: 'nameRu } token {'}, {name: '__proto__.name'}]) {
    h.properties.set('GOSZAKUP_V3_FIELD_MAP', JSON.stringify(mapping));
    assert.throws(() => h.c.v3Config_(), /API_FIELD_MAP_INVALID/);
  }
});

test('V3 pagination continues after short pages while documented hasNextPage is true', () => {
  const h = harness(), config = configureV3(h);
  graphResponse(h, {Lots: [v3Lot(102), v3Lot(101)]});
  graphResponse(h, {Lots: [v3Lot(100)]});
  graphResponse(h, {Lots: []});
  const first = h.c.v3RawPage_(config, null);
  const second = h.c.v3RawPage_(config, first.nextCursor);
  assert.ok(second.nextCursor);
  assert.equal(h.c.v3RawPage_(config, second.nextCursor).nextCursor, null);
  assert.deepEqual(h.fetchCalls.map(x => JSON.parse(x.options.payload).variables.after), [null, 101, 100]);
});

test('V3 rejects repeated IDs, cyclic/reversed order and changed cursor configuration', () => {
  const h = harness(), config = configureV3(h);
  graphResponse(h, {Lots: [v3Lot(102), v3Lot(101)]});
  const first = h.c.v3RawPage_(config, null);
  graphResponse(h, {Lots: [v3Lot(101)]});
  assert.throws(() => h.c.v3RawPage_(config, first.nextCursor), /API_V3_PAGINATION_ORDER/);
  graphResponse(h, {Lots: [v3Lot(103)]});
  assert.throws(() => h.c.v3RawPage_(config, first.nextCursor), /API_V3_PAGINATION_ORDER/);
  h.properties.set('GOSZAKUP_PAGE_SIZE', '50');
  assert.throws(() => h.c.v3RawPage_(h.c.v3Config_(), first.nextCursor), /API_V3_CURSOR_INVALID/);
});

test('GraphQL HTTP 200 with errors never becomes a successful empty page', () => {
  const h = harness(), config = configureV3(h);
  graphResponse(h, {Lots: []}, [{message: 'TEST_ONLY_SECRET'}]);
  assert.throws(() => h.c.v3RawPage_(config, null), e => /API_GRAPHQL_ERRORS/.test(e.message) && !/TEST_ONLY_SECRET/.test(e.message));
});

test('deleted, non-goods and over-budget V3 lots remove existing rows without inventing dates', () => {
  const h = harness(), config = configureV3(h);
  for (const raw of [v3Lot(102, {isDeleted: 1, Plans: null}),
    v3Lot(102, {Plans: [{id: 777, refSubjectTypeId: 3}]}), v3Lot(102, {amount: 10000001})]) {
    assert.equal(h.c.normalizeV3Lot_(raw, config).deletedId, '102');
  }
  assert.equal(h.c.mergeLots_(h.c.mergeLots_([], [lot('102')], now), [], now, ['102']).length, 0);
});

test('incomplete Plans/pointList cannot silently classify a lot as goods', () => {
  const h = harness(), config = configureV3(h);
  assert.throws(() => h.c.normalizeV3Lot_(v3Lot(102, {Plans: []}), config), /API_LOT_SUBJECT_TYPE_UNVERIFIED/);
  assert.throws(() => h.c.normalizeV3Lot_(v3Lot(102, {pointList: [777, 888]}), config), /API_LOT_SUBJECT_TYPE_UNVERIFIED/);
});

test('V3 dates without offset require a configured source timezone', () => {
  const h = harness();
  assert.throws(() => h.c.apiDate_('2026-10-08 08:00:00', '', false), /TIMEZONE_REQUIRED/);
  assert.equal(h.c.apiDate_('2026-10-08T08:00:00+05:00', '', false), '2026-10-08T03:00:00.000Z');
  assert.equal(h.c.apiDate_(null, 'Asia/Almaty', true), '');
});

test('V3 repeat submission dates take precedence and missing ordinary dates remain inactive', () => {
  const h = harness(), config = configureV3(h);
  const raw = v3Lot(); raw.TrdBuy.repeatStartDate = '2026-10-09 08:00:00'; raw.TrdBuy.repeatEndDate = '2026-10-11 18:00:00';
  assert.equal(h.c.normalizeV3Lot_(raw, config).lot.applicationStart, '2026-10-09T03:00:00.000Z');
  const empty = v3Lot(); empty.TrdBuy.startDate = null; empty.TrdBuy.endDate = null;
  assert.equal(h.c.normalizeV3Lot_(empty, config).lot.deadline, '');
});

test('V3 diagnostic reads live-shaped schema/pages, redacts reflected token and leaves data untouched', () => {
  const h = harness(); h.setup(); const config = configureV3(h);
  graphResponse(h, introspectionFromOfficialSdl());
  graphResponse(h, {Lots: [v3Lot(102, {nameRu: 'Reflected TEST_ONLY_SECRET'})]});
  graphResponse(h, {Lots: [v3Lot(101)]});
  const report = h.c.testGoszakupV3Connection();
  assert.equal(report.connectionOk, true);
  assert.equal(report.schemaVerified, true);
  assert.equal(report.mvpReady, true);
  assert.equal(report.fullCountryCoverageVerified, false);
  assert.equal(report.eligibleNormalizedSamples, 2);
  assert.equal(h.properties.get('TENDER_V3_VERIFIED_CONFIG'), config.fingerprint);
  assert.equal(data(h).length, 0);
  assert.equal(h.c.state_(), null);
  assert.equal(h.triggers.length, 0);
  assert.ok(!JSON.stringify(report).includes('TEST_ONLY_SECRET'));
  assert.ok(!JSON.stringify(h.sheets.get('LOGS').rows).includes('TEST_ONLY_SECRET'));
});

test('V3 missing runtime settings permit diagnosis but never grant sync readiness', () => {
  const h = harness(); h.setup(); configureV3(h, false);
  graphResponse(h, introspectionFromOfficialSdl());
  graphResponse(h, {Lots: [v3Lot(102)]}); graphResponse(h, {Lots: []});
  const report = h.c.testGoszakupV3Connection();
  assert.equal(report.schemaVerified, true);
  assert.equal(report.mvpReady, false);
  assert.equal(report.configurationIssues.length, 3);
  assert.equal(h.properties.has('TENDER_V3_VERIFIED_CONFIG'), false);
});

test('empty real-shaped sample or failed schema does not validate the mapping', () => {
  const h = harness(); h.setup(); configureV3(h);
  graphResponse(h, introspectionFromOfficialSdl()); graphResponse(h, {Lots: []});
  assert.equal(h.c.testGoszakupV3Connection().mvpReady, false);
  h.properties.set('TENDER_V3_VERIFIED_CONFIG', 'old-proof');
  const schema = introspectionFromOfficialSdl(); schema.t1.fields = schema.t1.fields.filter(f => f.name !== 'amount');
  graphResponse(h, schema);
  assert.throws(() => h.c.testGoszakupV3Connection(), /API_V3_SCHEMA_MISMATCH/);
  assert.equal(h.properties.has('TENDER_V3_VERIFIED_CONFIG'), false);
  assert.equal(h.properties.has('TENDER_V3_DIAGNOSTIC'), false);
});

test('verified V3 adapter drives full Sheets sync and trigger; later config change requires rechecking', () => {
  const h = harness(); h.setup(); const config = configureV3(h);
  h.properties.set('TENDER_V3_VERIFIED_CONFIG', config.fingerprint); // Synthetic proof from a test-only endpoint.
  graphResponse(h, {Lots: [v3Lot(102)]}); graphResponse(h, {Lots: []});
  h.c.syncTenderLots();
  assert.equal(data(h).length, 1);
  assert.equal(data(h)[0][5], 10000000);
  assert.equal(h.c.state_(), null);
  h.c.installDailyTrigger();
  assert.equal(h.triggers.filter(t => t.handler === 'dailyTenderSync').length, 1);
  h.properties.set('GOSZAKUP_PAGE_SIZE', '50');
  assert.throws(() => h.c.assertApiReady_(), /API_V3_LIVE_CHECK_REQUIRED/);
});

test('invalid calendar dates and inverted submission intervals are rejected', () => {
  const h = harness(), config = configureV3(h);
  assert.throws(() => h.c.apiDate_('2026-02-30T08:00:00+05:00', '', false), /API_SOURCE_DATE_INVALID/);
  const raw = v3Lot(); raw.TrdBuy.endDate = '2026-10-07 18:00:00';
  assert.throws(() => h.c.normalizeV3Lot_(raw, config), /API_APPLICATION_DATES_INVALID/);
});

test('long reflected credentials are redacted BEFORE sample truncation', () => {
  const h = harness(); h.setup(); configureV3(h);
  const longToken = 'SENSITIVE_' + 'x'.repeat(250);
  h.properties.set('GOSZAKUP_API_TOKEN', longToken);
  graphResponse(h, introspectionFromOfficialSdl());
  graphResponse(h, {Lots: [v3Lot(102, {nameRu: longToken})]}); graphResponse(h, {Lots: []});
  const report = h.c.testGoszakupV3Connection();
  assert.equal(report.samples[0].name, '[REDACTED]');
  assert.ok(!JSON.stringify(h.sheets.get('LOGS').rows).includes('SENSITIVE_'));
});

test('documented status reference exposes codes/names and completeness without guessing activity', () => {
  const h = harness(); h.setup(); authorize(h);
  // Official /help reference example, with total adjusted only for this mock.
  rawResponse(h, {total: 1, next_page: '', items: [{id: 240, code: 'PublishedOfferAccept',
    name_ru: 'Опубликован (прием ценовых предложений)'}]});
  const report = h.c.inspectGoszakupStatusReference();
  assert.equal(report.complete, true);
  assert.equal(report.statuses[0].code, 'PublishedOfferAccept');
  assert.equal(report.statuses[0].isActive, undefined);
  assert.equal(h.properties.has('GOSZAKUP_ACTIVE_STATUS_CODES'), false);
});

test('official V3 endpoint is default and user GOSZAKUP_TOKEN takes precedence', () => {
  const h = harness();
  h.properties.set('GOSZAKUP_TOKEN', 'PRIMARY_TEST_TOKEN');
  h.properties.set('GOSZAKUP_API_TOKEN', 'LEGACY_TEST_TOKEN');
  assert.equal(h.c.apiToken_(), 'PRIMARY_TEST_TOKEN');
  assert.equal(h.c.v3Config_().endpoint, 'https://ows.goszakup.gov.kz/v3/graphql');
});

test('V3 nonempty final page stops on hasNextPage false without an extra request', () => {
  const h = harness(), config = configureV3(h);
  graphResponse(h, {Lots: [v3Lot(102)]}, null,
    {limitPage: 100, totalCount: 1, hasNextPage: false, lastId: 102});
  const page = h.c.v3RawPage_(config, null);
  assert.equal(page.nextCursor, null);
  assert.equal(page.items.length, 1);
  assert.equal(page.paginationVerified, true);
  assert.equal(h.fetchCalls.length, 1);
});

test('V3 empty intermediate page advances by documented lastId', () => {
  const h = harness(), config = configureV3(h);
  graphResponse(h, {Lots: []}, null,
    {limitPage: 100, totalCount: 300, hasNextPage: true, lastId: 100});
  const first = h.c.v3RawPage_(config, null);
  graphResponse(h, {Lots: [v3Lot(99)]}, null,
    {limitPage: 100, totalCount: 300, hasNextPage: false, lastId: 99});
  assert.equal(h.c.v3RawPage_(config, first.nextCursor).nextCursor, null);
  assert.equal(JSON.parse(h.fetchCalls[1].options.payload).variables.after, 100);
});

test('missing V3 pageInfo cannot silently end production pagination', () => {
  const h = harness(), config = configureV3(h);
  rawResponse(h, {data: {Lots: [v3Lot()]}});
  assert.throws(() => h.c.v3RawPage_(config, null), /API_V3_PAGE_INFO_MISSING/);
  rawResponse(h, {data: {Lots: [v3Lot()]}});
  const diagnostic = h.c.v3RawPage_(config, null, true);
  assert.equal(diagnostic.paginationVerified, false);
  assert.equal(diagnostic.nextCursor, null);
});

test('missing V3 pagination metadata leaves diagnostic useful but never authorizes sync', () => {
  const h = harness(); h.setup(); configureV3(h);
  graphResponse(h, introspectionFromOfficialSdl());
  rawResponse(h, {data: {Lots: [v3Lot()]}});
  const report = h.c.testGoszakupV3Connection();
  assert.equal(report.schemaVerified, true);
  assert.equal(report.mvpReady, false);
  assert.equal(report.paginationEndReached, false);
  assert.ok(report.configurationIssues.includes('V3_PAGE_INFO_UNVERIFIED'));
  assert.equal(h.properties.has('TENDER_V3_VERIFIED_CONFIG'), false);
});

test('V3 inconsistent lastId and stalled empty metadata cannot advance cursor', () => {
  const h = harness(), config = configureV3(h);
  graphResponse(h, {Lots: [v3Lot(102)]}, null,
    {limitPage: 100, totalCount: 300, hasNextPage: true, lastId: 103});
  assert.throws(() => h.c.v3RawPage_(config, null), /API_V3_PAGE_INFO_INVALID/);
  graphResponse(h, {Lots: [v3Lot(102)]});
  const first = h.c.v3RawPage_(config, null);
  graphResponse(h, {Lots: []}, null,
    {limitPage: 100, totalCount: 300, hasNextPage: true, lastId: 102});
  assert.throws(() => h.c.v3RawPage_(config, first.nextCursor), /API_V3_PAGE_INFO_INVALID/);
});
