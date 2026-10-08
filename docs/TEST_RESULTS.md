# Результаты проверок

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
