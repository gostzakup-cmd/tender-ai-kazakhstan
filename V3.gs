/** Source: https://ows.goszakup.gov.kz/help/v3/schema/lots.doc.html */
const V3_FIELDS = Object.freeze({
  id: 'id', lotNumber: 'lotNumber', procurementNumber: 'trdBuyNumberAnno',
  name: 'nameRu', nameKz: 'nameKz', quantity: 'count', amount: 'amount',
  customerName: 'customerNameRu', customerNameKz: 'customerNameKz', customerBin: 'customerBin',
  announcementId: 'trdBuyId', deleted: 'isDeleted', pointList: 'pointList',
  planIds: 'Plans.id', goodsTypes: 'Plans.refSubjectTypeId',
  publishedAt: 'TrdBuy.publishDate', applicationStart: 'TrdBuy.startDate', deadline: 'TrdBuy.endDate',
  repeatStart: 'TrdBuy.repeatStartDate', repeatEnd: 'TrdBuy.repeatEndDate',
  status: 'RefLotsStatus.code', statusName: 'RefLotsStatus.nameRu', statusId: 'refLotStatusId'
});
const V3_PROOF_KEY = 'TENDER_V3_VERIFIED_CONFIG';
const V3_DIAGNOSTIC_KEY = 'TENDER_V3_DIAGNOSTIC';

function v3Config_() {
  const props = PropertiesService.getScriptProperties();
  const endpoint = (props.getProperty('GOSZAKUP_V3_ENDPOINT') || TENDER.v3Endpoint).trim();
  if (!/^https:\/\/ows\.goszakup\.gov\.kz\/[^?#\s]+$/.test(endpoint)) {
    throw safeApiError_('API_V3_ENDPOINT_REQUIRED: допустим только HTTPS endpoint официального ows.goszakup.gov.kz.');
  }
  let custom = {};
  const rawMap = props.getProperty('GOSZAKUP_V3_FIELD_MAP');
  try { if (rawMap) custom = JSON.parse(rawMap); }
  catch (e) { throw safeApiError_('API_FIELD_MAP_INVALID: требуется JSON-объект путей полей.'); }
  if (!custom || Array.isArray(custom) || typeof custom !== 'object') throw safeApiError_('API_FIELD_MAP_INVALID');
  const fields = Object.assign({}, V3_FIELDS);
  Object.keys(custom).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) throw safeApiError_('API_FIELD_MAP_INVALID: неизвестное внутреннее назначение поля.');
    const path = custom[key];
    if (typeof path !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/.test(path)) {
      throw safeApiError_('API_FIELD_MAP_INVALID: путь должен содержать только имена GraphQL-полей.');
    }
    if (path.split('.').some(function (x) { return ['__proto__', 'prototype', 'constructor'].includes(x); })) {
      throw safeApiError_('API_FIELD_MAP_INVALID: небезопасное имя поля.');
    }
    fields[key] = path;
  });
  // Деньги и количество могут браться только из самого Lots, никогда из Plans/TrdBuy.
  if (fields.amount.includes('.') || fields.quantity.includes('.')) {
    throw safeApiError_('API_LOT_VALUES_REQUIRED: amount и quantity должны ссылаться на поля самого Lots.');
  }
  const sizeRaw = props.getProperty('GOSZAKUP_PAGE_SIZE');
  const pageSize = sizeRaw ? Number(sizeRaw) : 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw safeApiError_('API_PAGE_SIZE_INVALID: допустимо 1–200.');
  let activeCodes = [];
  const rawCodes = props.getProperty('GOSZAKUP_ACTIVE_STATUS_CODES');
  try { if (rawCodes) activeCodes = JSON.parse(rawCodes); }
  catch (e) { throw safeApiError_('API_STATUS_CODES_INVALID: нужен JSON-массив проверенных кодов статуса.'); }
  if (!Array.isArray(activeCodes) || activeCodes.some(function (x) { return typeof x !== 'string' || !x; })) {
    throw safeApiError_('API_STATUS_CODES_INVALID');
  }
  const config = {
    endpoint: endpoint, fields: fields, pageSize: pageSize,
    dateTimezone: (props.getProperty('GOSZAKUP_API_DATE_TIMEZONE') || '').trim(),
    lotUrlTemplate: (props.getProperty('GOSZAKUP_LOT_URL_TEMPLATE') || '').trim(),
    activeCodes: activeCodes, goodsTypeId: 1 // official developer/ows_v3, ref_subject_type: 1 = Товар
  };
  config.fingerprint = fingerprint_(JSON.stringify(config));
  return config;
}

function fingerprint_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join('');
}

function v3RuntimeIssues_(config) {
  const issues = [];
  if (!config.dateTimezone) issues.push('SOURCE_DATE_TIMEZONE_REQUIRED');
  if (!config.activeCodes.length) issues.push('ACTIVE_STATUS_CODES_REQUIRED');
  if (!/^https:\/\/(?:www\.|old\.)?goszakup\.gov\.kz\/\S+$/.test(config.lotUrlTemplate) ||
      !config.lotUrlTemplate.includes('{id}') ||
      /\{(?!id\}|trdBuyId\})/.test(config.lotUrlTemplate)) issues.push('VERIFIED_LOT_URL_TEMPLATE_REQUIRED');
  if (config.dateTimezone) {
    try { Utilities.formatDate(new Date(), config.dateTimezone, 'yyyy-MM-dd'); }
    catch (e) { issues.push('SOURCE_DATE_TIMEZONE_INVALID'); }
  }
  return issues;
}

function assertV3Ready_() {
  const config = v3Config_();
  apiToken_();
  const issues = v3RuntimeIssues_(config);
  if (issues.length) throw safeApiError_('API_V3_CONFIGURATION_REQUIRED: ' + issues.join(', '));
  if (PropertiesService.getScriptProperties().getProperty(V3_PROOF_KEY) !== config.fingerprint) {
    throw safeApiError_('API_V3_LIVE_CHECK_REQUIRED: выполните testGoszakupV3Connection после настройки или изменения конфигурации.');
  }
  return config;
}

function graphql_(config, query, variables) {
  return graphqlResponse_(config, query, variables).data;
}

function graphqlResponse_(config, query, variables) {
  const result = fetchJsonWithRetry_(config.endpoint, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiToken_(), Accept: 'application/json' },
    payload: JSON.stringify({ query: query, variables: variables || {} })
  });
  if (!result || (Object.prototype.hasOwnProperty.call(result, 'errors') &&
      (!Array.isArray(result.errors) || result.errors.length))) {
    throw safeApiError_('API_GRAPHQL_ERRORS: сервер отклонил GraphQL-запрос; тела ошибок не логируются.');
  }
  if (!result.data || typeof result.data !== 'object') throw safeApiError_('API_GRAPHQL_DATA_MISSING');
  return result;
}

function selection_(fields) {
  const tree = Object.create(null);
  Object.keys(fields).forEach(function (key) {
    let node = tree;
    fields[key].split('.').forEach(function (part) { node[part] = node[part] || Object.create(null); node = node[part]; });
  });
  function print(node) {
    return Object.keys(node).sort().map(function (key) {
      return key + (Object.keys(node[key]).length ? ' { ' + print(node[key]) + ' }' : '');
    }).join(' ');
  }
  return print(tree);
}

function v3LotsQuery_(config) {
  // No undocumented amount/date filters: full scan also catches changes to old lots.
  return 'query TenderLots($limit: Int!, $after: Int) { Lots(limit: $limit, after: $after) { ' +
    selection_(config.fields) + ' } }';
}

function inspectV3Schema_(config) {
  const typeRef = 'kind name ofType { kind name ofType { kind name } }';
  const data = graphql_(config, 'query TenderSchema { __schema { queryType { name } } ' +
    ['Query', 'Lots', 'TrdBuy', 'PlnPoint', 'RefLotsStatus'].map(function (type, i) {
      return 't' + i + ': __type(name: "' + type + '") { name fields { name type { ' + typeRef +
        ' } args { name type { ' + typeRef + ' } } } }';
    }).join(' ') + ' }');
  function unwrapped(type) { while (type && type.ofType) type = type.ofType; return type && type.name; }
  const types = {};
  Object.keys(data).forEach(function (key) {
    const type = data[key];
    if (type && type.name && Array.isArray(type.fields)) types[type.name] = type.fields;
  });
  const root = types.Query && types.Query.find(function (x) { return x.name === 'Lots'; });
  if (!data.__schema || data.__schema.queryType.name !== 'Query' || !root || unwrapped(root.type) !== 'Lots') {
    throw safeApiError_('API_V3_SCHEMA_MISMATCH: корневой Query.Lots не подтверждён.');
  }
  ['limit', 'after'].forEach(function (name) {
    if (!root.args || !root.args.some(function (arg) { return arg.name === name && unwrapped(arg.type) === 'Int'; })) {
      throw safeApiError_('API_V3_SCHEMA_MISMATCH: не подтверждён аргумент ' + name + '.');
    }
  });
  const report = [];
  Object.keys(config.fields).forEach(function (key) {
    let type = 'Lots';
    config.fields[key].split('.').forEach(function (part) {
      const field = types[type] && types[type].find(function (x) { return x.name === part; });
      if (!field) throw safeApiError_('API_V3_SCHEMA_MISMATCH: путь назначения ' + key + ' отсутствует в реальной схеме.');
      type = unwrapped(field.type);
    });
    const expected = ['amount', 'quantity'].includes(key) ? 'Float' :
      ['id', 'announcementId', 'deleted', 'pointList', 'planIds', 'goodsTypes', 'statusId'].includes(key) ? 'Int' : 'String';
    if (type !== expected) {
      throw safeApiError_('API_V3_SCHEMA_MISMATCH: тип назначения ' + key + ' отличается от опубликованного.');
    }
    report.push({ target: key, path: config.fields[key], type: type });
  });
  return report;
}

function field_(item, path) {
  function read(value, parts) {
    if (!parts.length) return value;
    if (Array.isArray(value)) return value.map(function (v) { return read(v, parts); }).flat();
    if (value === null) return null;
    if (!value || !Object.prototype.hasOwnProperty.call(value, parts[0])) {
      throw safeApiError_('API_V3_RESPONSE_FIELD_MISSING: отсутствует выбранное поле ответа.');
    }
    return read(value[parts[0]], parts.slice(1));
  }
  return read(item, path.split('.'));
}

function v3RawPage_(config, cursor, diagnosticOnly) {
  let previous = { after: null, direction: 0, fingerprint: config.fingerprint };
  if (cursor !== null) {
    try { previous = JSON.parse(cursor); } catch (e) { throw safeApiError_('API_V3_CURSOR_INVALID'); }
    if (!previous || previous.fingerprint !== config.fingerprint || !Number.isInteger(previous.after) ||
        previous.after < 0 || previous.after > 2147483647 || ![0, 1, -1].includes(previous.direction)) {
      throw safeApiError_('API_V3_CURSOR_INVALID: источник/конфигурация изменились или курсор неверен.');
    }
  }
  const response = graphqlResponse_(config, v3LotsQuery_(config), {limit: config.pageSize, after: previous.after});
  const data = response.data;
  if (!Array.isArray(data.Lots) || data.Lots.length > config.pageSize) throw safeApiError_('API_V3_RESPONSE_INVALID');
  const info = response.extensions && response.extensions.pageInfo;
  const verifiedInfo = !!info && typeof info.hasNextPage === 'boolean' &&
    Number.isInteger(info.limitPage) && info.limitPage >= 1 && info.limitPage <= 200 &&
    Number.isInteger(info.totalCount) && info.totalCount >= 0;
  if (!verifiedInfo && !diagnosticOnly) throw safeApiError_('API_V3_PAGE_INFO_MISSING: пагинация ответа не соответствует документации.');
  let last = previous.after;
  let direction = previous.direction;
  data.Lots.forEach(function (item) {
    const id = Number(sourceId_(field_(item, config.fields.id)));
    if (!Number.isInteger(id) || id < 0 || id > 2147483647) throw safeApiError_('API_V3_ID_OUT_OF_RANGE');
    if (last !== null) {
      const step = Math.sign(id - last);
      if (!step || (direction && step !== direction)) {
        throw safeApiError_('API_V3_PAGINATION_ORDER: повтор ID или изменение порядка; полный обход не подтверждён.');
      }
      direction = step;
    }
    last = id;
  });
  if (!verifiedInfo) return {items: data.Lots, nextCursor: null, paginationVerified: false, pageInfo: null};
  if (!info.hasNextPage) return {items: data.Lots, nextCursor: null, paginationVerified: true, pageInfo: info};
  const nextId = Number(sourceId_(info.lastId));
  if (nextId > 2147483647 || nextId === previous.after || (data.Lots.length && nextId !== last)) {
    throw safeApiError_('API_V3_PAGE_INFO_INVALID: lastId не соответствует странице или не продвигается.');
  }
  if (!data.Lots.length && previous.after !== null) {
    const step = Math.sign(nextId - previous.after);
    if (direction && step !== direction) throw safeApiError_('API_V3_PAGINATION_ORDER');
    direction = step;
  }
  return {items: data.Lots, nextCursor: JSON.stringify({after: nextId, direction: direction,
    fingerprint: config.fingerprint}), paginationVerified: true, pageInfo: info};
}

function apiDate_(value, zone, allowEmpty) {
  if (value === null || value === '') {
    if (allowEmpty) return '';
    throw safeApiError_('API_SOURCE_DATE_MISSING');
  }
  if (typeof value !== 'string') throw safeApiError_('API_SOURCE_DATE_INVALID');
  const calendar = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!calendar) throw safeApiError_('API_SOURCE_DATE_INVALID');
  const y = Number(calendar[1]), m = Number(calendar[2]), d = Number(calendar[3]);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] ||
      Number(calendar[4]) > 23 || Number(calendar[5]) > 59 || Number(calendar[6]) > 59) {
    throw safeApiError_('API_SOURCE_DATE_INVALID');
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    if (!Number.isFinite(Date.parse(value))) throw safeApiError_('API_SOURCE_DATE_INVALID');
    return new Date(value).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value) || !zone) {
    throw safeApiError_('API_SOURCE_DATE_TIMEZONE_REQUIRED: источник не указал смещение; нельзя угадывать часовой пояс.');
  }
  const plain = value.replace('T', ' ');
  try {
    const date = Utilities.parseDate(plain, zone, 'yyyy-MM-dd HH:mm:ss');
    if (Utilities.formatDate(date, zone, 'yyyy-MM-dd HH:mm:ss') !== plain) throw new Error('date');
    return date.toISOString();
  } catch (e) { throw safeApiError_('API_SOURCE_DATE_INVALID'); }
}

function normalizeV3Lot_(item, config) {
  const get = function (key) { return field_(item, config.fields[key]); };
  const id = sourceId_(get('id'));
  const deleted = get('deleted');
  if (deleted === 1) return { deletedId: id };
  if (deleted !== 0) throw safeApiError_('API_LOT_DELETION_FLAG_UNVERIFIED');
  const types = get('goodsTypes');
  const planIds = get('planIds');
  const points = get('pointList');
  if (!Array.isArray(types) || !types.length || types.some(function (x) { return !Number.isInteger(x); }) ||
      !Array.isArray(points) || !points.length || !Array.isArray(planIds) ||
      points.some(function (x) { return !planIds.includes(x); })) {
    throw safeApiError_('API_LOT_SUBJECT_TYPE_UNVERIFIED: Plans/pointList не подтверждают полный товарный состав лота.');
  }
  if (types.some(function (x) { return x !== config.goodsTypeId; })) return {deletedId: id};
  const amount = get('amount');
  const count = get('quantity');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 ||
      typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw safeApiError_('API_LOT_NUMBER_INVALID');
  if (amount > TENDER.maxAmount) return {deletedId: id};
  const start = apiDate_(get('applicationStart'), config.dateTimezone, true);
  const end = apiDate_(get('deadline'), config.dateTimezone, true);
  const repeatStart = apiDate_(get('repeatStart'), config.dateTimezone, true);
  const repeatEnd = apiDate_(get('repeatEnd'), config.dateTimezone, true);
  if (Boolean(repeatStart) !== Boolean(repeatEnd)) throw safeApiError_('API_REPEAT_DATES_INCOMPLETE');
  if ((start && end && Date.parse(end) < Date.parse(start)) ||
      (repeatStart && repeatEnd && Date.parse(repeatEnd) < Date.parse(repeatStart))) {
    throw safeApiError_('API_APPLICATION_DATES_INVALID');
  }
  const status = get('status');
  if (typeof status !== 'string' || !status) throw safeApiError_('API_LOT_STATUS_MISSING');
  const announcementId = sourceId_(get('announcementId'));
  const url = config.lotUrlTemplate.replace(/\{id\}/g, id).replace(/\{trdBuyId\}/g, announcementId);
  const result = {
    id: id, procurementNumber: get('procurementNumber'), lotNumber: get('lotNumber'),
    name: get('name') || get('nameKz') || '', quantity: count, amount: amount,
    customerName: get('customerName') || get('customerNameKz') || '', customerBin: get('customerBin'),
    publishedAt: apiDate_(get('publishedAt'), config.dateTimezone, false),
    applicationStart: repeatStart || start, deadline: repeatEnd || end,
    status: status, url: url, isGoods: true, isActive: config.activeCodes.includes(status)
  };
  validateLot_(result);
  return { lot: result };
}

function fetchV3Page_(cursor) {
  const config = assertV3Ready_();
  const raw = v3RawPage_(config, cursor);
  const lots = [], deletedIds = [];
  raw.items.forEach(function (item) {
    const result = normalizeV3Lot_(item, config);
    if (result.lot) lots.push(result.lot); else deletedIds.push(result.deletedId);
  });
  return {lots: lots, deletedIds: deletedIds, nextCursor: raw.nextCursor};
}
