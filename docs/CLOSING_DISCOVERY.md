# Issue #30: bounded automatic closing-day discovery

New `inspectTenderClosingDayDiscovery(policy)` is a **manual invocation, read-only** official OWS V3 sampler. It replaces the requirement to supply Lots.id **for the sampled source window**, not for the entire portal. It does not automatically deploy or schedule the script, write Sheets, or claim a complete daily feed. It uses the existing API token only inside the owner's already-authorized Apps Script runtime.

The official checked-in V3 schema has **no direct acceptance-deadline filter** for Lots/TrdBuy. Therefore the module reads the first ten records from each of the four bounded streams, `TrdBuy.publishDate`, `TrdBuy.lastUpdateDate`, `Lots.lastUpdateDate`, `Lots.indexDate`, during the **previous one hour**, then joins at most 20 announcement IDs to Lots through `Lots.trdBuyId` in groups of ten. The resulting maximum is 30 unique Lots.id and up to ten total HTTP attempts, including retries. It passes these records through the existing `shortlistTenderSameDay` function, which must validate the *effective application deadline* on the selected portal-local day. **A recent publication or update by itself does not establish that a lot closes today.** Records that were not updated in that hour may be missed. No claim of daily coverage is permitted, even when all sampled pages report completion.

The code requires separately reviewed timezone/source-timezone identity, time-zone proof URL, method/status policy and repeat-deadline semantics. Ambiguous date, status, point-list/Plans coverage or national regime remains **REVIEW_DATE / HOLD_NATIONAL**. Current source API schema, actual pageInfo, status/method/date policies and authorization must be independently checked before interpreting a live result. The window depends on the source timezone and applies only to discovery streams, never as a substitute for the closing deadline. Non-monotonic IDs, contradictory pages, wrong filter responses, oversize responses, late responses and quota overruns stop with a redacted error rather than emitting partial evidence. The existing shared rolling 24-hour request-attempt ledger is preserved.

Each report has `coverage=sample_only`, `dailyCoverageVerified=false`, stream counts and `hasMore`, observation timestamp, selected IDs, statuses/reasons and `discoveryMode=OWS_V3_BOUNDED_AUTO`. Missing national/TS/supplier evidence is never supplied synthetically. This output deliberately retains `mode=SAME_DAY_SELECTED_IDS_READ_ONLY` for existing `analyzeTenderSameDay` compatibility; it never turns a shortlist item into a commercial GO without independently reviewed evidence. `sourceUrl` only exists when the separately verified route configuration is supplied.

### Restrictions

- No user approval for Apps Script publication, trigger setup or execution is inferred.
- No Sheets writes or spreadsheet changes; only the existing shared API attempt quota is persisted at runtime.
- No automatic supplier scraping or unverified price/stock figures; those remain further Issue #30 work.
- This is *not* exhaustive daily discovery. True comprehensive today-closing coverage requires source-level acceptance-deadline filtering or bounded indexed coverage with demonstrated lag/completeness guarantees; otherwise do not silently expand scans.

### Offline verification

`node --test tests/*.test.cjs` remains the CI command. New synthetic tests exercise partial pages, missing dates, duplicates, policy guards, hour windows and failure states. CI provides code regression protection, **not** live GraphQL data validation. The first real integrated pilot remains deferred until owner approval after remaining code implementation.
