# Публикация Tender AI Kazakhstan через GitHub Actions

Целевой репозиторий подтверждён пользователем:
**gostzakup-cmd/tender-ai-kazakhstan**.
Script ID: `1_UmAJ7xfIks7b2Q_PjDt_xUoEzovUIh5V5e_leuiJW2O9MGA9maQGL-y`.

Workflow: `.github/workflows/apps-script-publish.yml`.
**Публикация в Apps Script не запускалась.** Origin рабочей копии уже
указывает на правильный репозиторий. Ранее указанный владелец
gostzakup-omd был ошибочным; настройки и команды ниже исправлены.
Все файлы MVP и workflow предназначены для ветки `feature/apps-script-mvp`
и проверки через Pull Request в `main`. Перед первым ручным запуском
workflow проверьте и объедините Pull Request, затем настройте авторизацию.

## Что делает workflow

Есть только ручной `workflow_dispatch`. Нет запуска по push, pull_request,
расписанию или workflow_run. В default branch репозитория должны находиться
все восемь `.gs`, appsscript.json, tools, tests и workflow из этой рабочей копии.

1. **prepare** читает существующий проект через clasp / Apps Script API,
   сохраняет зашифрованную полную резервную копию в Actions artifact,
   затем готовит кандидат. Посторонние JS/HTML остаются неизменными,
   dependencies и явные OAuth scopes старого манифеста сохраняются.
   Проверяются синтаксис и повторные глобальные объявления. Никакой записи
   в Apps Script на этой стадии нет.
2. Вы скачиваете план, расшифровываете его локально и сравниваете `backup/`
   и `stage/`, включая изменения существующих файлов и манифеста.
3. **publish** запускается отдельно вручную. Требуются run ID успешного
   prepare и точный SHA-256 проверенного плана. Проверяется тот же
   репозиторий, workflow, default branch и полный source commit.
   Добавленный после prepare commit требует нового prepare.
4. Перед записью снова читается проект и сохраняется новая зашифрованная
   резервная копия как artifact. При ошибке загрузки backup публикация
   не продолжается. Изменившийся после проверки Apps Script блокирует push.
5. Загружается полный проверенный набор: восемь `.gs`, манифест и сохранённые
   посторонние файлы. Новый getContent через Apps Script API проверяет
   имена, типы и SHA-256 **всех** файлов. JSON сравнивается без различий
   форматирования. Успех — UPLOAD_VERIFIED и artifact verified.json.

Google OAuth постоянно хранится только в GitHub Actions Secrets. На
runner clasp требует временный `.clasprc.json`: он создаётся вне checkout
с правами 0600 и удаляется в always-шаге. Он не входит в artifacts/cache.
Исходники backup/stage также не публикуются открыто: используется
AES-256-GCM с отдельным ключом. Открытый review.json содержит только
контекст, имена/типы, хеши, список проверок и изменения scopes/timezone.
Artifacts хранятся 7 дней. Скачайте важные резервные копии заранее.

GitHub token имеет только contents:read и actions:read. Actions закреплены
по проверенным commit SHA; clasp 3.4.1 и остальные инструменты — по
package-lock.json. Пользовательский GOSZAKUP_TOKEN остаётся в Script
Properties: workflow его не запрашивает, не читает и не изменяет.
Выполнение функций Apps Script и установка триггеров сюда не входят.

## 1. Защитите репозиторий и окружение

В целевом репозитории:

- **Settings → Actions → General**: разрешите GitHub Actions и используемые
  actions/checkout, setup-node, upload-artifact, download-artifact.
- Защитите default branch: проверка изменений workflow, tools, lockfile
  и `.gs` перед merge. Не разрешайте неподтверждённые изменения кода,
  который получает Secrets.
- **Settings → Environments → New environment**:
  создайте `apps-script-production`, выберите Required reviewers, запретите
  self-review/bypass при доступности этих опций и ограничьте deployment
  default branch. Некоторые защиты зависят от GitHub plan/видимости
  репозитория. Само имя environment не включает reviewers автоматически.

Две отдельные ручные стадии, digest и проверка неизменного commit
обязательны в коде независимо от наличия environment reviewers.
Secrets CLASP_AUTH_JSON и APPS_SCRIPT_BACKUP_KEY нужны уже на prepare;
создавайте их как repository Actions secrets. Если дополнительно
используете environment secrets, учитывайте, что prepare не использует
production environment. Не включайте debug-вывод credentials.

## 2. Получите OAuth локально и сразу сохраните в GitHub Secret

Нужны Node.js 22+, clasp 3.4.1 и GitHub CLI (`gh`) на вашем компьютере.
Команды ниже для bash, macOS/Linux/WSL; **не запускайте их в workflow**.
Вход выполняется в браузере под аккаунтом с правом редактировать целевой
Apps Script. Пароль Google и OAuth-токены не отправляйте в чат.

Для CI предпочтителен отдельный Google-аккаунт с минимальным доступом.
Scope script.projects относится ко всем скриптам, доступным этому
аккаунту; ограничение одним Script ID обеспечивает наш загрузчик.

Включите Apps Script API:
https://script.google.com/home/usersettings .
Проверьте открытие проекта по своему аккаунту:
https://script.google.com/home/projects/1_UmAJ7xfIks7b2Q_PjDt_xUoEzovUIh5V5e_leuiJW2O9MGA9maQGL-y/edit .

```sh
npm install -g @google/clasp@3.4.1
gh auth login
```

Для публикации исходников Google scope — **script.projects**.
Создайте отдельную временную OAuth-сессию с этой областью; её manifest
используется только для login и никогда не загружается в Apps Script:

```sh
umask 077
tender_auth_dir=$(mktemp -d)
tender_clasp_bin=$(command -v clasp)
node - "$tender_auth_dir" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const directory = process.argv[2];
fs.writeFileSync(path.join(directory, '.clasp.json'), JSON.stringify({
  scriptId: '1_UmAJ7xfIks7b2Q_PjDt_xUoEzovUIh5V5e_leuiJW2O9MGA9maQGL-y',
  rootDir: '.'
}), {mode: 0o600});
fs.writeFileSync(path.join(directory, 'appsscript.json'), JSON.stringify({
  runtimeVersion: 'V8',
  oauthScopes: ['https://www.googleapis.com/auth/script.projects']
}), {mode: 0o600});
NODE
(
  cd "$tender_auth_dir"
  "$tender_clasp_bin" --auth "$tender_auth_dir" login --use-project-scopes
)
gh secret set CLASP_AUTH_JSON \
  --repo gostzakup-cmd/tender-ai-kazakhstan \
  < "$tender_auth_dir/.clasprc.json"
```

При успехе gh убедитесь в наличии **имени** CLASP_AUTH_JSON:

```sh
gh secret list --repo gostzakup-cmd/tender-ai-kazakhstan
rm -rf -- "$tender_auth_dir"
unset tender_auth_dir tender_clasp_bin
```

Не используйте cat/echo для credentials и не коммитьте их. При ошибке
login/gh остановитесь и устраните её; временный файл остаётся для
повторного безопасного gh secret set, затем удалите его. Для shell-скрипта
добавьте `set -e`, чтобы не удалять единственную копию после неудачного
сохранения Secret. Старые OAuth-файлы, созданные ранее вне этого процесса,
проверьте и удалите отдельно после переноса.

Если UI предпочтительнее gh: **Settings → Secrets and variables → Actions
→ New repository secret → CLASP_AUTH_JSON**. Значение — весь JSON,
полученный clasp 3.4.1 для default user, не отдельный refresh token.
Переносите содержимое локально прямо в защищённое поле GitHub; не в чат,
issue, commit, README или environment variable репозитория.

При запрете встроенного клиента clasp организацией создайте собственный
OAuth Desktop client в Google Cloud проекте с включённым Apps Script API,
настройте consent screen/test users и добавьте к login `--creds <private-file>`.
Client JSON храните временно вне репозитория, затем удалите. Внешний OAuth
app в режиме Testing может давать refresh token со сроком 7 дней для
таких scopes: переведите приложение в подходящий Publishing status и
соблюдите требования Google verification/политику организации, прежде
чем рассчитывать на длительное CI-подключение. При отзыве доступа или
истечении сессии повторите login и обновите Secret. Не обходите ошибки
401/403 отключением проверок TLS.

## 3. Добавьте отдельный ключ зашифрованных резервных копий

Secret **APPS_SCRIPT_BACKUP_KEY** — base64 ровно 32 случайных байтов.
Этот ключ не является Google OAuth-токеном. Сохраните его в своём
менеджере паролей для локального просмотра и восстановления резервных
копий: GitHub не позволяет прочитать значение сохранённого Secret обратно.

```sh
umask 077
tender_key_file=$(mktemp)
node - "$tender_key_file" <<'NODE'
const fs = require('node:fs'), crypto = require('node:crypto');
fs.writeFileSync(process.argv[2], crypto.randomBytes(32).toString('base64'),
  {mode: 0o600});
NODE
gh secret set APPS_SCRIPT_BACKUP_KEY \
  --repo gostzakup-cmd/tender-ai-kazakhstan < "$tender_key_file"
```

Сохраните значение из локального защищённого файла в менеджере паролей,
затем удалите файл. Не выводите его в логи. После успешного сохранения:

```sh
rm -f -- "$tender_key_file"
unset tender_key_file
```

При смене ключа старые artifacts расшифровываются старым ключом — храните
нужные версии в менеджере паролей, а активную только в GitHub Secret.

## 4. Первый ручной prepare — без публикации

После переноса файлов в default branch целевого репозитория и настройки
Secrets откройте **Actions → Review and publish Apps Script → Run workflow**:

- Branch: default branch.
- operation: `prepare`.
- review_run_id и review_plan_sha256: пустые.

Проверьте успешное выполнение, summary и artifacts:
`tender-apps-script-backup-<run_id>-<attempt>` и
`tender-apps-script-plan-<run_id>-<attempt>`.
Сохраните run ID и Plan SHA-256. `blockingIssues` должны быть пустыми перед
publish. Успешный prepare с blockingIssues только показывает план;
публикация такого плана явно запрещена.

Если `DUPLICATE_GLOBAL_BINDING`: в сохранённом старом коде есть глобальная
функция/переменная с именем из MVP, например второй onOpen. Согласуйте и
объедините их поведение до новой подготовки, не удаляйте код вслепую.
Если `LEGACY_IMPLICIT_SCOPES_REVIEW_REQUIRED`: старый проект с посторонним
кодом не имел явного oauthScopes. Проверьте его **Overview → Project OAuth
Scopes**, затем в `tools/ci/deploy-settings.json` задайте
`legacyImplicitScopes` массивом реально нужных дополнительных scopes
(либо `[]`, только если проверено, что дополнительных нет). Commit и
новый prepare обязательны. Существующие явные scopes добавляются сами.

Скачайте и распакуйте plan artifact, затем из локальной копии репозитория:

```sh
npm ci --prefix tools/ci --no-audit --no-fund
read -r -s -p 'Backup key: ' tender_backup_key
APPS_SCRIPT_BACKUP_KEY="$tender_backup_key" \
  node tools/actions-deploy.cjs inspect /path/to/unpacked-plan /path/to/new-private-review
unset tender_backup_key
```

Ключ вводится в локальный терминал скрыто. В новом приватном каталоге
сравните backup/ и stage/: все восемь скриптов MVP, манифест, сохранённые
посторонние файлы и review.json. Просмотрите полный source commit в
GitHub. Расшифрованные исходники не добавляйте в репозиторий/artifacts.

## 5. Публикация проверенного плана

Это будущий отдельный запуск; сейчас его выполнять не требуется.

В **Run workflow** выберите `publish`, укажите предыдущий успешный
prepare run ID и точный Plan SHA-256. Default branch должна оставаться
на том же commit. Если настроены environment reviewers, дождитесь их
одобрения. Будут выполнены проверка плана, новый backup, push и повторный
getContent. Проверьте UPLOAD_VERIFIED и verified.json, затем откройте
редактор Apps Script и убедитесь в наличии файлов.

`clasp push --force` используется только внутри проверенного этапа:
он отправляет весь сохранённый набор и согласованный манифест. Нельзя
заменять workflow простым push из checkout: API updateContent заменяет
всё содержимое проекта. При несовпадении любого файла после записи job
падает; backup сохраняется, а успех не заявляется. Для восстановления
локально расшифруйте backup, сравните с текущим getContent и восстановите
после проверки изменений. Автоматический rollback не выполняется.

Concurrency сериализует эти workflow. Apps Script API не предоставляет
атомарную проверку версии при updateContent: не редактируйте проект
параллельно другими клиентами между последним чтением и записью.

## Проверки разработки

```sh
npm ci --prefix tools/ci --no-audit --no-fund
node --test tests/core.test.cjs tests/upload.test.cjs tests/actions.test.cjs
```

Node/clasp/acorn/yaml относятся к инструментам проверки и публикации;
в приложении остаются только Google Apps Script и Sheets. Сервер и
Python не нужны. Официальные источники:
https://github.com/google/clasp#authorization ,
https://developers.google.com/apps-script/api/how-tos/manage-projects ,
https://docs.github.com/actions/managing-workflow-runs/manually-running-a-workflow ,
https://docs.github.com/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions .
