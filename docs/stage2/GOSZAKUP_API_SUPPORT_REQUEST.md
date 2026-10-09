# Запрос владельцу API goszakup.gov.kz (OWS v3)

**Тема:** Уточнение временной зоны, фильтров дат и отслеживания изменений OWS v3

Здравствуйте! Разрабатываем интеграцию OWS v3 для инкрементального получения опубликованных и изменённых лотов. Просим письменно уточнить:

1. В какой IANA timezone / UTC offset возвращаются даты без offset: TrdBuy.publishDate, startDate, endDate, lastUpdateDate, Lots.lastUpdateDate, indexDate?
2. Как интерпретируются даты до/после перехода Казахстана на UTC+5 с 01.03.2024?
3. Включительны ли границы диапазона [from,to], какая зона входных дат, точность и максимальная задержка индексации?
4. Какие изменения Lots, TrdBuy и Plans гарантированно обновляют lastUpdateDate/indexDate (статус, сумма, удаление, связи, сроки)?
5. Является ли totalCount числом записей после всех фильтров? Каковы гарантии пагинации lastId при параллельных изменениях?
6. Есть ли официальный журнал изменений для всех новых/изменённых лотов без полного обхода?

Просим ссылку на спецификацию либо обезличенные примеры запросов и ответов без токенов.

С уважением,
Команда Tender AI Kazakhstan

---
Internal tracking: GitHub issue #6. Не угадывать зону по отображению портала. Ответ с датой и источником сохранить и проверить на реальных ID до настройки пилота. Никаких production triggers или watermark до подтверждения.

## Official documentation cross-check (2026-10-09)
- https://old.goszakup.gov.kz/ru/developer/ows_v3 — lists publishDate and lastUpdateDate filter semantics by field, without specifying a timezone.
- https://ows.goszakup.gov.kz/help/v3/schema/trdbuyfiltersinput.doc.html — declares publishDate and lastUpdateDate as [String].
- https://ows.goszakup.gov.kz/help/v3/schema/trdbuy.doc.html — declares date fields as String, without an offset contract.
- https://ows.goszakup.gov.kz/help/ — current service help indicates contacting the Ministry of Finance of Kazakhstan for token authorization; this is not proof of a support mailbox for technical questions.
**Result:** timezone, filter boundary inclusivity, update completeness and indexing lag remain UNVERIFIED. No token used in this documentation review.
