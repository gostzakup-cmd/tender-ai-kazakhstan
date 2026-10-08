/** Чистые проверки прямо в Apps Script; не обращаются к API и таблицам. */
function runTenderSelfTests() {
  const cases = [];
  function check(name, fn) {
    fn();
    cases.push(name);
  }
  function expect(condition) { if (!condition) throw new Error('SELF_TEST_FAILED: ' + cases.length); }
  function fails(fn) { let failed = false; try { fn(); } catch (e) { failed = true; } expect(failed); }
  // Искусственная внутренняя модель, не ответ Goszakup API.
  const sample = {
    id: '101', procurementNumber: 'TEST', lotNumber: 'TEST', name: 'Тестовый товар',
    quantity: 2, amount: 10000000, customerName: 'Тестовый заказчик', customerBin: '000000000001',
    publishedAt: '2026-10-08T08:00:00+05:00', applicationStart: '2026-10-08T09:00:00+05:00',
    deadline: '2026-10-10T18:00:00+05:00', status: 'TEST',
    url: 'https://goszakup.gov.kz/test-only/101', isGoods: true, isActive: true
  };
  check('limit_inclusive', function () { expect(eligible_(sample)); });
  check('over_limit', function () { expect(!eligible_(Object.assign({}, sample, {amount: 10000000.01}))); });
  check('goods_only', function () { expect(!eligible_(Object.assign({}, sample, {isGoods: false}))); });
  check('duplicate_replay', function () { expect(mergeLots_([], [sample, sample], 'first').length === 1); });
  check('update_preserves_first_seen', function () {
    const rows = mergeLots_([], [sample], 'first');
    const updated = mergeLots_(rows, [Object.assign({}, sample, {amount: 5})], 'second');
    expect(updated.length === 1 && updated[0][5] === 5 && updated[0][13] === 'first');
  });
  check('changed_eligibility', function () {
    expect(mergeLots_(mergeLots_([], [sample], 'first'),
      [Object.assign({}, sample, {isGoods: false})], 'second').length === 0);
  });
  check('reject_bad_amount', function () { fails(function () { validateLot_(Object.assign({}, sample, {amount: NaN})); }); });
  check('reject_ambiguous_date', function () { fails(function () { validateLot_(Object.assign({}, sample, {publishedAt: '2026-10-08 08:00:00'})); }); });
  check('formula_escaping', function () { expect(safeText_('=1+1') === "'=1+1"); });
  check('empty_intermediate_page', function () { validatePage_({lots: [], nextCursor: 'next'}, null); });
  check('cursor_stalled', function () { fails(function () { validatePage_({lots: [], nextCursor: 'same'}, 'same'); }); });
  check('raw_cursor_host_restriction', function () { fails(function () { rawLotsPath_('https://example.com/lots?page=next&search_after=1'); }); });
  const result = { passed: cases.length, total: cases.length, cases: cases, apiTested: false, sheetsModified: false };
  console.log(JSON.stringify(result));
  return result;
}
