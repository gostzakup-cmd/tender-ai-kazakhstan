# Actual closing-day run and production check — 2026-10-20

This change builds on main `0d94411891a23e8c82ea86715e49dee1ca20ef31`
(PR #31–#68 already merged). It does not recreate TS, supplier, passport or
net-margin modules. It fixes the missing live closing-day discovery path and
incomplete deployment test gate. It does not claim an autonomous profitable agent.

## What actually ran

`node tools/today-preview.cjs` executed **PortalClosingSearch.gs itself** in a
local Node VM with public HTTP/clock/digest/quota bridges. No server was started.
All eight network requests were real public HTTPS GETs, not mocked test responses.
This was NOT an Apps Script production run. No credentials or paid services used.
The local attempt ledger is separate from Google Script Properties.

The official public GET form at
https://old.goszakup.gov.kz/ru/search/lots returned HTTP 200. Its actual fields:

- `filter[end_date_from]`, `filter[end_date_to]`: `dd.mm.yyyy`;
- `filter[trade_type]=g`: Товар;
- `filter[amount_to]=10000000`: individual search-row lot amount;
- actual pagination links: `count_record=50&page=N`.

These are observed **portal form names**, NOT GraphQL fields or invented endpoints.
`robots.txt` returned HTTP 200, general crawler delay 5 seconds, no disallow on
`/ru/search/lots` or observed public lot routes. Each run is bounded to three
pages and five detail requests; the collector now also waits before its first
request so consecutive runs respect the delay. No retries, redirects, sessions,
CAPTCHA bypass, hidden API probes or countrywide traversal.

On the selected day 2026-10-20 (selection calendar Asia/Qyzylorda), the portal
reported **182** search records. The collector read **150** rows from three
pages, retained **30** unique lot IDs, and checked five lot pages from distinct
announcements. Coverage is always `sample_only`; this is neither all 182 validated
lots nor proof of nationwide completeness. Raw no-offset deadline strings remain
uninterpreted without independent timezone evidence.

[Complete public JSON snapshot](live/2026-10-20-public-preview.json) ·
[CSV preview](live/2026-10-20-public-preview.csv).

| Portal lot ID | Product | Lot budget KZT | Current detail status | Raw deadline | Decision |
| --- | --- | ---: | --- | --- | --- |
| 43614167 | Уголь каменный | 206417.70 | Закупка не состоялась | 2026-10-20 00:00:00 | NOT_OPEN |
| 43613670 | Счетчик электроэнергии | 25000 | Закупка не состоялась | 2026-10-20 00:00:00 | NOT_OPEN |
| 43613639 | Счетчик электроэнергии | 10000 | Закупка не состоялась | 2026-10-20 00:00:00 | NOT_OPEN |
| 43613590 | Полотенце | 30000 | Закупка не состоялась | 2026-10-20 00:00:00 | NOT_OPEN |
| 43612339 | Бумага газетная | 30100 | Закупка не состоялась | 2026-10-20 00:00:00 | NOT_OPEN |

The search list said acceptance was open for these same records. Current lot pages
said otherwise. They are NOT_OPEN based on explicit terminal status, not an assumed
timezone. This is a real stale-index inconsistency; the collector must not treat
an accepting search label as a current bid opportunity. No conclusion about the
other 177 portal-reported records is justified by those five detail reads.

Source URLs, observation timestamps, source text SHA-256 and raw deadlines are
included in the snapshot. IDs originate in portal data-lot-id attributes and exact
links, not a newly executed OWS identity probe. They remain subject to the existing
OWS revalidation and full Plans/announcement/method checks before downstream GO.
The snapshot contains public fields only, no customer personal details or tokens.
No original TS, manufacturer match, real quote or profitable commercial GO was
verified for these five closed lots; nationalDecision stays HOLD_NATIONAL.

## Execute the useful read-only part

Local development, Node 22+ and curl, no npm packages/services required:

```sh
node tools/today-preview.cjs > /tmp/tender-today.json
node --test tests/*.test.cjs
```

The command selects the actual current date, not a hardcoded October 20 date.
Quota is capped at 200 attempts per rolling 24 hours in a private local temporary
ledger, max eight calls per run. Never clear a ledger to circumvent quotas. The
Apps Script collector uses the existing shared pilot quota ledger/script lock.
Both stop on malformed source, ignored filter, unexpected HTML/identity, rate
limiting, redirect or CAPTCHA. Failure clears partial results; no fallback is
represented as verified empty results. A response may take longer than the soft
runtime cap, but a late response is discarded.

After separately authorized publication, run `previewTenderToday()` in the Apps
Script editor. It returns and logs chunked JSON. `exportTenderTodayMvpCsv(report)`
returns formula-safe CSV text without creating/updating a spreadsheet. The existing
external-request scope suffices for this public collector; no OAuth token needed
for the portal. New files are included by existing dynamic deployment inventory.

## Actual production inspection, not an assumption

A read-only **prepare**, not publish, was run on existing main:
https://github.com/gostzakup-cmd/tender-ai-kazakhstan/actions/runs/39460568270

Existing GitHub Secret-backed OAuth successfully read Script ID
`1_UmAJ7xfIks7b2Q_PjDt_xUoEzovUIh5V5e_leuiJW2O9MGA9maQGL-y` and stored the complete
backup encrypted. `publish` job was skipped. The review metadata has no blocking
issues and no added scopes. Before: **10** files (eight original modules,
appsscript and preserved `Код`). Main's candidate: **49** files including retained
`Код`; **39** main modules are absent remotely. Only Pilot differs among existing
managed files. Source registry/source proofs and Script Properties values were not
read; Sheets, Secrets, runtime triggers and source code were not changed.

This PR adds one more .gs: local staging includes **48** root modules, all found by
the deployment tool, V8 syntax/global-binding check passed. Scope needs for optional
paid Document AI are NOT granted by this result. Apps Script cloud OCR remains
blocked without its separate billing/IAM/scope approvals.

The preparation above belongs to old main, not this unmerged PR. **Do not publish
that plan as though it includes the new collector.** After review/merge, create a
fresh prepare for the exact merged commit and explicitly approve its digest before
publish. Existing encrypted backup/review/remote-reread protections stay intact.
Both prepare and publish test gates now run ALL `tests/*.test.cjs`, rather than
only the three original suites. Local: **599 tests passed**, none failed/skipped.
No paid OCR/search, sync, pilot, daily trigger, Sheet write or tender application.

## Remaining end-to-end blockers and existing implementation

| Requested behavior | Current evidence / remaining blocker |
| --- | --- |
| Automatically find closing-day goods <=10m | New real public-date-filter collector; bounded sample and current-detail check work. No fabricated OWS deadline filter. |
| National regime | Existing NationalEvidence gate requires authorized current per-lot proof. No YES/NO was present on the inspected detail pages; HOLD_NATIONAL retained. |
| Full original TS PDF | Existing official metadata/download/hash/intake + OCR/review modules remain. No current eligible lot with proven original TS was obtained in this run. |
| Real KZ/RU/CN suppliers | Existing TS-first search/import/card/site modules remain. Brave and Document AI are opt-in; no paid API enabled. Search certification is not required. |
| 100% passport compatibility | Existing ManufacturerComparison and complete-criteria summaries require actual original manufacturer evidence; OCR hints alone never qualify. |
| Full cost and >=20% net margin | Existing ResearchPipeline/ReviewedSupplierQuotes require genuine independent offers, delivery, FX/taxes/all costs and planned bid. No real prices/costs were invented. |
| Production | Read access and protected prepare verified. New modules absent; owner-authorized publish still required. |

A genuine full-cycle run needs a current accepting lot, independently proven
source timezone/method/repeat semantics, current authorized national proof,
original full TS, actual manufacturer passport and real supplier/delivery/tax
sources. No password, token or refresh token should be sent in chat. Keep existing
GitHub Secrets. Publication, billable API use and automated tender applications
remain separate owner decisions. This PR alone does not complete those external
prerequisites and does not declare the project fully production-operational.
