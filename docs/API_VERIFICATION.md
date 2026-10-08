# Проверка официального Goszakup API V3

Дата: 2026-10-08. Источники доступны по HTTP 200 после CONNECT 200:

- https://ows.goszakup.gov.kz/help/
- https://ows.goszakup.gov.kz/help/v3/schema/
- https://old.goszakup.gov.kz/ru/developer/ows_v3

Официальная страница разработчика подтверждает POST `/v3/graphql`, JSON
и Authorization Bearer. Endpoint приложения:
`https://ows.goszakup.gov.kz/v3/graphql`. POST без токена вернул HTTP 401
после успешного CONNECT: это проверка маршрута, не токена пользователя.
Прежний CONNECT 403 происходил до ответа сервиса и ничего не доказывал
о валидности токена. Сейчас страница old.goszakup.gov.kz также доступна.

## Подтверждённые поля

Сохранены точные извлечения SDL в [v3-schema](v3-schema/). URL каждого
источника и SHA-256 скачанного HTML — [sources.json](v3-schema/sources.json).
Публичная страница разработчика содержит устаревшие snake_case примеры;
её журнал изменений 2025 года и актуальный SDL используют camelCase
и названия объектов UpperCamelCase. Адаптер следует SDL, проверяет
introspection реального сервиса и не копирует старый запрос trd_buy.

| Данные | Реальный GraphQL-путь от Lots | Основание |
| --- | --- | --- |
| Реестр | Query.Lots(filter: LotsFiltersInput, limit: Int, after: Int): [Lots] | query.doc.html |
| ID / номер лота | id / lotNumber | lots.doc.html |
| Количество одного лота | count: Float, «Общее количество» | lots.doc.html |
| Сумма одного лота | amount: Float, «Общая сумма» | lots.doc.html |
| Название | nameRu / nameKz | lots.doc.html |
| Заказчик / БИН | customerNameRu / customerNameKz / customerBin | lots.doc.html |
| Номер объявления / ID | trdBuyNumberAnno / trdBuyId | lots.doc.html |
| Пункты плана | pointList: [Int], Plans: [PlnPoint], Plans.id | lots.doc.html, plnpoint.doc.html |
| Товарный тип | Plans.refSubjectTypeId | plnpoint.doc.html, справочник /v3/refs/ref_subject_type: 1 = Товар |
| Публикация | TrdBuy.publishDate | trdbuy.doc.html, «Дата публикации» |
| Начало / конец подачи | TrdBuy.startDate / endDate | trdbuy.doc.html |
| Повторные сроки | TrdBuy.repeatStartDate / repeatEndDate | trdbuy.doc.html |
| Статус | refLotStatusId, RefLotsStatus.code / nameRu | lots.doc.html, reflotsstatus.doc.html |
| Удаление | isDeleted: Int | lots.doc.html, «Объект удален»; значения проверяются в реальном ответе |

`Plans.amount`, `Plans.count` и `TrdBuy.totalSum` не используются как
значения лота. Это проверяется тестом, в котором эти суммы намеренно
отличаются от Lots.amount. Лимит 10 000 000 включительно применяется
к Lots.amount после получения страницы.

## Фильтры

LotsFiltersInput документирует amount: [Float], lastUpdateDate: [String]
и indexDate: [String], но не прямой refSubjectTypeId. Товарность в данном
адаптере определяется через Plans, с проверкой, что покрыт весь pointList.
TrdBuyFiltersInput имеет refSubjectTypeId: Int и publishDate: [String].
В странице разработчика массив диапазона описан как [from, to], [from]
или ["", to]. Приложение пока выполняет полный Query.Lots без фильтров,
чтобы заметить изменения суммы/товарности и удаления старых записей.
Фильтр только по новым публикациям не обеспечивает эти обновления.

## Пагинация

Query.Lots принимает limit (0–200 по SDL; приложение 1–200), after
«Последний ИД на странице». Пример ответа разработчика содержит
`extensions.pageInfo` с limitPage, totalCount, hasNextPage, lastId.

Адаптер завершает обход по hasNextPage=false, иначе передаёт lastId в
следующий after. Короткий/пустой массив сам по себе не означает конец.
Повторы ID, обратный порядок, непродвигающийся lastId и несоответствие
lastId последнему полученному ID останавливают обход. В публичном
примере ответа объявления lastId отличается от единственного показанного
ID: пример не доказывает согласованность реального реестра Lots.
Поэтому реальный pageInfo и порядок обязательно проверяет диагностика.
Отсутствующие метаданные показываются как V3_PAGE_INFO_UNVERIFIED;
боевой обход без них не разрешается. Две страницы не подтверждают весь реестр.

## Что ещё требуется подтвердить реальным ответом

1. Совпадение опубликованной схемы с доступным пользователю сервисом,
   значения isDeleted, полнота Plans/pointList и pageInfo реестра Lots.
2. Временная зона строк без смещения. Asia/Almaty задаёт часы приложения;
   её нельзя автоматически приписать неописанным датам API.
3. Полный перечень кодов, разрешающих подачу для разных способов закупки.
   Справочник содержит пример PublishedOfferAccept, но одного примера
   недостаточно для ACTIVE_LOTS.
4. Устойчивый URL именно лота. На официальном поиске обнаружены ссылки
   объявлений и модальные окна лотов; подтверждённого шаблона прямой ссылки
   пока нет. Не подставляем предполагаемый маршрут view-lot.
5. Полный обход, устойчивость обновлений и ежедневная длительность в
   рамках квот Google. Авторизованных данных пользователя здесь нет.

`testGoszakupV3Connection` выполняет introspection, выбирает только
документированные поля и возвращает ограниченные образцы, описания типов,
pageInfo, ошибки нормализации и настройки, которые ещё нужны. FIELD_MAP
может изменяться только по подтверждённым полям реальной схемы. До
получения отчёта нельзя утверждать, что маппинг проверен в боевом сервисе.
