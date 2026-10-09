# Результаты проверок

## Текущий PR: ограниченный пилот, 2026-10-09

Команда:

```sh
node --test tests/core.test.cjs tests/upload.test.cjs tests/actions.test.cjs
```

**116 passed, 0 failed, 0 skipped** (92 core, 8 upload, 16 Actions).
Проверены ограниченные фильтрованные потоки, terminal totalCount/курсор,
несогласованные ответы и границы дат, жёсткие лимиты Lots/HTTP/времени,
скользящая 24h квота с учётом retries, fallback Plans по явным ID,
карантин/конфликты/удаления, раздельные способы 3/6, события публикации
и смены статуса, повтор после flush-сбоя и повторяющиеся переходы разных
ревизий. Валидный proof не разрешает full sync/daily/продолжения;
дополнительный точечный образец не подавляет ошибки исходной диагностики.
Проверена очистка отражённого токена и защита внешних строк от формул.

Совместный acorn-разбор всех **8 .gs** — PASS; manifest V8 — PASS;
`git diff --check` — PASS. appsscript.json, workflow, deploy-settings.json
не менялись; остальные проверки публикации сохранены. Workflow не запускался.

Ответы Google/Goszakup в тестах искусственные. Реальный пилот не выполнялся,
публикации в Google не было, Secrets не менялись. Реальные доказательства
владельца отдельно сохранены в stage2/stage2-live.user.json; они подтверждают
ID/значения примеров, не временную зону или ежедневное покрытие.

Повторно прочитаны публичные официальные Lots, PlansFiltersInput,
TrdBuyFiltersInput и developer/ows_v3 — HTTP 200, SHA-256 в stage2/evidence.json.
Описание планового/фактического способов проверено по схеме. Указания IANA
зоны в этих источниках не найдено; это остаётся требованием к запуску.

## История предыдущих проверок

Ниже результаты прежних версий, а не утверждения о текущем состоянии.
Актуальные блокеры/действия: STAGE2_READINESS.md и BOUNDED_PILOT.md.

2026-10-08, /workspace/tender-ai-kazakhstan. Node v24.19.0;
приложение исполняется в Apps Script V8, Node нужен только для тестов.

```sh
node --test tests/core.test.cjs
```

**63 теста: 63 passed, 0 failed, 0 skipped.**

Дополнительно: совместный синтаксический разбор всех 7 `.gs` — PASS;
JSON-манифест V8 — PASS; SHA-256 девяти официальных HTML-источников
совпадает с sources.json; `git diff --check` — без ошибок.

Проверены настройка пяти листов без потери данных, граница 10 млн,
дубликаты/обновления/исключения, даты и представления, защита текста,
сохранение курсора и повтор страницы после сбоя, паузы/возобновление,
блокировки и триггеры, HTTP/GraphQL errors, Retry-After, CONNECT 403
отдельно от HTTP 403, недопущение утечки токена, introspection по
сохранённому официальному SDL, прямые Lots.amount/count, полный товарный
состав, runtime configuration и диагностическая блокировка, V3 короткая/
последняя/пустая промежуточная страницы, отсутствующий или некорректный
pageInfo, неподвижный курсор и изменения конфигурации.

Внутри suite также исполнены все **12 runTenderSelfTests** в локальной
модели Google, без HTTP и записей в Sheets. Это не запуск в аккаунте Google.

Fixture legacy /lots взят из официальной /help; остальные ответы API
искусственные и явно помечены TEST/INTERNAL_TEST. Проверка типов V3
использует SDL, извлечённый из официального HTML; сам ответ introspection
в тесте искусственный. Тесты не подменяют проверку реального доступа.

Сетевые проверки: официальная help, schema и developer/ows_v3 — HTTP 200;
POST /v3/graphql без Authorization — HTTP 401 после CONNECT 200.
Пользовательский токен не использовался. Результат не оценивает его права
или валидность. Портал поиска и объявление также доступны, но прямой URL
конкретного лота не подтверждён.

Не выполнены: авторизованный реальный запрос, Apps Script-разрешения,
Google setup/self-tests, полный реестр, сверка обновлений и фактический
ежедневный триггер. Две диагностические страницы не доказывают полноту
ежедневного сбора. Блокеры и следующие проверки — MVP_STATUS.md и README.md.

## Проверка загрузки в существующий Apps Script

Установлен clasp 3.4.1; version и справка login/clone/push выполнены.
Clone заданного Script ID остановился с `No credentials found`.
GET script.googleapis.com остановился на proxy CONNECT 403, до Google.
Удалённые файлы не прочитаны и не загружены; Script Properties не читались.

`node --test tests/upload.test.cjs`: **8 passed, 0 failed**.
Проверены backup, сохранение посторонних JS/HTML, merge манифеста,
контроль изменения проекта до push и сверка свежего clone после push.
Ответы clasp искусственные. Общий локальный набор: **71 тест**.
Авторизация и реальные команды пользователя — APPS_SCRIPT_UPLOAD.md.

## GitHub Actions

Подготовлен только workflow_dispatch для подтверждённого
gostzakup-cmd/tender-ai-kazakhstan. GitHub Actions и публикация в Apps Script
не запускались. Пользователь исправил ранее ошибочно указанный владелец
gostzakup-omd; текущий origin уже соответствует правильному репозиторию.
Настройки workflow и команды авторизации исправлены соответственно.

Новый набор tests/actions.test.cjs: **15 passed, 0 failed**.
Весь локальный набор: **86 тестов**. Проверены ручной запуск и branch/repository
guards, pinning Actions, шифрование/повреждение backup, безопасные пути,
metadata проверяемого run, digest и неизменный commit, отсутствие remote write
на prepare, блокировка конфликтующих globals/неподтверждённых legacy scopes,
новая резервная копия, сохранение посторонних файлов и провал при несовпадении
повторно прочитанного проекта. OAuth fixtures искусственные.

`npm ci --prefix tools/ci --no-audit --no-fund` проверен с lockfile.
Синтаксис actions-deploy.cjs, YAML и actionlint 1.7.7 — PASS.
Бинарный actionlint скачан из официального release с проверкой SHA-256;
commit SHA четырёх Actions сверены с официальными release tags.
Реальный OAuth, GitHub Secrets, environment reviewers и API-публикация
остаются будущими действиями пользователя по GITHUB_ACTIONS.md.

## Этап 2 — 2026-10-09

`node --test tests/core.test.cjs tests/upload.test.cjs tests/actions.test.cjs`:
**91 passed, 0 failed, 0 skipped**. Новые четыре теста проверяют независимую
сверку ID/номера, отсутствие мутаций Sheets/Properties/триггеров/proof,
отсутствие придуманного фильтра isDeleted, отрицательный результат при
несовпадении ID, redaction до усечения строк и безопасные API errors.
Ответы GraphQL в тестах искусственные; реальные ответы владельца и
публичные страницы явно разделены в STAGE2_READINESS.md.

Пять прямых страниц лотов разных способов, LotsFiltersInput, инструкции
ЗЦП/ОК/аукциона/одного источника и Google quotas получены по HTTP 200.
Полный справочник владельца: 37 уникальных ID, 36 code (295/300 совпадают).
В cloud авторизованные запросы к Goszakup не выполнялись. Новый helper
не загружен в Google. Sync, trigger и workflow publish не запускались.
