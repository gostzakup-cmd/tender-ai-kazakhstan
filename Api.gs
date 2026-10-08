/**
 * Общий HTTPS-транспорт, авторизация и старый документированный REST-клиент.
 * Основной Lots.amount/count и GraphQL-adapter находятся в V3.gs.
 * Source: /help/ и /help/v3/schema/ на официальном хосте.
 */
function assertApiReady_() {
  assertV3Ready_();
  throw safeApiError_('FULL_SCAN_DISABLED: полный обход и daily trigger заблокированы; сначала ограниченный пилот и подтверждение инкрементального покрытия.');
}

function apiToken_() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty(TENDER.tokenKey) || props.getProperty(TENDER.legacyTokenKey);
  if (!token || !token.trim()) {
    throw safeApiError_('API_TOKEN_MISSING: добавьте GOSZAKUP_TOKEN в Script Properties проекта Google. Значение в чат не отправляйте.');
  }
  if (/[\r\n]/.test(token)) throw safeApiError_('API_TOKEN_FORMAT: токен содержит перевод строки.');
  return token.trim();
}

/** Читаем только опубликованный endpoint; это ещё не подборка товарных лотов. */
function fetchGoszakupRawPage_(cursor) {
  const path = rawLotsPath_(cursor);
  const result = fetchJsonWithRetry_(TENDER.apiOrigin + path, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + apiToken_(), Accept: 'application/json' },
    contentType: 'application/json'
  });
  if (!result || !Array.isArray(result.items) || typeof result.next_page !== 'string' ||
      !Number.isSafeInteger(result.total) || result.total < 0 ||
      !Number.isSafeInteger(result.limit) || result.limit < 1) {
    throw safeApiError_('API_SCHEMA_MISMATCH: ожидаются items, total, limit и строковый next_page по официальной /help.');
  }
  result.items.forEach(function (item) {
    if (!item || typeof item !== 'object') throw safeApiError_('API_SCHEMA_MISMATCH: некорректный элемент items.');
    ['id', 'lot_number', 'ref_lot_status_id', 'pln_point_id', 'customer_id',
      'customer_bin', 'trd_buy_number_anno', 'trd_buy_id', 'system_id', 'index_date'].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) {
        throw safeApiError_('API_SCHEMA_MISMATCH: в лоте отсутствует документированное поле ' + key + '.');
      }
    });
    sourceId_(item.id);
  });
  const next = result.next_page === '' ? null : rawLotsPath_(result.next_page);
  if (next !== null && next === path) throw safeApiError_('API_CURSOR_STALLED: next_page повторяет текущую страницу.');
  return { items: result.items, total: result.total, limit: result.limit, nextCursor: next };
}

function sourceId_(id) {
  if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) return String(id);
  if (typeof id === 'string' && /^[0-9]+$/.test(id)) return id;
  throw safeApiError_('API_SCHEMA_MISMATCH: идентификатор лота не является точным целым числом.');
}

/** next_page не может увести заголовок Bearer на другой хост или сервис. */
function rawLotsPath_(cursor) {
  if (cursor === null) return '/lots';
  if (typeof cursor !== 'string') throw safeApiError_('API_CURSOR_INVALID: ожидается строка next_page.');
  let path = cursor;
  if (path.indexOf(TENDER.apiOrigin + '/') === 0) path = path.slice(TENDER.apiOrigin.length);
  if (!/^\/lots\?[^#\s]+$/.test(path)) throw safeApiError_('API_CURSOR_INVALID: next_page выходит за endpoint /lots.');
  const params = {};
  path.slice(path.indexOf('?') + 1).split('&').forEach(function (pair) {
    const parts = pair.split('=');
    if (parts.length !== 2 || !['page', 'search_after'].includes(parts[0]) ||
        Object.prototype.hasOwnProperty.call(params, parts[0])) {
      throw safeApiError_('API_CURSOR_INVALID: неизвестные или повторяющиеся параметры next_page.');
    }
    params[parts[0]] = parts[1];
  });
  if (params.page !== 'next' || !/^[0-9]+$/.test(params.search_after || '')) {
    throw safeApiError_('API_CURSOR_INVALID: нужен page=next и числовой search_after.');
  }
  // Нормализация позволяет обнаруживать повтор даже при другом порядке параметров.
  return '/lots?page=next&search_after=' + params.search_after;
}

/**
 * Адаптер возвращает {lots, deletedIds, nextCursor: string|null}.
 * null означает подтверждённый конец выборки, а не ошибку или пустую страницу.
 * Поля NormalizedLot — внутренние имена; V3.gs содержит проверенное сопоставление.
 */
function fetchGoszakupPage_(cursor) {
  return fetchV3Page_(cursor);
}

/** HTTPS-транспорт для будущего подтверждённого адаптера. */
function fetchJsonWithRetry_(url, options, requestBudget) {
  if (!/^https:\/\/ows\.goszakup\.gov\.kz(?:\/|$)/.test(url)) {
    throw new Error('Разрешён только официальный HTTPS-хост API.');
  }
  const request = Object.assign({}, options || {}, {
    muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Пилот считает каждую HTTP-попытку, включая retries, до отправки запроса.
    if (requestBudget) requestBudget.claim();
    let response;
    try {
      response = UrlFetchApp.fetch(url, request);
    } catch (e) {
      if (/\bCONNECT\b/i.test(String(e && e.message)) && /\b403\b/.test(String(e && e.message))) {
        throw safeApiError_('API_PROXY_CONNECT_403: HTTPS-туннель отклонён прокси до ответа API. Это не проверка API-токена; проверьте разрешённые домены и применение сетевых настроек.');
      }
      if (attempt < 3) { Utilities.sleep(1000 * Math.pow(2, attempt)); continue; }
      throw safeApiError_('API_NETWORK_ERROR: запрос не выполнен после четырёх попыток.');
    }
    const status = response.getResponseCode();
    if (status === 429 || status >= 500) {
      if (attempt < 3) {
        const headers = response.getAllHeaders();
        const key = Object.keys(headers).find(function (k) { return k.toLowerCase() === 'retry-after'; });
        const retry = key ? headers[key] : null;
        const seconds = retry !== null && /^\d+$/.test(String(retry)) ? Number(retry) :
          retry && Number.isFinite(Date.parse(retry)) ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 0;
        // Длинный Retry-After переносим в следующий запуск, не нарушая лимит выполнения.
        if (seconds > 30) {
          const error = safeApiError_('API_RATE_LIMIT: повторите запуск позднее.');
          error.retryAfterMs = seconds * 1000;
          throw error;
        }
        Utilities.sleep(Math.max(1000 * Math.pow(2, attempt), seconds * 1000));
        continue;
      }
    }
    if (status === 401) throw safeApiError_('API_HTTP_401: HTTP-запрос дошёл до сервиса/шлюза, авторизация отсутствует или не принята. Это отдельный случай от 403 CONNECT.');
    if (status === 403) throw safeApiError_('API_HTTP_403: HTTP-доступ запрещён сервисом или шлюзом. Проверьте права, срок доступа и маршрут; этот статус сам по себе не доказывает неверный токен.');
    if (status < 200 || status >= 300) throw safeApiError_('API_HTTP_' + status + ': запрос отклонён.');
    try { return JSON.parse(response.getContentText()); }
    catch (e) { throw safeApiError_('API_INVALID_JSON: сервер вернул невалидный JSON.'); }
  }
  throw safeApiError_('API_RETRY_EXHAUSTED');
}

function safeApiError_(message) {
  const error = new Error(message);
  error.tenderSafeMessage = message;
  return error;
}
