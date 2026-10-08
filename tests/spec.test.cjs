'use strict';
// Specification/contract tests only. No network, Google writes, real product data or AI calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
// Ajv is already pinned transitively by the existing tools/ci/package-lock.json.
const Ajv = require('../tools/ci/node_modules/ajv');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const load = file => JSON.parse(read(file));
const spec = load('docs/spec/requirements.json');
const catalog = load('docs/spec/categories.json');
const schema = load('docs/spec/contracts.schema.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const xml = execFileSync('unzip', ['-p', path.join(root, 'docs/spec/source.docx'), 'word/document.xml'], {encoding: 'utf8'});
function decode(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, v) => String.fromCodePoint(parseInt(v, 16)))
    .replace(/&#(\d+);/g, (_, v) => String.fromCodePoint(Number(v)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
const allRuns = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => decode(m[1]));
const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
  .map(m => [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x => decode(x[1])).join('')).filter(Boolean);
const ajv = new Ajv({strict: true, allErrors: true});
ajv.compile(schema);
const validator = name => ajv.compile({$schema: schema.$schema, definitions: schema.definitions, $ref: '#/definitions/' + name});
const validateAssessment = validator('Assessment');
const stamp = '2026-10-08T03:00:00Z';
const fakeHash = 'a'.repeat(64);
const guardNames = schema.definitions.Assessment.properties.guards.required;
// These are deliberately synthetic contract objects, not API answers or commercial analyses.
function assessment(overrides = {}) {
  return {kind: 'ASSESSMENT', lotsId: '101', documentSetHash: fakeHash, comparisonPercent: 100,
    confidence: 'HIGH', decision: 'GO', reasonCodes: ['SYNTHETIC_CONTRACT_CASE_ONLY'],
    priceBasis: 'OFFICIAL_CONFIRMED', availabilityEvidence: 'CONFIRMED_FULL_QUANTITY',
    potentialFullCostProfitKzt: 100, potentialFullCostMarginPercent: 10,
    calculationMode: 'FULL_COST_BUDGET', guards: Object.fromEntries(guardNames.map(k => [k, true])),
    evidenceIds: ['SYNTHETIC_EVIDENCE'], checkedAt: stamp, ...overrides};
}

test('original DOCX hash and every XML text run are preserved without shortening', () => {
  assert.equal(digest(fs.readFileSync(path.join(root, 'docs/spec/source.docx'))), spec.source.sha256);
  assert.equal(allRuns.length, spec.source.bodyTextRunCount);
  assert.equal(paragraphs.length, spec.source.bodyParagraphCount);
  assert.equal(paragraphs.join(''), allRuns.join(''));
  assert.deepEqual(spec.intro.concat(...spec.sections.map(s => s.verbatim)), paragraphs);
  assert.ok(spec.sections.at(-1).verbatim.at(-1).includes('ПРОВЕРЯЕМЫХ ИСТОЧНИКОВ'));
});

test('all 50 sections have contiguous original ranges, GAP mappings and acceptance criteria', () => {
  assert.equal(spec.sections.length, 50);
  assert.deepEqual(spec.sections.map(s => s.number), Array.from({length: 50}, (_, i) => i + 1));
  const gap = read('docs/spec/GAP.md'), roadmap = read('docs/spec/IMPLEMENTATION.md');
  let previous = spec.intro.length;
  for (const s of spec.sections) {
    assert.equal(s.id, 'S' + String(s.number).padStart(2, '0'));
    assert.equal(s.sourceParagraphs[0], previous + 1);
    assert.deepEqual(s.verbatim, paragraphs.slice(s.sourceParagraphs[0] - 1, s.sourceParagraphs[1]));
    assert.equal(s.verbatim[0], s.number + '. ' + s.title);
    assert.equal(gap.split('| ' + s.id + ' ').length - 1, 1);
    assert.ok(gap.includes(s.acceptance)); assert.ok(s.missingModules.length); assert.ok(s.acceptance.length > 40);
    assert.ok(s.plannedPrs.length);
    for (const pr of s.plannedPrs) assert.ok(roadmap.includes(pr), pr + ' absent from plan');
    for (const module of s.existingModules) assert.ok(fs.existsSync(path.join(root, module)), module + ' missing');
    previous = s.sourceParagraphs[1];
  }
  assert.equal(previous, paragraphs.length);
});

test('79 original categories, overlaps and every literal slash variant survive exactly', () => {
  const original = spec.sections[5].verbatim.slice(1);
  assert.equal(catalog.categories.length, 79);
  assert.deepEqual(catalog.categories.map(c => c.id), Array.from({length: 79}, (_, i) => i + 1));
  assert.equal(catalog.sourceSha256, spec.source.sha256);
  for (const [i, c] of catalog.categories.entries()) {
    assert.equal(c.id + '. ' + c.label, original[i]);
    assert.equal(paragraphs[c.sourceParagraph - 1], original[i]);
    assert.deepEqual(c.literalTerms, c.label.split(' / '));
    for (const alias of Object.values(c.aliases).flat()) assert.ok(c.literalTerms.includes(alias));
    for (const brand of c.brands) assert.ok(c.label.includes(brand));
    assert.deepEqual(c.partNumbers, []); // DOCX provides no actual part-number values.
    assert.equal(c.enrichmentStatus, 'SOURCE_LITERALS_ONLY_REVIEW_REQUIRED');
  }
  assert.ok(catalog.categories.some(c => c.aliases.kk.includes('ер-тоқым')));
  for (const name of ['Жесткий диск', 'HDD', 'Картриджи', 'Картридж', 'Скальные ботинки', 'Скальные туфли', 'Reach / Reychen', 'SDR', 'Гамма']) {
    assert.equal(catalog.categories.filter(c => c.label === name).length, 1);
  }
});

test('all 15 current user additions trace to original sections and planned delivery', () => {
  assert.deepEqual(spec.userAdditions.map(u => u.id), Array.from({length: 15}, (_, i) => 'U' + String(i + 1).padStart(2, '0')));
  const ids = new Set(spec.sections.map(s => s.id));
  for (const u of spec.userAdditions) {
    assert.ok(u.requirement.length); assert.ok(u.sections.length); assert.ok(u.plannedPrs.length);
    for (const id of u.sections) assert.ok(ids.has(id));
    assert.ok(read('docs/spec/GAP.md').includes(u.requirement));
  }
});

test('19 and 15 user columns are exact DOCX values with no technical ID/decision columns', () => {
  const layout = schema.definitions.UserSheets.properties;
  const main = spec.sections[26].verbatim.slice(1).filter(s => /^\d+\. /.test(s)).map(s => s.replace(/^\d+\. /, ''));
  const top = spec.sections[35].verbatim.find(s => s.startsWith('Колонки: ')).slice(9).replace(/\.$/, '').split('; ');
  assert.deepEqual(layout.mainHeaders.const, main); assert.equal(main.length, 19);
  assert.deepEqual(layout.topHeaders.const, top); assert.equal(top.length, 15);
  assert.equal(layout.mainName.const, 'Полный список лотов'); assert.equal(layout.topName.const, 'Топ по прибыльности');
  assert.ok(!main.includes('LOTS_ID')); assert.ok(!top.includes('GO/REVIEW/NO-GO'));
});

test('all structural schemas compile strictly, reject unknown fields and cannot prove source truth', () => {
  for (const name of Object.keys(schema.definitions)) assert.equal(typeof validator(name), 'function');
  assert.equal(validateAssessment(assessment()), true, JSON.stringify(validateAssessment.errors));
  assert.equal(validateAssessment(assessment({fabricatedApproval: true})), false);
  assert.ok(schema.$comment.includes('cannot establish truth'));
});

for (const guard of guardNames) {
  test('GO contract rejects missing confirmation: ' + guard, () => {
    const object = assessment(); object.guards[guard] = false;
    assert.equal(validateAssessment(object), false);
  });
}

test('HIGH and GO are separate: national-regime unknown may be REVIEW but never GO', () => {
  const object = assessment({decision: 'REVIEW'}); object.guards.nationalRegimeVerified = false;
  assert.equal(validateAssessment(object), true, JSON.stringify(validateAssessment.errors));
  object.decision = 'GO'; assert.equal(validateAssessment(object), false);
});

test('MED cannot be GO and unknown stock cannot silently become MED or HIGH', () => {
  const med = assessment({confidence: 'MED', decision: 'REVIEW', comparisonPercent: 95,
    availabilityEvidence: 'CONFIRMED_AVAILABILITY_ONLY', potentialFullCostProfitKzt: null,
    potentialFullCostMarginPercent: null, calculationMode: 'BASE_BUDGET'});
  med.guards.fullQuantityInStockVerified = false; med.guards.deliveryVerified = false;
  med.guards.allMaterialExpensesVerified = false;
  assert.equal(validateAssessment(med), true, JSON.stringify(validateAssessment.errors));
  med.decision = 'GO'; assert.equal(validateAssessment(med), false);
  med.decision = 'REVIEW'; med.availabilityEvidence = 'UNKNOWN'; assert.equal(validateAssessment(med), false);
});

test('100 percent technical comparison with unconfirmed price is not HIGH', () => {
  const object = assessment({confidence: 'LOW', decision: 'REVIEW', priceBasis: 'UNCONFIRMED',
    potentialFullCostProfitKzt: null, potentialFullCostMarginPercent: null, calculationMode: 'UNAVAILABLE'});
  object.guards.priceFreshVerified = false; object.guards.priceConfigVerified = false;
  assert.equal(validateAssessment(object), true);
  object.confidence = 'HIGH'; assert.equal(validateAssessment(object), false);
});

test('target lots must be proven goods at inclusive 10m, unknown subject is not eligible', () => {
  const validate = validator('LotSnapshot');
  const object = {kind: 'LOT_SNAPSHOT', lotsId: '101', lotNumber: 'SYNTHETIC_LOT', trdBuyId: '201', procurementNumber: 'SYNTHETIC_BUY',
    lotBudgetKzt: 10000000, quantity: 1, unit: null, plannedMethodId: 3, actualMethodId: 6,
    goodsStatus: 'CONFIRMED_GOODS', targetEligible: true, statusCode: null, publishedRaw: null,
    publishedInstant: null, sourceTimezone: null, observedAt: stamp, evidenceIds: ['SYNTHETIC_EVIDENCE'], sourceHash: fakeHash};
  assert.equal(validate(object), true);
  object.lotBudgetKzt++; assert.equal(validate(object), false);
  object.lotBudgetKzt--; object.goodsStatus = 'UNKNOWN'; assert.equal(validate(object), false);
  object.targetEligible = false; assert.equal(validate(object), true);
  assert.notEqual(object.plannedMethodId, object.actualMethodId);
});

test('advertised unconfirmed price is retained separately and cannot be a confirmed zero', () => {
  const validate = validator('MoneyEvidence');
  const object = {kind: 'MONEY_EVIDENCE', currency: 'KZT', quotedAmount: '100', confirmedAmount: null,
    status: 'UNCONFIRMED', evidenceIds: [], checkedAt: null};
  assert.equal(validate(object), true);
  object.confirmedAmount = '0'; assert.equal(validate(object), false);
  object.status = 'CONFIRMED'; assert.equal(validate(object), false); // Missing evidence/time.
});

test('confirmed FX requires nonzero rate, nominal and source; stale rate not used as confirmed', () => {
  const validate = validator('FxSnapshot');
  const object = {kind: 'FX_SNAPSHOT', fxId: 'SYNTHETIC_RATE', from: 'RUB', to: 'KZT', nominal: 100,
    quotedRate: '600', confirmedRate: '600', effectiveDate: '2026-10-08', status: 'CONFIRMED', evidenceIds: ['SYNTHETIC_SOURCE']};
  assert.equal(validate(object), true);
  object.confirmedRate = '0'; assert.equal(validate(object), false);
  object.confirmedRate = '600'; object.nominal = null; assert.equal(validate(object), false);
  object.nominal = 100; object.status = 'STALE'; assert.equal(validate(object), false);
});

test('full PDF and confirmed matching need source evidence, byte version and page records', () => {
  const document = validator('DocumentVersion');
  const object = {kind: 'DOCUMENT_VERSION', documentId: 'SYNTHETIC_DOC', lotsId: '101', lotNumber: 'SYNTHETIC_LOT', trdBuyId: '201',
    documentScope: 'LOTS_FILES', originalName: 'SYNTHETIC_TS.pdf', driveFileId: null, byteSha256: null, documentSetHash: null,
    bindingStatus: 'UNCONFIRMED', currentVersionStatus: 'UNCONFIRMED', bindingEvidenceIds: [], completeRead: false,
    pageCount: null, pagesRead: [], supersedes: null, observedAt: stamp};
  assert.equal(document(object), true); object.completeRead = true; assert.equal(document(object), false);
  object.completeRead = false; object.bindingStatus = 'CONFIRMED'; assert.equal(document(object), false);
  const match = validator('Match');
  assert.equal(match({kind: 'REQUIREMENT_MATCH', lotsId: '101', requirementId: 'R1', offerId: 'O1',
    result: 'MATCH', critical: true, productValue: 'SYNTHETIC_PARAMETER', evidenceIds: [], reason: 'SYNTHETIC'}), false);
});

test('unknown material costs block full-cost totals and unknown goods price blocks profit', () => {
  const validate = validator('Calculation');
  const object = {kind: 'CALCULATION', calculationId: 'SYNTHETIC_CALC', lotsId: '101', scenario: 'BASE_BUDGET',
    revenueBasis: 'LOT_BUDGET_UPPER_BOUND', budgetKzt: '1196000', revenueKzt: null, goodsInputsConfirmed: true,
    goodsCostKzt: '237600', fullCostKzt: null, baseProfitKzt: '958400', baseMarginPercent: 958400 / 1196000 * 100,
    fullCostProfitKzt: null, fullCostMarginPercent: null, unknownInputs: ['DELIVERY_UNKNOWN'],
    inputRecordIds: ['SYNTHETIC_INPUT'], checkedAt: stamp};
  assert.equal(validate(object), true);
  assert.equal((object.baseMarginPercent).toFixed(1), '80.1'); // Literal DOCX example, not real lot economics.
  object.fullCostKzt = '237600'; assert.equal(validate(object), false);
  object.fullCostKzt = null; object.goodsInputsConfirmed = false; assert.equal(validate(object), false);
});

test('public documentation provenance has complete successful reads, not authenticated execution', () => {
  const sources = load('docs/spec/sources.json');
  assert.ok(sources.checks.includes('no authenticated')); assert.ok(sources.sources.length >= 16);
  for (const source of sources.sources) {
    assert.equal(source.status, 200); assert.equal(source.curlExit, 0);
    assert.match(source.url, /^https:\/\//); assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
});
