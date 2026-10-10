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
  for (const name of ['Config.gs', 'Sheets.gs', 'Api.gs', 'V3.gs', 'Pilot.gs', 'Sync.gs', 'Diagnostics.gs', 'SelfTests.gs']) {
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

// Synthetic stage-2 responses: values here never substitute for a live API check.
function stage2Responses(h, {numberMismatch = false, reflectedToken = ''} = {}) {
  const row = {id: 43495954, lotNumber: '88105345-ЗЦП1', trdBuyId: 17735121,
    trdBuyNumberAnno: '17735121-1', refTradeMethodsId: 3, refBuyTradeMethodsId: 3,
    count: 500, amount: 550000, isDeleted: 0, pointList: [101],
    Plans: [{id: 101, refSubjectTypeId: 1}],
    RefLotsStatus: {id: 240, code: 'PublishedOfferAccept', nameRu: reflectedToken || 'TEST_STATUS'},
    TrdBuy: {id: 17735121, numberAnno: '17735121-1', refTradeMethodsId: 3,
      publishDate: '2026-10-07 11:28:44', startDate: '2026-10-07 11:30:00',
      endDate: '2026-10-09 11:30:00', repeatStartDate: null, repeatEndDate: null}};
  const deleted = {...row, id: 123, isDeleted: 1, Plans: [], pointList: [], TrdBuy: null};
  const data = [{__type: {inputFields: ['id', 'lotNumber', 'refLotStatusId'].map(name => ({name}))}},
    {Lots: [row]}, {Lots: [{...row, trdBuyId: numberMismatch ? 999 : row.trdBuyId}]}, {Lots: [row, deleted]}];
  h.responses.push(...data.map(data => ({status: 200, body: JSON.stringify({data})})));
}

test('stage-2 lookup confirms both identities without changing state or granting readiness', () => {
  const h = harness(); h.setup(); h.properties.set('GOSZAKUP_TOKEN', 'TEST_STAGE2_TOKEN');
  h.properties.set('TENDER_V3_VERIFIED_CONFIG', 'TEST_OLD_PROOF');
  const beforeProperties = [...h.properties], beforeSheets = json([...h.sheets]);
  stage2Responses(h);
  const report = h.c.inspectTenderStage2Evidence();
  assert.equal(report.primaryIdRelationVerified, true);
  assert.equal(report.primaryDateComparison.rawStringsMatch, true);
  assert.equal(report.checks[1].apiIdentityMatches, false); // Missing methods remain unverified.
  assert.equal(report.checks[0].apiSample.allPlanPointsCovered, true);
  assert.equal(report.publishedProbe.deleted, 1);
  assert.equal(report.publishedProbe.samples.length, 1);
  assert.equal(report.isDeletedFilterAvailable, false);
  for (const key of ['mvpReady', 'apiDateTimezoneVerified', 'fullActiveStatusSetVerified',
    'allProcurementMethodUrlsVerified', 'fullCountryCoverageVerified']) assert.equal(report[key], false);
  assert.deepEqual([...h.properties], beforeProperties);
  assert.deepEqual(json([...h.sheets]), beforeSheets);
  assert.equal(h.triggers.length, 0);
  const bodies = h.fetchCalls.map(call => JSON.parse(call.options.payload));
  assert.deepEqual(bodies[2].variables.filter, {lotNumber: '88105345-ЗЦП1'});
  assert.deepEqual(bodies[3].variables.filter, {refLotStatusId: [210, 220, 230, 240]});
  assert.ok(bodies.every(body => !Object.hasOwn(body.variables?.filter || {}, 'isDeleted')));
});

test('stage-2 lookup does not confirm an identity when the independent number lookup disagrees', () => {
  const h = harness(); h.properties.set('GOSZAKUP_TOKEN', 'TEST_STAGE2_TOKEN');
  stage2Responses(h, {numberMismatch: true});
  assert.equal(h.c.inspectTenderStage2Evidence().primaryIdRelationVerified, false);
});

test('stage-2 diagnostic redacts reflected secrets before truncation and in console parts', () => {
  const h = harness(), token = 'TEST_STAGE2_' + 'x'.repeat(300), lines = [];
  h.properties.set('GOSZAKUP_TOKEN', token); h.c.console.log = line => lines.push(line);
  stage2Responses(h, {reflectedToken: token});
  const report = h.c.inspectTenderStage2Evidence();
  assert.equal(report.checks[0].apiSample.RefLotsStatus.nameRu, '[REDACTED]');
  assert.ok(!JSON.stringify(report).includes(token.slice(0, 100)));
  assert.ok(!lines.join('').includes(token.slice(0, 100)));
  const assembled = lines.map(line => line.replace(/^STAGE2_JSON_PART_\d+: /, '')).join('');
  assert.deepEqual(JSON.parse(assembled), json(report));
});

test('stage-2 diagnostic fails safely on API errors without reading or modifying unrelated state', () => {
  const h = harness(); h.properties.set('GOSZAKUP_TOKEN', 'TEST_STAGE2_TOKEN');
  h.responses.push({status: 200, body: JSON.stringify({errors: [{message: 'TEST_STAGE2_TOKEN'}]})});
  assert.throws(() => h.c.inspectTenderStage2Evidence(), /API_GRAPHQL_ERRORS/);
  assert.equal(h.properties.size, 1);
  assert.equal(h.sheets.size, 0);
  assert.equal(h.triggers.length, 0);
});

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

test('valid V3 proof still cannot start full sync, continuation or daily trigger', () => {
  const h = harness(); h.setup(); const config = configureV3(h);
  h.properties.set('TENDER_V3_VERIFIED_CONFIG', config.fingerprint); // Synthetic proof from a test-only endpoint.
  h.properties.set('TENDER_SYNC_STATE', JSON.stringify({cursor: 'old'}));
  assert.throws(() => h.c.syncTenderLots(), /FULL_SCAN_DISABLED/);
  assert.throws(() => h.c.installDailyTrigger(), /FULL_SCAN_DISABLED/);
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(data(h).length, 0);
  assert.equal(h.triggers.length, 0);
  assert.equal(JSON.parse(h.properties.get('TENDER_SYNC_STATE')).cursor, 'old');
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

// Synthetic bounded-pilot fixtures; never executed against Google/Goszakup.
function pilotFixture() {
  const h = harness(); h.setup(); const config = configureV3(h);
  h.properties.set('TENDER_V3_VERIFIED_CONFIG', config.fingerprint);
  h.properties.set('TENDER_PILOT_WINDOW', JSON.stringify({from: '2026-10-08 07:00:00', to: '2026-10-08 07:59:00'}));
  return {h, config, window: h.c.pilotWindow_(config)};
}
function pilotResponse(h, root, rows, {total = rows.length, next = false, lastId = rows.at(-1)?.id ?? null} = {}) {
  rawResponse(h, {data: {[root]: rows}, extensions: {pageInfo: {limitPage: 20, totalCount: total, hasNextPage: next, lastId}}});
}
function pilotRow(id = 102, overrides = {}) {
  return v3Lot(id, {lastUpdateDate: '2026-10-08 07:20:00', indexDate: '2026-10-08 07:25:00',
    refTradeMethodsId: 3, refBuyTradeMethodsId: 6, ...overrides});
}
function pilotStreams(h, rows = [pilotRow()]) {
  // Publication parent, its lots, lot updates, changed parents, index updates.
  pilotResponse(h, 'TrdBuy', [{id: 555, publishDate: '2026-10-08 07:00:00'}]);
  pilotResponse(h, 'Lots', rows);
  pilotResponse(h, 'Lots', rows);
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', rows);
}

test('bounded pilot completes filtered streams and deduplicates snapshots/events by Lots.id', () => {
  const {h} = pilotFixture(); pilotStreams(h);
  const first = h.c.runTenderBoundedPilot();
  assert.equal(first.complete, true); assert.equal(first.uniqueLots, 1); assert.equal(first.requests, 5);
  assert.equal(first.countryCoverageVerified, false); assert.equal(first.watermarkAdvanced, false);
  assert.equal(data(h, 'PILOT_EVENTS')[0][2], 'NEW_PUBLICATION');
  assert.equal(data(h, 'PILOT_LOTS')[0][4], 3); assert.equal(data(h, 'PILOT_LOTS')[0][5], 6);
  assert.equal(data(h).length, 0); assert.equal(h.triggers.length, 0);
  pilotStreams(h); const second = h.c.runTenderBoundedPilot();
  assert.equal(second.eventsAdded, 0); assert.equal(data(h, 'PILOT_LOTS').length, 1);
  assert.equal(data(h, 'PILOT_EVENTS').length, 1);
  assert.equal(h.properties.has('TENDER_SYNC_STATE'), false);
});

test('observed status changes are separate from first publication and amount updates', () => {
  const {h, config, window} = pilotFixture(), sheets = h.c.pilotSheets_();
  function save(row) { return h.c.pilotSave_(sheets, new Map([['102', row]]), config, window); }
  save(pilotRow());
  const closed = pilotRow(102, {RefLotsStatus: {code: 'INTERNAL_CLOSED', nameRu: 'TEST_CLOSED'}});
  save(closed); save({...closed, amount: 5000});
  assert.deepEqual(data(h, 'PILOT_EVENTS').map(r => r[2]), ['NEW_PUBLICATION', 'STATUS_CHANGED', 'LOT_UPDATED']);
  assert.equal(JSON.parse(data(h, 'PILOT_LOTS')[0][7]).isActive, false);
});

test('first observation of an older publication is not a new publication', () => {
  const {h, config, window} = pilotFixture(), row = pilotRow(); row.TrdBuy.publishDate = '2026-10-07 07:00:00';
  h.c.pilotSave_(h.c.pilotSheets_(), new Map([['102', row]]), config, window);
  assert.equal(data(h, 'PILOT_EVENTS')[0][2], 'FIRST_OBSERVED');
});

test('missing Plans and empty pointList remain quarantine even with goods parent', () => {
  const {h, config, window} = pilotFixture(), row = pilotRow(102, {Plans: [], pointList: [],
    TrdBuy: {...v3Lot().TrdBuy, refSubjectTypeId: 1}});
  const c = h.c.pilotClassify_(row, config);
  assert.equal(c.kind, 'QUARANTINE'); assert.equal(c.reason, 'API_LOT_SUBJECT_TYPE_UNVERIFIED');
  h.c.pilotSave_(h.c.pilotSheets_(), new Map([['102', row]]), config, window);
  assert.equal(data(h, 'PILOT_QUARANTINE').length, 1); assert.equal(data(h, 'PILOT_LOTS')[0][7], '');
  assert.equal(data(h).length, 0);
});

test('missing Plans resolve only by exact documented Query.Plans IDs, preserving lot money', () => {
  const {h, config} = pilotFixture(); config.requestBudget = h.c.pilotBudget_();
  pilotResponse(h, 'Plans', [{id: 777, refSubjectTypeId: 1}]);
  const rows = h.c.pilotResolvePlans_([pilotRow(102, {Plans: []})], config, new Map());
  const payload = JSON.parse(h.fetchCalls[0].options.payload);
  assert.deepEqual(payload.variables.filter, {id: [777]}); assert.ok(payload.query.includes('PlansFiltersInput'));
  assert.equal(h.c.pilotClassify_(rows[0], config).lot.amount, 10000000);
});

test('unreturned or conflicting plan evidence is never inferred from lot number or parent', () => {
  const {h, config} = pilotFixture(); pilotResponse(h, 'Plans', []);
  const row = h.c.pilotResolvePlans_([pilotRow(102, {Plans: []})], config, new Map())[0];
  assert.equal(h.c.pilotClassify_(row, config).kind, 'QUARANTINE');
  const conflicting = pilotRow(102, {Plans: [{id: 777, refSubjectTypeId: 1}, {id: 777, refSubjectTypeId: 2}]});
  assert.equal(h.c.pilotClassify_(conflicting, config).kind, 'QUARANTINE');
});

test('foreign plan ID stops lookup rather than blessing mismatched subject evidence', () => {
  const {h, config} = pilotFixture(); pilotResponse(h, 'Plans', [{id: 999, refSubjectTypeId: 1}]);
  assert.throws(() => h.c.pilotResolvePlans_([pilotRow(102, {Plans: []})], config, new Map()), /PILOT_PLAN_RESPONSE_INVALID/);
});

test('explicit deleted, non-goods and over-limit lots excluded; unknown deletion flag quarantined', () => {
  const {h, config} = pilotFixture();
  assert.equal(h.c.pilotClassify_(pilotRow(102, {isDeleted: 1, Plans: [], pointList: []}), config).kind, 'DELETED');
  assert.equal(h.c.pilotClassify_(pilotRow(102, {Plans: [{id: 777, refSubjectTypeId: 2}]}), config).kind, 'EXCLUDED');
  assert.equal(h.c.pilotClassify_(pilotRow(102, {amount: 10000001}), config).kind, 'EXCLUDED');
  assert.equal(h.c.pilotClassify_(pilotRow(102, {isDeleted: null}), config).kind, 'QUARANTINE');
});

test('filtered pagination reads short pages to confirmed total and rejects repeated cursors', () => {
  const {h, config} = pilotFixture(), report = {}, rows = [];
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 2, next: true});
  pilotResponse(h, 'Lots', [pilotRow(101)], {total: 2});
  h.c.pilotScan_(config, 'Lots', {id: [102, 101]}, 'id', page => rows.push(...page), report);
  assert.equal(report.complete, true); assert.equal(rows.length, 2);
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 2, next: true});
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 2});
  assert.throws(() => h.c.pilotScan_(config, 'Lots', {}, 'id', () => {}, {}), /PILOT_CURSOR_ORDER/);
});

test('contradictory filtered pageInfo retains safe cursor evidence and still blocks completion', () => {
  const {h, config} = pilotFixture(), report = {};
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 2, next: true});
  pilotResponse(h, 'Lots', [pilotRow(101)], {total: 2, next: true});
  rawResponse(h, {data: {Lots: []}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 2, hasNextPage: false, lastId: 0
  }}});
  assert.throws(() => h.c.pilotScan_(config, 'Lots', {lastUpdateDate: ['2026-10-08 07:00:00', '2026-10-08 07:59:00']},
    'id', () => {}, report), /PILOT_TERMINAL_PAGE_UNVERIFIED/);
  assert.equal(report.complete, false);
  assert.equal(report.pages, 2);
  assert.equal(report.items, 2);
  assert.equal(report.pages, 2);
  assert.deepEqual(json(report.pageTrace), [
    {after: null, returned: 1, firstId: 102, lastRowId: 102, pageInfoLastId: 102,
      hasNextPage: true, cumulativeItems: 1, totalCount: 2},
    {after: 102, returned: 1, firstId: 101, lastRowId: 101, pageInfoLastId: 101,
      hasNextPage: true, cumulativeItems: 2, totalCount: 2}
  ]);
  assert.equal(h.fetchCalls.length, 3);
  assert.ok(!JSON.stringify(report).includes('TEST_ONLY_SECRET'));
});

test('Plans lookup accepts only exact zero-result null and keeps plan evidence quarantined', () => {
  const {h, config} = pilotFixture(), trace = [];
  const row = pilotRow(102, {Plans: [], pointList: [777], isDeleted: 0});
  rawResponse(h, {data: {Plans: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 0
  }}});
  const result = h.c.pilotResolvePlans_([row], config, new Map(), trace);
  assert.equal(result.length, 1);
  assert.deepEqual(json(result[0].Plans), []);
  assert.equal(h.c.pilotClassify_(result[0], config).kind, 'QUARANTINE');
  assert.equal(trace.length, 1);
  assert.equal(trace[0].complete, true);
  assert.equal(trace[0].emptyNullConfirmed, true);
  assert.equal(trace[0].reportedTotal, 0);
  assert.equal(h.fetchCalls.length, 1);
});

test('Plans null with positive count or invalid pageInfo fails closed with structural-only trace', () => {
  for (const p of [
    {limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0},
    {limitPage: 20, totalCount: 0, hasNextPage: true, lastId: 0},
    {limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 1},
    {limitPage: 21, totalCount: 0, hasNextPage: false, lastId: 0}
  ]) {
    const {h, config} = pilotFixture(), trace = [];
    rawResponse(h, {data: {Plans: null}, extensions: {pageInfo: p}});
    assert.throws(() => h.c.pilotResolvePlans_([
      pilotRow(102, {Plans: [], pointList: [777], isDeleted: 0})
    ], config, new Map(), trace), /PILOT_PAGE_INFO_UNVERIFIED/);
    assert.equal(trace[0].complete, false);
    assert.equal(trace[0].invalidPage.resultKind, 'null');
    assert.equal(trace[0].invalidPage.totalCount, p.totalCount);
    assert.equal(h.fetchCalls.length, 1);
    assert.equal(JSON.stringify(trace).includes('777'), false);
  }
});

test('Plans missing property is not accepted as a zero-result null', () => {
  const {h, config} = pilotFixture(), trace = [];
  rawResponse(h, {data: {}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 0
  }}});
  assert.throws(() => h.c.pilotResolvePlans_([
    pilotRow(102, {Plans: [], pointList: [777], isDeleted: 0})
  ], config, new Map(), trace), /PILOT_PAGE_INFO_UNVERIFIED/);
  assert.equal(trace[0].invalidPage.resultKind, 'missing');
});

test('full pilot with exact zero-null Plans page completes bounded streams without claiming production readiness', () => {
  const {h} = pilotFixture();
  const row = pilotRow(102, {Plans: [], pointList: [777], isDeleted: 0});
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', [row]);
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', []);
  rawResponse(h, {data: {Plans: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 0
  }}});
  const report = h.c.runTenderBoundedPilot();
  assert.equal(report.complete, true);
  assert.equal(report.planLookups.length, 1);
  assert.equal(report.planLookups[0].emptyNullConfirmed, true);
  assert.equal(report.countryCoverageVerified, false);
  assert.equal(report.dailyCoverageVerified, false);
  assert.equal(report.watermarkAdvanced, false);
  assert.equal(report.mvpReady, false);
  assert.equal(report.quarantineCount, 1);
  assert.equal(h.triggers.length, 0);
});

test('zero-result Lots.indexDate explicit null terminal marker completes only this stream', () => {
  const {h, config} = pilotFixture(), report = {}, consumed = [];
  rawResponse(h, {data: {Lots: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 0
  }}});
  h.c.pilotScan_(config, 'Lots', {indexDate: ['2026-10-08 07:00:00', '2026-10-08 07:59:00']},
    'id', rows => consumed.push(...rows), report);
  assert.equal(report.complete, true);
  assert.equal(report.emptyNullConfirmed, true);
  assert.equal(report.pages, 1);
  assert.equal(report.items, 0);
  assert.equal(report.reportedTotal, 0);
  assert.equal(report.pageTrace[0].emptyNull, true);
  assert.equal(consumed.length, 0);
  assert.equal(h.fetchCalls.length, 1);
});

test('initial Lots.indexDate null with incompatible metadata fails closed', () => {
  const invalid = [
    {data: {}, extensions: {pageInfo: {limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 0}}},
    {data: {Lots: null}, extensions: {pageInfo: {limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0}}},
    {data: {Lots: null}, extensions: {pageInfo: {limitPage: 20, totalCount: 0, hasNextPage: true, lastId: 0}}},
    {data: {Lots: null}, extensions: {pageInfo: {limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 12}}},
    {data: {Lots: null}, extensions: {pageInfo: {limitPage: 21, totalCount: 0, hasNextPage: false, lastId: 0}}},
    {data: {Lots: null}},
  ];
  for (const sample of invalid) {
    const {h, config} = pilotFixture(), report = {};
    rawResponse(h, sample);
    assert.throws(() => h.c.pilotScan_(config, 'Lots',
      {indexDate: ['2026-10-08 07:00:00', '2026-10-08 07:59:00']},
      'id', () => {}, report), /PILOT_PAGE_INFO_UNVERIFIED/);
    assert.equal(report.complete, false);
    assert.equal(report.emptyNullConfirmed, undefined);
    assert.equal(h.fetchCalls.length, 1);
  }
});

test('zero-result null is not accepted for other streams or filters', () => {
  for (const [root, filter] of [
    ['Lots', {lastUpdateDate: ['2026-10-08 07:00:00', '2026-10-08 07:59:00']}],
    ['Lots', {trdBuyId: [555]}],
    ['TrdBuy', {indexDate: ['2026-10-08 07:00:00', '2026-10-08 07:59:00']}]
  ]) {
    const {h, config} = pilotFixture(), stats = {};
    rawResponse(h, {data: {[root]: null}, extensions: {pageInfo: {
      limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 0
    }}});
    assert.throws(() => h.c.pilotScan_(config, root, filter, 'id', () => {}, stats),
      /PILOT_PAGE_INFO_UNVERIFIED/);
    assert.equal(stats.complete, false);
    assert.equal(h.fetchCalls.length, 1);
  }
});

test('zero-result indexDate null lets bounded pilot finish without enabling full sync', () => {
  const {h} = pilotFixture();
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', []);
  pilotResponse(h, 'TrdBuy', []);
  rawResponse(h, {data: {Lots: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 0
  }}});
  const report = h.c.runTenderBoundedPilot();
  assert.equal(report.complete, true);
  assert.equal(report.streams[3].emptyNullConfirmed, true);
  assert.equal(report.streams[3].pages, 1);
  assert.equal(report.countryCoverageVerified, false);
  assert.equal(report.dailyCoverageVerified, false);
  assert.equal(report.watermarkAdvanced, false);
  assert.equal(report.mvpReady, false);
  assert.equal(h.properties.has('TENDER_SYNC_STATE'), false);
  assert.equal(h.triggers.length, 0);
});

test('real-shaped Lots terminal null after exact total confirms only filtered stream completion', () => {
  const {h, config} = pilotFixture(), stats = {}, values = [];
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 2, next: true});
  pilotResponse(h, 'Lots', [pilotRow(101)], {total: 2, next: true});
  rawResponse(h, {data: {Lots: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 2, hasNextPage: false, lastId: 0
  }}});
  h.c.pilotScan_(config, 'Lots', {lastUpdateDate: ['2026-10-08 07:00:00', '2026-10-08 07:59:00']},
    'id', rows => values.push(...rows), stats);
  assert.deepEqual(json(values.map(x => x.id)), [102, 101]);
  assert.equal(stats.complete, true);
  assert.equal(stats.pages, 3);
  assert.equal(stats.items, 2);
  assert.equal(stats.terminalNullConfirmed, true);
  assert.deepEqual(json(stats.pageTrace[2]), {
    after: 101, returned: 0, firstId: null, lastRowId: null,
    pageInfoLastId: 0, hasNextPage: false, cumulativeItems: 2,
    totalCount: 2, terminalNull: true
  });
  assert.equal(h.fetchCalls.length, 3);
});

test('Lots terminal null marker mismatches fail closed after exact total', () => {
  const invalid = [
    {data: {}, extensions: {pageInfo: {limitPage: 20, totalCount: 2, hasNextPage: false, lastId: 0}}},
    {data: {Lots: []}, extensions: {pageInfo: {limitPage: 20, totalCount: 2, hasNextPage: false, lastId: 0}}},
    {data: {Lots: [pilotRow(100)]}, extensions: {pageInfo: {limitPage: 20, totalCount: 2, hasNextPage: false, lastId: 0}}},
    {data: {Lots: null}, extensions: {pageInfo: {limitPage: 20, totalCount: 3, hasNextPage: false, lastId: 0}}},
    {data: {Lots: null}, extensions: {pageInfo: {limitPage: 20, totalCount: 2, hasNextPage: true, lastId: 0}}},
    {data: {Lots: null}, extensions: {pageInfo: {limitPage: 20, totalCount: 2, hasNextPage: false, lastId: 101}}},
    {data: {Lots: null}, extensions: {pageInfo: {limitPage: 21, totalCount: 2, hasNextPage: false, lastId: 0}}},
  ];
  for (const response of invalid) {
    const {h, config} = pilotFixture(), stats = {};
    pilotResponse(h, 'Lots', [pilotRow(102)], {total: 2, next: true});
    pilotResponse(h, 'Lots', [pilotRow(101)], {total: 2, next: true});
    rawResponse(h, response);
    assert.throws(() => h.c.pilotScan_(config, 'Lots', {}, 'id', () => {}, stats), /PILOT_TERMINAL_PAGE_UNVERIFIED/);
    assert.equal(stats.complete, false);
    assert.equal(stats.terminalNullConfirmed, undefined);
    assert.equal(h.fetchCalls.length, 3);
  }
});

test('TrdBuy never accepts Lots-specific terminal null marker', () => {
  const {h, config} = pilotFixture(), stats = {};
  pilotResponse(h, 'TrdBuy', [{id: 555, publishDate: '2026-10-08 07:00:00'}], {total: 1, next: true});
  assert.throws(() => h.c.pilotScan_(config, 'TrdBuy', {}, 'id', () => {}, stats),
    /PILOT_CURSOR_INVALID/);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(stats.complete, false);
});

test('terminal null confirmation does not change production watermark or schedule', () => {
  const {h} = pilotFixture();
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 1, next: true});
  rawResponse(h, {data: {Lots: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0
  }}});
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', []);
  const report = h.c.runTenderBoundedPilot();
  assert.equal(report.complete, true);
  assert.equal(report.streams[1].terminalNullConfirmed, true);
  assert.equal(report.countryCoverageVerified, false);
  assert.equal(report.dailyCoverageVerified, false);
  assert.equal(report.watermarkAdvanced, false);
  assert.equal(report.mvpReady, false);
  assert.equal(h.properties.has('TENDER_SYNC_STATE'), false);
  assert.equal(h.triggers.length, 0);
});

test('cursor lastId mismatch is visible in trace but never consumed', () => {
  const {h, config} = pilotFixture(), report = {};
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 3, next: true, lastId: 999});
  let consumed = 0;
  assert.throws(() => h.c.pilotScan_(config, 'Lots', {}, 'id', () => { consumed += 1; }, report),
    /PILOT_CURSOR_INVALID/);
  assert.equal(report.complete, false); assert.equal(consumed, 0);
  assert.equal(report.pageTrace[0].pageInfoLastId, 999);
  assert.equal(report.pageTrace[0].lastRowId, 102);
  assert.equal(h.fetchCalls.length, 1);
});

test('read-only filtered cursor probe records one contradictory extra page without advancing state', () => {
  const {h} = pilotFixture();
  // Populate the last pilot report via a real-shaped contradiction.
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 1, next: true});
  rawResponse(h, {data: {Lots: []}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0
  }}});
  const first = h.c.runTenderBoundedPilot();
  assert.equal(first.issue, 'PILOT_TERMINAL_PAGE_UNVERIFIED');
  assert.equal(first.complete, false);
  const baseline = json([...h.sheets].map(([name, sheet]) => [name, sheet.rows]));
  const previousRequests = h.fetchCalls.length;
  pilotResponse(h, 'Lots', [pilotRow(101)], {total: 1, next: false});
  const result = h.c.inspectTenderPilotPaginationConflict();
  assert.equal(result.mode, 'READ_ONLY_SINGLE_PAGE');
  assert.equal(result.requestedAfter, 102);
  assert.equal(result.nextPageReturned, 1);
  assert.equal(result.contradictoryExtraRows, true);
  assert.equal(result.priorTotalStillMatches, true);
  assert.equal(result.descendingOrderValid, true);
  assert.equal(result.complete, false);
  assert.equal(result.watermarkAdvanced, false);
  assert.equal(result.requests, 1);
  assert.equal(h.fetchCalls.length, previousRequests + 1);
  assert.deepEqual(json([...h.sheets].map(([name, sheet]) => [name, sheet.rows])), baseline);
  assert.equal(h.triggers.length, 0);
});

test('read-only cursor probe returns safe evidence when pageInfo is missing', () => {
  const {h} = pilotFixture();
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 1, next: true});
  rawResponse(h, {data: {Lots: []}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0
  }}});
  const first = h.c.runTenderBoundedPilot();
  assert.equal(first.issue, 'PILOT_TERMINAL_PAGE_UNVERIFIED');
  const original = json([...h.sheets].map(([name, sheet]) => [name, sheet.rows]));
  const calls = h.fetchCalls.length;
  rawResponse(h, {data: {Lots: []}});
  const report = h.c.inspectTenderPilotPaginationConflict();
  assert.deepEqual(json(report.pageInfoIssues), ['PAGE_INFO_MISSING']);
  assert.equal(report.pageInfoPresent, false);
  assert.equal(report.hasNextPage, null);
  assert.equal(report.totalCount, null);
  assert.equal(report.nextPageReturned, 0);
  assert.equal(report.complete, false);
  assert.equal(report.watermarkAdvanced, false);
  assert.equal(h.fetchCalls.length, calls + 1);
  assert.deepEqual(json([...h.sheets].map(([name, sheet]) => [name, sheet.rows])), original);
});

test('read-only cursor probe classifies null terminal marker without confirming completeness', () => {
  const {h} = pilotFixture();
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 1, next: true});
  rawResponse(h, {data: {Lots: []}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0
  }}});
  assert.equal(h.c.runTenderBoundedPilot().issue, 'PILOT_TERMINAL_PAGE_UNVERIFIED');
  const before = json([...h.sheets].map(([name, sheet]) => [name, sheet.rows]));
  rawResponse(h, {data: {Lots: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0
  }}});
  const result = h.c.inspectTenderPilotPaginationConflict();
  assert.equal(result.lotsResultKind, 'null');
  assert.equal(result.terminalNullCandidate, true);
  assert.deepEqual(json(result.pageInfoIssues), ['LOTS_NOT_ARRAY']);
  assert.equal(result.complete, false);
  assert.equal(result.watermarkAdvanced, false);
  assert.deepEqual(json([...h.sheets].map(([name, sheet]) => [name, sheet.rows])), before);
  assert.equal(h.triggers.length, 0);
});

test('read-only cursor probe distinguishes missing Lots from explicit null', () => {
  const {h} = pilotFixture();
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 1, next: true});
  rawResponse(h, {data: {Lots: []}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0
  }}});
  assert.equal(h.c.runTenderBoundedPilot().issue, 'PILOT_TERMINAL_PAGE_UNVERIFIED');
  rawResponse(h, {data: {}, extensions: {pageInfo: {limitPage: 20, totalCount: 1,
    hasNextPage: false, lastId: 0}}});
  const result = h.c.inspectTenderPilotPaginationConflict();
  assert.equal(result.lotsResultKind, 'missing');
  assert.equal(result.terminalNullCandidate, false);
  assert.equal(result.complete, false);
});

test('read-only cursor probe reports malformed pageInfo fields without weakening pilot', () => {
  const {h} = pilotFixture();
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 1, next: true});
  rawResponse(h, {data: {Lots: []}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 1, hasNextPage: false, lastId: 0
  }}});
  assert.equal(h.c.runTenderBoundedPilot().issue, 'PILOT_TERMINAL_PAGE_UNVERIFIED');
  rawResponse(h, {data: {Lots: []}, extensions: {pageInfo: {
    limitPage: null, totalCount: '1', hasNextPage: 'false', lastId: null
  }}});
  const report = h.c.inspectTenderPilotPaginationConflict();
  assert.deepEqual(json(report.pageInfoIssues),
    ['LIMIT_PAGE_MISMATCH', 'HAS_NEXT_PAGE_INVALID', 'TOTAL_COUNT_INVALID']);
  assert.equal(report.pageInfoLimitPageType, 'object');
  assert.equal(report.pageInfoTotalCountType, 'string');
  assert.equal(report.pageInfoHasNextPageType, 'string');
  assert.equal(report.complete, false);
  assert.equal(report.requests, 1);
});

test('read-only indexDate probe distinguishes zero-result null marker and never writes', () => {
  const {h} = pilotFixture();
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', []);
  pilotResponse(h, 'TrdBuy', []);
  // Simulate an invalid initial response to preserve a report for the
  // read-only diagnostic; a correct zero-null page now completes normally.
  rawResponse(h, {data: {Lots: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 9
  }}});
  const first = h.c.runTenderBoundedPilot();
  assert.equal(first.issue, 'PILOT_PAGE_INFO_UNVERIFIED');
  assert.equal(first.streams[3].name, 'Lots.indexDate');
  const snapshots = json([...h.sheets].map(([name, sheet]) => [name, sheet.rows]));
  const requestCount = h.fetchCalls.length;
  rawResponse(h, {data: {Lots: null}, extensions: {pageInfo: {
    limitPage: 20, totalCount: 0, hasNextPage: false, lastId: 0
  }}});
  const probe = h.c.inspectTenderPilotIndexDatePage();
  assert.equal(probe.mode, 'READ_ONLY_INDEX_FIRST_PAGE');
  assert.equal(probe.stream, 'Lots.indexDate');
  assert.equal(probe.lotsResultKind, 'null');
  assert.deepEqual(json(probe.pageInfoIssues), ['LOTS_NOT_ARRAY']);
  assert.equal(probe.emptyNullCandidate, true);
  assert.equal(probe.complete, false);
  assert.equal(probe.watermarkAdvanced, false);
  assert.equal(probe.requests, 1);
  assert.equal(h.fetchCalls.length, requestCount + 1);
  assert.deepEqual(json([...h.sheets].map(([name, sheet]) => [name, sheet.rows])), snapshots);
  const body = JSON.parse(h.fetchCalls.at(-1).options.payload);
  assert.deepEqual(json(body.variables.filter), {indexDate: ['2026-10-08 07:00:00', '2026-10-08 07:59:00']});
  assert.equal(body.variables.after, null);
  assert.equal(h.triggers.length, 0);
});

test('read-only indexDate probe rejects mismatched last pilot report before HTTP', () => {
  const {h} = pilotFixture();
  const baseline = h.fetchCalls.length;
  assert.throws(() => h.c.inspectTenderPilotIndexDatePage(), /PILOT_INDEX_PROBE_REPORT_REQUIRED/);
  assert.equal(h.fetchCalls.length, baseline);
  pilotStreams(h);
  assert.equal(h.c.runTenderBoundedPilot().complete, true);
  const calls = h.fetchCalls.length;
  assert.throws(() => h.c.inspectTenderPilotIndexDatePage(), /PILOT_INDEX_PROBE_NOT_APPLICABLE/);
  assert.equal(h.fetchCalls.length, calls);
});

test('read-only filtered cursor probe rejects unsuitable or unverified reports before HTTP', () => {
  const {h} = pilotFixture();
  const baseline = h.fetchCalls.length;
  assert.throws(() => h.c.inspectTenderPilotPaginationConflict(), /PILOT_CURSOR_PROBE_REPORT_REQUIRED/);
  assert.equal(h.fetchCalls.length, baseline);
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', []);
  pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', []);
  h.c.runTenderBoundedPilot();
  const requests = h.fetchCalls.length;
  assert.throws(() => h.c.inspectTenderPilotPaginationConflict(), /PILOT_CURSOR_PROBE_NOT_APPLICABLE/);
  assert.equal(h.fetchCalls.length, requests);
});

test('global or changing filtered totalCount is not accepted as complete coverage', () => {
  const {h, config} = pilotFixture();
  pilotResponse(h, 'Lots', [pilotRow()], {total: 32440437});
  assert.throws(() => h.c.pilotScan_(config, 'Lots', {}, 'id', () => {}, {}), /PILOT_COUNT_MISMATCH/);
  pilotResponse(h, 'Lots', [pilotRow(102)], {total: 2, next: true});
  pilotResponse(h, 'Lots', [pilotRow(101)], {total: 3});
  assert.throws(() => h.c.pilotScan_(config, 'Lots', {}, 'id', () => {}, {}), /PILOT_PAGE_INFO_UNVERIFIED/);
});

test('out-of-window filter response produces incomplete report, no progress or full sync', () => {
  const {h} = pilotFixture(); pilotResponse(h, 'TrdBuy', [{id: 555, publishDate: '2026-10-07 07:00:00'}]);
  const report = h.c.runTenderBoundedPilot();
  assert.equal(report.complete, false); assert.equal(report.issue, 'PILOT_FILTER_RANGE_MISMATCH');
  assert.equal(report.watermarkAdvanced, false); assert.equal(h.triggers.length, 0);
  assert.equal(h.properties.has('TENDER_SYNC_STATE'), false);
});

test('retry attempts reserve persisted quota before HTTP and stop on run cap', () => {
  const {h, config} = pilotFixture(); const budget = h.c.pilotBudget_();
  for (let i = 0; i < 38; i++) budget.claim();
  h.responses.push({status: 503, body: '{}'}, {status: 503, body: '{}'});
  assert.throws(() => h.c.fetchJsonWithRetry_(config.endpoint, {}, budget), /PILOT_REQUEST_LIMIT/);
  assert.equal(h.fetchCalls.length, 2); assert.equal(budget.used(), 40);
  assert.equal(JSON.parse(h.properties.get('TENDER_PILOT_QUOTA')).length, 40);
});

test('rolling 24h quota, corrupt state and runtime limits reject without sending requests', () => {
  const {h} = pilotFixture();
  h.properties.set('TENDER_PILOT_QUOTA', JSON.stringify(Array(200).fill(h.c.Date.now())));
  assert.throws(() => h.c.pilotBudget_().claim(), /PILOT_DAILY_LIMIT/);
  h.properties.set('TENDER_PILOT_QUOTA', '{broken');
  assert.throws(() => h.c.pilotBudget_().claim(), /PILOT_QUOTA_STATE_INVALID/);
  h.properties.set('TENDER_PILOT_QUOTA', '[]'); const budget = h.c.pilotBudget_(); h.advance(120000);
  assert.throws(() => budget.claim(), /PILOT_TIME_LIMIT/);
  assert.equal(h.fetchCalls.length, 0);
});

test('window bound, missing timezone and stale proof prevent pilot before mutation/HTTP', () => {
  const {h} = pilotFixture();
  h.properties.set('TENDER_PILOT_WINDOW', '{"from":"2026-10-08 05:00:00","to":"2026-10-08 07:59:00"}');
  assert.throws(() => h.c.runTenderBoundedPilot(), /PILOT_WINDOW_INVALID/);
  h.properties.delete('GOSZAKUP_API_DATE_TIMEZONE');
  assert.throws(() => h.c.runTenderBoundedPilot(), /SOURCE_DATE_TIMEZONE_REQUIRED/);
  h.properties.set('GOSZAKUP_API_DATE_TIMEZONE', 'Asia/Almaty');
  h.properties.set('TENDER_V3_VERIFIED_CONFIG', 'OLD');
  assert.throws(() => h.c.runTenderBoundedPilot(), /API_V3_LIVE_CHECK_REQUIRED/);
  assert.equal(h.fetchCalls.length, 0); assert.equal(h.sheets.has('PILOT_LOTS'), false);
});

test('event-first write survives flush failure and retry without duplicate or missing event', () => {
  const {h, config, window} = pilotFixture(), sheets = h.c.pilotSheets_(), items = new Map([['102', pilotRow()]]);
  h.failFlush(); assert.throws(() => h.c.pilotSave_(sheets, items, config, window), /test flush failure/);
  assert.equal(data(h, 'PILOT_EVENTS').length, 1); assert.equal(data(h, 'PILOT_LOTS').length, 0);
  h.c.pilotSave_(sheets, items, config, window);
  assert.equal(data(h, 'PILOT_EVENTS').length, 1); assert.equal(data(h, 'PILOT_LOTS').length, 1);
});

test('quarantine clears only on explicit resolved evidence; query omission does not delete snapshot', () => {
  const {h, config, window} = pilotFixture(), sheets = h.c.pilotSheets_();
  h.c.pilotSave_(sheets, new Map([['102', pilotRow(102, {Plans: []})]]), config, window);
  assert.equal(data(h, 'PILOT_QUARANTINE').length, 1);
  h.c.pilotSave_(sheets, new Map(), config, window);
  assert.equal(data(h, 'PILOT_LOTS').length, 1); assert.equal(data(h, 'PILOT_QUARANTINE').length, 1);
  h.c.pilotSave_(sheets, new Map([['102', pilotRow()]]), config, window);
  assert.equal(data(h, 'PILOT_QUARANTINE').filter(r => r[0]).length, 0);
});

test('pilot output redacts reflected token and guards formula-like status values', () => {
  const {h, config, window} = pilotFixture(), token = h.properties.get('GOSZAKUP_TOKEN');
  const row = pilotRow(102, {nameRu: token, RefLotsStatus: {code: '=TEST()', nameRu: 'TEST'}});
  h.c.pilotSave_(h.c.pilotSheets_(), new Map([['102', row]]), config, window);
  assert.equal(data(h, 'PILOT_LOTS')[0][2], "'=TEST()");
  assert.ok(!JSON.stringify([...h.sheets.values()].map(s => s.rows)).includes(token));
});

test('cross-stream source changes keep coverage incomplete even after terminal pages', () => {
  const {h} = pilotFixture(); const row = pilotRow();
  pilotResponse(h, 'TrdBuy', []); pilotResponse(h, 'Lots', [row]); pilotResponse(h, 'TrdBuy', []);
  pilotResponse(h, 'Lots', [{...row, amount: 550000}]);
  const report = h.c.runTenderBoundedPilot();
  assert.equal(report.sourceChangedDuringRun, true); assert.equal(report.complete, false);
  assert.equal(report.sourceDateTimezone, 'Asia/Almaty');
  assert.equal(report.displayTimezone, 'Asia/Almaty');
  assert.equal(report.displayUtcOffset, '+05:00');
  assert.equal(report.uniqueLots, 1);
});

test('pilot lot cap leaves a partial report and never marks country or daily readiness', () => {
  const {h} = pilotFixture(); pilotResponse(h, 'TrdBuy', []);
  for (let offset = 0; offset < 220; offset += 20) {
    pilotResponse(h, 'Lots', Array.from({length: 20}, (_, i) => pilotRow(1000 - offset - i)),
      {total: 220, next: offset < 200});
  }
  const report = h.c.runTenderBoundedPilot();
  assert.equal(report.issue, 'PILOT_LOT_LIMIT'); assert.equal(report.uniqueLots, 200);
  assert.equal(report.complete, false); assert.equal(report.dailyCoverageVerified, false);
  assert.equal(report.mvpReady, false); assert.equal(h.triggers.length, 0);
});

test('method IDs of an unexpected type are quarantined and cannot execute a sheet formula', () => {
  const {h, config, window} = pilotFixture(), row = pilotRow(102, {refBuyTradeMethodsId: '=TEST()'});
  h.c.pilotSave_(h.c.pilotSheets_(), new Map([['102', row]]), config, window);
  assert.equal(data(h, 'PILOT_LOTS')[0][5], '');
  assert.equal(data(h, 'PILOT_QUARANTINE')[0][1], 'API_LOT_METHOD_INVALID');
});

test('same status transition on a later revision produces a new observed event', () => {
  const {h, config, window} = pilotFixture(), sheets = h.c.pilotSheets_();
  const open = pilotRow(), closed = pilotRow(102, {RefLotsStatus: {code: 'TEST_CLOSED'}});
  for (const row of [open, closed, open, closed]) h.c.pilotSave_(sheets, new Map([['102', row]]), config, window);
  assert.deepEqual(data(h, 'PILOT_EVENTS').map(r => r[2]), ['NEW_PUBLICATION', 'STATUS_CHANGED', 'STATUS_CHANGED', 'STATUS_CHANGED']);
  assert.equal(new Set(data(h, 'PILOT_EVENTS').map(r => r[0])).size, 4);
});

test('explicit diagnostic IDs can supply eligible sample when initial registry pages are all deleted', () => {
  const {h} = pilotFixture();
  h.properties.set('GOSZAKUP_DIAGNOSTIC_LOT_IDS', '[43495954]');
  graphResponse(h, introspectionFromOfficialSdl());
  graphResponse(h, {Lots: [v3Lot(102, {isDeleted: 1, Plans: []})]});
  graphResponse(h, {Lots: []});
  graphResponse(h, {Lots: [v3Lot(43495954)]});
  const report = h.c.testGoszakupV3Connection();
  assert.equal(report.mvpReady, true); assert.equal(report.targetedItemsChecked, 1);
  assert.equal(report.eligibleNormalizedSamples, 1); assert.equal(report.itemsChecked, 1);
  assert.equal(report.fullCountryCoverageVerified, false);
  assert.throws(() => h.c.syncTenderLots(), /FULL_SCAN_DISABLED/);
});

test('targeted diagnostic refuses foreign sample IDs and does not retain readiness proof', () => {
  const {h} = pilotFixture(); h.properties.set('GOSZAKUP_DIAGNOSTIC_LOT_IDS', '[43495954]');
  graphResponse(h, introspectionFromOfficialSdl());
  graphResponse(h, {Lots: []}, null, {limitPage: 100, totalCount: 0, hasNextPage: false});
  graphResponse(h, {Lots: [v3Lot(999)]});
  assert.throws(() => h.c.testGoszakupV3Connection(), /API_DIAGNOSTIC_IDS_MISMATCH/);
  assert.equal(h.properties.has('TENDER_V3_VERIFIED_CONFIG'), false);
});

test('bad publication date is quarantined and never called a new publication', () => {
  const {h, config, window} = pilotFixture(), row = pilotRow(); row.TrdBuy.publishDate = 'NOT_A_DATE';
  h.c.pilotSave_(h.c.pilotSheets_(), new Map([['102', row]]), config, window);
  assert.equal(data(h, 'PILOT_QUARANTINE')[0][1], 'API_SOURCE_DATE_INVALID');
  assert.equal(data(h, 'PILOT_EVENTS')[0][2], 'FIRST_OBSERVED');
});

test('missing Plans in registry samples are quarantined; verified goods permit bounded pilot only', () => {
  const {h, config} = pilotFixture(); h.properties.set('GOSZAKUP_DIAGNOSTIC_LOT_IDS', '[43495954]');
  graphResponse(h, introspectionFromOfficialSdl());
  graphResponse(h, {Lots: [v3Lot(102, {Plans: []})]}); graphResponse(h, {Lots: []});
  graphResponse(h, {Lots: [v3Lot(43495954)]});
  const report = h.c.testGoszakupV3Connection();
  assert.equal(report.mvpReady, true);
  assert.equal(report.subjectTypeQuarantineSamples, 1);
  assert.deepEqual(json(report.subjectTypeQuarantineIds), [102]);
  assert.deepEqual(json(report.normalizationErrors), []);
  assert.equal(report.eligibleNormalizedSamples, 1);
  assert.equal(report.boundedPilotOnly, true);
  assert.equal(report.fullCountryCoverageVerified, false);
  assert.equal(h.properties.get('TENDER_V3_VERIFIED_CONFIG'), config.fingerprint);
  assert.throws(() => h.c.syncTenderLots(), /FULL_SCAN_DISABLED/);
  assert.throws(() => h.c.installDailyTrigger(), /FULL_SCAN_DISABLED/);
  assert.equal(h.triggers.length, 0);
});

test('invalid goods dates still block readiness even when another sample normalizes', () => {
  const {h} = pilotFixture();
  graphResponse(h, introspectionFromOfficialSdl());
  graphResponse(h, {Lots: [v3Lot(102, {TrdBuy: {...v3Lot().TrdBuy, publishDate: 'BAD_DATE'}})]});
  graphResponse(h, {Lots: [v3Lot(101)]});
  const report = h.c.testGoszakupV3Connection();
  assert.equal(report.mvpReady, false);
  assert.ok(report.normalizationErrors.includes('API_SOURCE_DATE_INVALID'));
  assert.equal(report.subjectTypeQuarantineSamples, 0);
  assert.equal(h.properties.has('TENDER_V3_VERIFIED_CONFIG'), false);
});

test('national gate refresh adds unknown lots and preserves manual evidence on rerun', () => {
  const h = harness(); h.setup();
  const header = ['LOT_ID','HASH','STATUS','CLASSIFICATION','PLANNED_METHOD_ID','ACTUAL_METHOD_ID','PUBLISHED_RAW','NORMALIZED_JSON','FIRST_OBSERVED','LAST_OBSERVED','REVISION'];
  const source = h.sheets.get('PILOT_LOTS') || h.sheets.get('PILOT_LOTS') ||
    (() => { const sheet = h.c.SpreadsheetApp.getActiveSpreadsheet().insertSheet('PILOT_LOTS'); return sheet; })();
  source.appendRow(header);
  const first = lot('101');
  source.appendRow(['101', 'hash', 'PublishedOfferAccept', 'ELIGIBLE_GOODS', 3, 3, '',
    JSON.stringify(first), now, now, 1]);
  const r1 = h.c.refreshTenderNationalGate();
  assert.equal(r1.added, 1);
  const gate = h.sheets.get('NATIONAL_GATE');
  assert.equal(gate.rows[1][6], 'НЕ ПРОВЕРЕНО');
  assert.equal(gate.rows[1][10].includes('HOLD_NATIONAL'), true);
  gate.rows[1][6] = 'НЕТ';
  gate.rows[1][7] = 'https://goszakup.gov.kz/proof';
  gate.rows[1][8] = '2026-10-09';
  gate.rows[1][9] = 'Портал: Изъятие из национального режима — Нет';
  const r2 = h.c.refreshTenderNationalGate();
  assert.equal(r2.added, 0);
  assert.equal(gate.rows[1][6], 'НЕТ');
  assert.equal(gate.rows[1][7], 'https://goszakup.gov.kz/proof');
  source.appendRow(['102', 'hash', 'PublishedOfferAccept', 'ELIGIBLE_GOODS', 3, 3, '',
    JSON.stringify(lot('102')), now, now, 1]);
  const r3 = h.c.refreshTenderNationalGate();
  assert.equal(r3.added, 1);
  assert.equal(gate.rows[2][0], '102');
  assert.equal(gate.rows[2][6], 'НЕ ПРОВЕРЕНО');
  assert.equal(h.triggers.length, 0);
});

test('national KTRU probe reads only exact three pilot goods and never grants a regime verdict', () => {
  const h = harness(); h.setup();
  const pilot = h.c.SpreadsheetApp.getActiveSpreadsheet().insertSheet('PILOT_LOTS');
  pilot.appendRow(['LOT_ID','HASH','STATUS','CLASSIFICATION','PLANNED_METHOD_ID','ACTUAL_METHOD_ID','PUBLISHED_RAW','NORMALIZED_JSON','FIRST_OBSERVED','LAST_OBSERVED','REVISION']);
  for (let n = 101; n <= 104; n++) {
    pilot.appendRow([String(n),'hash','PublishedOfferAccept','ELIGIBLE_GOODS',3,3,'',
      JSON.stringify(lot(String(n))),now,now,1]);
  }
  h.properties.set('GOSZAKUP_TOKEN','SYNTHETIC_TOKEN');
  const before = json([...h.sheets].map(([name,s]) => [name,s.rows]));
  h.responses.push({status:200,body:JSON.stringify({data:{Lots:[
    {id:101,pointList:[22],Plans:[{id:22,refSubjectTypeId:1,refEnstruCode:'32.50.12.000'}]},
    {id:102,pointList:[23],Plans:[{id:23,refSubjectTypeId:1,refEnstruCode:'33.12.45.120'}]},
    {id:103,pointList:[24,25],Plans:[{id:24,refSubjectTypeId:1,refEnstruCode:'33.12.45.120'},{id:25,refSubjectTypeId:1,refEnstruCode:'45.12.54.001'}]}
  ]}})});
  const report=h.c.inspectTenderNationalKtru();
  assert.equal(report.sampled,3);
  assert.equal(report.candidates,4);
  assert.equal(report.automaticallyDeterminedNationalRegime,0);
  assert.equal(report.readyToSkip,false);
  assert.deepEqual(json(report.items.map(v=>v.planCoverageVerified)),[true,true,true]);
  assert.deepEqual(json(report.items[2].ktruCodes),['33.12.45.120','45.12.54.001']);
  assert.equal(JSON.parse(h.fetchCalls[0].options.payload).variables.filter.id.join(','),'101,102,103');
  assert.deepEqual(json([...h.sheets].map(([name,s]) => [name,s.rows])),before);
  assert.equal(h.triggers.length,0);
});

test('national KTRU probe with incomplete plans remains UNVERIFIED and never mutates state', () => {
  const h = harness(); h.setup();
  const pilot = h.c.SpreadsheetApp.getActiveSpreadsheet().insertSheet('PILOT_LOTS');
  pilot.appendRow(['LOT_ID','HASH','STATUS','CLASSIFICATION','PLANNED_METHOD_ID','ACTUAL_METHOD_ID','PUBLISHED_RAW','NORMALIZED_JSON','FIRST_OBSERVED','LAST_OBSERVED','REVISION']);
  pilot.appendRow(['101','hash','PublishedOfferAccept','ELIGIBLE_GOODS',3,3,'',JSON.stringify(lot('101')),now,now,1]);
  h.properties.set('GOSZAKUP_TOKEN','SYNTHETIC_TOKEN');
  h.responses.push({status:200,body:JSON.stringify({data:{Lots:[
    {id:101,pointList:[22,23],Plans:[{id:22,refSubjectTypeId:1,refEnstruCode:'11.22.33.444'}]}
  ]}})});
  const report=h.c.inspectTenderNationalKtru();
  assert.equal(report.items[0].nationalRegime,'UNVERIFIED');
  assert.equal(report.items[0].planCoverageVerified,false);
  assert.deepEqual(json(report.items[0].ktruCodes),[]);
  assert.equal(report.items[0].reason,'MISSING_LOT_OR_PLAN_COVERAGE');
});

// Offline national-gate regression cases; all lot/plan responses here are
// SYNTHETIC. These cases do not verify any real lot's national-regime flag.
function nationalProbeFixture() {
  const h = harness(); h.setup();
  const pilot = h.c.SpreadsheetApp.getActiveSpreadsheet().insertSheet('PILOT_LOTS');
  pilot.appendRow(['LOT_ID','HASH','STATUS','CLASSIFICATION','PLANNED_METHOD_ID',
    'ACTUAL_METHOD_ID','PUBLISHED_RAW','NORMALIZED_JSON','FIRST_OBSERVED','LAST_OBSERVED','REVISION']);
  pilot.appendRow(['101','synthetic-hash','PublishedOfferAccept','ELIGIBLE_GOODS',3,3,'',
    JSON.stringify(lot('101')),now,now,1]);
  h.properties.set('GOSZAKUP_TOKEN','SYNTHETIC_NATIONAL_TOKEN');
  const snapshot = () => json({sheets:[...h.sheets].map(([name,s])=>[name,s.rows]),
    properties:[...h.properties], triggers:h.triggers});
  return {h,pilot,snapshot,raw:{id:101,pointList:[22],
    Plans:[{id:22,refSubjectTypeId:1,refEnstruCode:'11.22.33.444'}]}};
}

test('national refresh preserves all owner G:L cells, unrelated lots and ALL_LOTS', () => {
  const {h} = nationalProbeFixture();
  h.c.refreshTenderNationalGate();
  const gate = h.sheets.get('NATIONAL_GATE');
  const owner = ['ДА','https://goszakup.gov.kz/synthetic-proof','2026-01-01',
    'SYNTHETIC old owner evidence; not independently validated','=OWNER_FORMULA()', 'Owner note'];
  gate.rows[1].splice(6,6,...owner);
  gate.appendRow(['999','old owner lot',1,'old','UNKNOWN','',...owner]);
  const retained = [...gate.rows[2]], all = json(h.sheets.get('ALL_LOTS').rows);
  h.c.refreshTenderNationalGate(); h.c.refreshTenderNationalGate();
  assert.deepEqual(gate.rows[1].slice(6,12),owner);
  assert.deepEqual(gate.rows[2],retained);
  assert.deepEqual(json(h.sheets.get('ALL_LOTS').rows),all);
});

test('national probe rejects duplicate pilot IDs before HTTP or mutation', () => {
  const {h,pilot,snapshot} = nationalProbeFixture();
  pilot.appendRow([...pilot.rows[1]]);
  const before = snapshot();
  assert.throws(()=>h.c.inspectTenderNationalKtru(),/NATIONAL_KTRU_PILOT_ID_INVALID/);
  assert.equal(h.fetchCalls.length,0);
  assert.deepEqual(snapshot(),before);
});

for (const scenario of ['duplicate API IDs','unexpected API ID']) {
  test('national probe rejects '+scenario+' without writing evidence', () => {
    const {h,snapshot,raw} = nationalProbeFixture(), before = snapshot();
    const Lots = scenario==='duplicate API IDs'?[raw,raw]:[{...raw,id:999}];
    h.responses.push({status:200,body:JSON.stringify({data:{Lots}})});
    assert.throws(()=>h.c.inspectTenderNationalKtru(),/NATIONAL_KTRU_ID_MISMATCH/);
    assert.deepEqual(snapshot(),before);
  });
}

for (const scenario of ['missing lot','non-goods plan','duplicate plan','duplicate point']) {
  test('national probe remains UNVERIFIED for '+scenario, () => {
    const {h,snapshot,raw} = nationalProbeFixture(), before = snapshot();
    if (scenario==='non-goods plan') raw.Plans[0].refSubjectTypeId=2;
    if (scenario==='duplicate plan') {raw.pointList=[22,23];raw.Plans.push({...raw.Plans[0]});}
    if (scenario==='duplicate point') {raw.pointList=[22,22];raw.Plans.push({...raw.Plans[0]});}
    h.responses.push({status:200,body:JSON.stringify({data:{Lots:scenario==='missing lot'?[]:[raw]}})});
    const report=h.c.inspectTenderNationalKtru();
    assert.equal(report.items[0].nationalRegime,'UNVERIFIED');
    assert.equal(report.items[0].planCoverageVerified,false);
    assert.equal(report.automaticallyDeterminedNationalRegime,0);
    assert.equal(report.readyToSkip,false);
    assert.deepEqual(snapshot(),before);
  });
}

for (const scenario of ['HTTP 403','CONNECT 403','long Retry-After']) {
  test('national probe safely stops on '+scenario+' without leaking response or changing state', () => {
    const {h,snapshot} = nationalProbeFixture(), before = snapshot();
    const response = scenario==='CONNECT 403'?new Error('CONNECT 403 SYNTHETIC_NATIONAL_TOKEN'):
      {status:scenario==='HTTP 403'?403:429, body:'SYNTHETIC_NATIONAL_TOKEN',
        headers:scenario==='long Retry-After'?{'Retry-After':'120'}:{}};
    h.responses.push(response);
    const code=scenario==='CONNECT 403'?'API_PROXY_CONNECT_403':
      scenario==='HTTP 403'?'API_HTTP_403':'API_RATE_LIMIT';
    assert.throws(()=>h.c.inspectTenderNationalKtru(), e=>
      e.message.includes(code) && !e.message.includes('SYNTHETIC_NATIONAL_TOKEN'));
    assert.equal(h.fetchCalls.length,1);
    assert.equal(h.sleeps.length,0);
    assert.deepEqual(snapshot(),before);
  });
}

test('national probe replay preserves state and sends Bearer only to OWS without redirects', () => {
  const {h,snapshot,raw} = nationalProbeFixture(), before = snapshot();
  const reply={status:200,body:JSON.stringify({data:{Lots:[raw]}})};
  h.responses.push(reply,reply);
  const first=json(h.c.inspectTenderNationalKtru()), second=json(h.c.inspectTenderNationalKtru());
  assert.deepEqual(first,second);
  assert.deepEqual(snapshot(),before);
  for(const call of h.fetchCalls){
    assert.match(call.url,/^https:\/\/ows\.goszakup\.gov\.kz\//);
    assert.equal(call.options.followRedirects,false);
    assert.equal(call.options.validateHttpsCertificates,true);
  }
});

test('national source inventory retains actual legal clauses but never grants lot verdicts', () => {
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'docs/national/sources.json'),'utf8'));
  assert.equal(inventory.purpose,'RESEARCH_ONLY_NOT_A_LOT_CLASSIFIER');
  assert.equal(inventory.inventoryComplete,false);
  assert.equal(inventory.listVersionVerified,false);
  assert.equal(inventory.currentLotVerdictsVerified,false);
  const sources=new Map(inventory.sources.map(s=>[s.documentId,s]));
  assert.equal(sources.size,6);
  for(const source of sources.values()){
    assert.match(source.url,/^https:\/\/old\.adilet\.zan\.kz\/rus\/docs\/[ZP]\d+$/);
    assert.equal(source.httpStatus,200);
    assert.match(source.htmlSha256,/^[a-f0-9]{64}$/);
    assert.ok(source.textExcerpt.includes('национального режима'));
  }
  assert.match(sources.get('Z2400000106').textExcerpt,/не более двух лет/);
  assert.match(sources.get('P2600000764').textExcerpt,/21\), 22\) и 23\)/);
  assert.match(sources.get('P2500000824').textExcerpt,/с 28 октября 2025/);
  assert.match(sources.get('P2500000824').textExcerpt,/с 1\s+января 2026/);
  assert.deepEqual(inventory.pilotLots.map(v=>v.lotId),['43543910','43544048','43544131']);
  for(const item of inventory.pilotLots){
    assert.equal(item.nationalRegime,'UNVERIFIED');
    assert.equal(item.gateDecision,'HOLD_NATIONAL');
    assert.equal(item.lotDataVerifiedThisTask,false);
    assert.equal(item.planCoverageVerified,false);
    assert.equal(item.ktruCodes,null);
  }
  const blocked=inventory.blockedSources.find(s=>s.proxyConnectStatus===403);
  assert.equal(blocked.httpStatus,null);
  assert.equal(blocked.tokenValidityDetermined,false);
});
