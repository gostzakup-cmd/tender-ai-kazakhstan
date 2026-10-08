# План небольших безопасных PR и приёмки

Pnn — группа требований GAP; буква — отдельный небольшой PR внутри группы.
Весь runtime остаётся Google Apps Script JavaScript, данные — Sheets/Drive;
внешние API вызываются напрямую, отдельный сервер/Python не нужны.
Ниже **план**, кроме P01 ни один модуль не заявлен реализованным.

| PR | Узкая поставка | Зависимости | Приёмка / проверка |
| --- | --- | --- | --- |
| P01 — текущий | Полный исходник, 50-section GAP, 79 категорий, структура, JSON Schema, план и contract tests | main c31f798; PR #4 проверен, не дублируется | DOCX hash/text roundtrip; 50 разделов и 15 user additions без потерь; все категории/19+15 колонок; schema reject UNKNOWN→GO. Никаких .gs/manifest/workflow/Secrets изменений |
| P02a | Versioned category catalog + multilingual нормализация/синонимы с источниками | P01 | Все 79 IDs сохранены; HDD/SSD/бренд/омоним/cyrillic/KK/EN/part number fixtures; recall не доказывает goods/match |
| P02b | LotDetails и preflight eligibility: confirmed goods, budget ≤10м, единицы/комплектность/статусы | P02a, **объединённый PR #4**, официальная зона/статусы | 10м проходит, 10м+1 исключён; пустые Plans карантин; плановый/фактический способ отдельно; закрытые/неизвестные/приглашение не допускаются; runtime-disabled по умолчанию |
| P03a | Read-only диагностика Files/binding на явных 2–10 ID, без массового download | P01, P02b | Реальные FileLots/FileTrdBuy introspection и метаданные; поля/URL/redaction проверены; objectId и версия не выводятся из имени; report честно UNKNOWN |
| P03b | Оригинальное скачивание и immutable Drive document-set archive | P03a + разрешение на новые Drive scopes/папку | Проверенный host/redirect/binding; PDF MIME/signature/размер/hash; повтор не создаёт дубликат; новая версия сохраняет старую и инвалидирует результаты; backup миграции |
| P04a | Реальный Document AI PDF→страницы/anchors, bounded native operations | P03b, выбранный Cloud project/processor/billing/scopes | Digital+scan+tables+images; все страницы/частичные/пустые/oversize/429; точные anchors; offline/unsupported не притворяется success |
| P04b | Реальный Gemini requirement extraction + JSON validation и source checker | P04a, selected model/region/тариф | Все семейства §10, критичность и эквивалент; exact quotes/проверка страниц; неверный/потерянный quote отвергается; prompt injection не вызывает команды; golden-set сверка полного PDF |
| P05a | Реальный Brave Search adapter и приоритетные поисковые запросы | P04b, API account/budget | URL/дата/провайдер, RU/KK/EN/модель/part number; 0 результатов/403/429/limit; никаких price facts из snippet; недоступный источник не останавливает другие |
| P05b | Проверка карточек нескольких реальных поставщиков; один адаптер на проверенный источник | P05a; optional managed scrape отдельным выбором | SKU/variant/condition/legal seller/quantity/price/currency/link/date; independence; >=3 по возможности, shortage_reason; cache/«от»/другая комплектация/out-of-stock не цена для расчёта |
| P06 | Детерминированная трёхстатусная матрица TS→товар | P04b, P05b | Все critical и mandatory; exact model/part number; equivalents allowed only by TS; 100/90–99/70–89/<70 и critical veto; скальные ботинки ≠ автоматически Scarpa; единицы/комплект |
| P07a | FX adapter официального источника + typed unknown money | P05b, подтверждённый feed/тариф обмена | Номинал/дата/source, USD/EUR/RUB/CNY, weekend/stale/rate missing; неизвестное → null, не 0 или постоянный rate |
| P07b | Expenses/tax profile и отдельные подтверждённые/неизвестные расходы | P07a, несекретный профиль владельца | Доставка/импорт/НДС/таможня/сертификация/комиссии/гарантия/упаковка/банк; applicability evidence; no guessed tax или double count |
| P07c | Decimal стоимости партии, себестоимости и budget/bid сценариев | P06, P07b | DOCX пример 958400 и ~80.1%; размер упаковки/склад/quantity breaks/много строк; FX/расход UNKNOWN не даёт finalCost; zero denominator; budget не guaranteed revenue |
| P08a | Проверяемый NationalRegime/participation gate с официальными источниками | P02b, P06, профиль + конкретные подтверждённые нормы/реестры | Версия нормы/применимость/происхождение/производитель/реестр/право участия; подтверждённый запрет NO-GO, UNKNOWN REVIEW; не guessed endpoint/правило |
| P08b | HIGH/MED/LOW, GO/REVIEW/NO-GO и 17-вопросный quality gate | P07c, P08a | 100% TS без цены LOW; неизвестная доставка максимум MED/REVIEW; national UNKNOWN исключает GO/TOP; все guards перед promotion; conflict policy явно принята |
| P09a | Additive миграция двух user Sheets и стиль §34–35 | P01, P08b; approved backup/preview | Ровно 19/15 колонок, title/freeze/filter/wrap/currency/%/цвета; existing data/notes/technical sheets сохраняются; несовместимая структура abort |
| P09b | Sorted projections/TOP, links/notes, короткий RunReport | P09a | HIGH→MED→LOW, margin desc; §36 + national gate; MED явно REVIEW; unknown values не 0; closed exits TOP; все метрики §48/ссылка, без дублирования таблицы |
| P10a | Checkpoint job queue, source evidence/history/invalidation | P03b, P05b, P09b, PR #4 | Lots.id/revisions; status/doc/price/stock/FX/tax/rule TTL recheck; событие до promotion; failure/retry idempotent; частичное не finished |
| P10b | Общий quota/cost budget и bounded scheduling только разрешённого режима | P10a, owner limits | Все retries/адapters считаются вместе; lock/lease; 6 min/Properties/Sheets limits; stop without watermark; 32м fullscan/daily остаются заблокированы |
| P11 | Разрешённый **реальный** end-to-end acceptance pilot 2–10 Lots.id | Все выше + отдельное разрешение publication/run | API→current full PDF→Drive→all pages→requirements→real offers→match→FX/cost→confidence/decision→Sheets; golden proof/re-run/history/quotas. Проход не объявляет национальное покрытие |
| P12 — только после пилота | Production incremental queue/watermarks/overlap/archive и разрешённый daily | P11 + guarantees дат/связей/coverage, реальные объёмы и квоты | Независимый контроль ожидаемых ID, поздних индексов/изменений Plans/TrdBuy/удалений; плотные окна split; watermark только полностью завершённого окна; сохранение Sheets/Drive архива |

P12 не снимает автоматически действующую блокировку full scan. Ежедневный
режим должен быть инкрементальным, проверяемым, с источниковыми гарантиями.
Каждый будущий publish отдельно проходит существующие prepare → backup →
review → publish → повторное getContent. Новые OAuth scopes/лимиты не
проталкиваются как «безопасные» без проверки, Secrets в чат не запрашиваются.

## Проверки на каждом уровне

1. **Spec/contract (сейчас):** точный DOCX/XML, категории/колонки/50 mappings,
   source identities, schema compile и отрицательные UNKNOWN→GO примеры.
   Это не тесты готового коммерческого runtime.
2. **Unit future PR:** независимые adversarial fixtures, три-state evidence,
   model/SKU mismatch, stale prices, stock/packing, registry UNKNOWN, decimal
   FX/expenses, rollback/idempotency. Искусственные ответы помечены явно.
3. **Provider integration:** реальный минимальный вызов каждого выбранного
   сервиса после разрешения; фактические строки/страницы/цены/usage проверены
   чтением источника. Ни mock HTTP, ни schema-only не заменяет этот уровень.
4. **Golden TS:** вручную просмотренный полный оригинал, все обязательные
   строки/таблицы/изображения/примечания отмечены, каждый quote/page сверяется.
   Критическое пропущенное требование = fail, красивый процент не компенсирует.
5. **E2E 2–10:** повтор спустя обновление/задержку; original changed, price
   changed, status closed, missing stock/FX/shipping/regime, wrong TS lot,
   same seller across platforms, critical mismatch, one unavailable site/lot.
   Результаты сравнивают с фактами, не вынуждают получать GO.

## Критерии выхода реального пилота

- Все 2–10 IDs выбранного набора присутствуют ровно один раз; every этап
  имеет outcome SUCCESS/UNKNOWN/REJECTED/UNAVAILABLE, без скрытого пропуска.
- Оригинальные bytes, current-version/binding, число страниц и requirements
  подтверждены; если невозможны, запись остаётся явной неполной/LOW/REVIEW,
  но не считается успешно полностью проанализированной.
- По возможности ≥3 независимых реальных предложений, все поля §12 или
  индивидуальные UNKNOWN; минимальная цена только среди admissible candidates.
- Проверены все critical, модель/партномер/комплект/состояние/партия. Один
  critical veto исключает товар из расчётного подтверждённого TOP/GO.
- national regime, FX, налоги/логистика/прочие расходы не подменены; finalCost
  только при подтверждении. Базовая маржа всегда с отметкой бюджетного сценария.
- HIGH/MED/LOW и GO/REVIEW/NO-GO объяснены evidence/reason codes, сроки/цены
  свежие. MED в TOP не воспринимается как допущенный GO.
- Два листа соответствуют точным колонкам, стилю, сортировке и §36; история,
  данные пользователя и технические листы сохраняются; re-run без дубликатов.
- Фактические requests/pages/tokens/стоимость/время/ячейки/Drive usage в отчёте
  под согласованными лимитами. Результаты недоступных сайтов/лотов видимы.
- Нет утечки secret, новых неожиданных scopes, неправдивых утверждений о поиске,
  полном PDF, цене, прибыли или национальном покрытии.

Отчёт пилота содержит immutable evidence pack (source snapshot/hash/time,
PDF versions, anchors, vendor pages, costs/FX/regime sources), sanitized summary
§48 и список blocker/owner actions. Решение о P12 принимается по этому отчёту;
если частичный цикл полезен, он не переименовывается в полностью завершённый.
