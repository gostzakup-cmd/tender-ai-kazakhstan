# Issue #30 — Integrated read-only workflow

The following executable public functions connect existing components:

- `planTenderProductCardFollowup(shortlist,searchPlan,searchReport,policy,nowIso)`: bind authentic search links to planned marketplace/model/part-number queries. Builds <=5 exact URL requests for `inspectTenderProductCards`; does not fetch or self-certify.
- `compileTenderWorkflow(shortlist,reviewedInputs,researchPolicy,searchReport,cardReport,nowIso)`: fail-closed comparison of the current closing-day shortlist, separately reviewed national/document/TS/quotes/tax evidence and optional search/card findings. Only `analyzeTenderSameDay` (which invokes national and original-document gates plus reviewed `evaluateTenderResearch`) can supply a financial GO. Unreviewed card observations are displayed separately with no KZT conversion, tax, stock or margin guesses.
- `exportTenderWorkflowCsv(report)`: CSV string with tender number, lot, quantity, budget, exact model and part number, verified selected supplier price, total landed cost, net profit, net margin, TS compliance, confidence, supplier, source and original document links. Quote values are only included when validated by the existing reviewed research engine.
- `inspectTenderIntegratedOnce(reviewedInputs,policy)`: one bounded, **owner-approved** official OWS read, followed by pure offline analysis. It never automatically calls Brave (paid), Sheets, publishing, triggers or bidding.

## Evidence boundaries

All original source URLs, hashes, freshness, amounts and lot identities still require their existing reviewed gate. National unknown -> HOLD_NATIONAL. Current authorized YES -> SKIP. A stale/revised lot cannot use yesterday's proofs. A missing PDF, unreviewed TS criterion, fewer than three independent genuine offers, unreviewed VAT/tax/delivery/FX or total cost yields REVIEW; 20% margin only applies to the independently reviewed conditional planned bid scenario. A search-result link or JSON-LD price is never enough to create a supplier quote. No synthetic evidence in production.

`coverage=sample_only` is compulsory; official V3 date-filter, lag, Plans, repeat deadlines, method/status policy and timezone semantics have not been fully proven in live production. Discovery is only a one-hour change/publication sample, not every tender closing today. Even when CI is green the real daily capture and source coverage remain unverified.

## Running status

Code is available for offline synthetic CI. Apps Script **not published**; no Google Sheet writes, daily trigger, broad scan, paid search, OCR or live tender bid. Full system pilot requires separate owner authorization after deployment and official date/status/source-policy confirmation. Never describe CI as proof of a real supplier's price, stock, delivery, complete TS match, national regime or net profitability.

`node --test tests/*.test.cjs` remains the CI regression suite.
