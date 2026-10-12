# Strict offline TS / supplier / net margin engine (#25)

`evaluateTenderResearch(input, policy, nowIso)` runs in Apps Script JavaScript,
without any network, AI, Properties, Sheets, Drive or clock reads. It consumes
reviewed facts, evaluates every requirement, filters quotes and computes costs.
It is not an internet search or PDF extraction implementation. Nothing currently
routes real lots into it automatically. It depends on the national gate PR #26.

## Typed normalized input, version 1

| Record | Required shape |
|---|---|
| Root | schemaVersion:1, researchAuthorized:boolean, lot, nationalProof, ts, candidate, quotes[], selectedQuoteId:string, costs[], bid, profitTax, taxTreatment, competition, legal |
| Lot | canonical string Lots.id / announcementId / planIds[], lotNumber / announcementNumber / statusCode / unit:string, methods:positive integers, revisionHash:SHA256, verifiedAt/applicationStart/deadline:UTC ISO, amountKzt/quantity:number, isGoods/active/planCoverageVerified:boolean |
| Evidence | status:CONFIRMED, url:HTTPS, sha256:64 lowercase hex, locator:string (page/paragraph/offer line), observedAt:UTC ISO |
| TS | origin:ORIGINAL_PROCUREMENT_DOCUMENT, lotId/announcementId:string, fullDocumentReviewed/currentVersionVerified:true, version:string, evidence, criteria[] |
| Criterion | id:string (unique), requirement:string, critical:boolean, evidence referencing original TS SHA |
| Candidate | brand/model/partNumber:string, identityEvidence, assessment[] |
| Assessment | criterionId:string (one for every criterion), exact requirement:string, tsSha256/candidateIdentitySha256:SHA256 bindings, result:MATCH/FAIL/UNKNOWN, evidence |
| Quote | unique id, supplierId, independenceGroup:string, identityEvidence, sourceKind:SUPPLIER_OFFER/OFFICIAL_CATALOG, exact brand/model/partNumber/unit, currency:ISO code, unitPrice:number, priceEvidence, validUntil:ISO, stock:IN_STOCK, stockContradicted:false, availableQuantity:number, stockEvidence, leadTimeDays:number, deliveryCompatible:true, deliveryEvidence |
| FX | for non-KZT quote only: rateKztPerUnit:number >0, spreadReviewed:true, evidence |
| Cost | kind:enum below, quoteId:selectedQuoteId, currency:KZT, amountKzt:nonnegative monetary number, evidence |
| Bid | basis:PLANNED_OFFER, totalKzt:number <= lot budget, evidence (owner-reviewed price scenario, not guaranteed contract) |
| Profit tax | model:PROPORTIONAL, basis:PROFIT/REVENUE, rate:0..1, evidence |
| Tax treatment | reviewed:true, evidence for valid accounting/tax model, VAT inclusion/recoverability and no double-counting |
| Competition/legal | result:ACCEPTABLE, evidence |
| Policy | national:trusted source registry contract, maxEvidenceAgeMs:explicit approved positive freshness period |

CONFIRMED is an upstream **human/source-review attestation**, not a claim an LLM
may assign to itself. The engine checks presence, binding, timing and consistency;
it cannot independently verify source bytes, signatures, supplier ownership or
truth of web pages. Trusted production adapters must verify those things before
setting this status. Neither raw user/AI JSON nor a manual K-cell authorizes GO.
No source adapters or production policies are fabricated/approved by these PRs.

## What works

1. HOLD_NATIONAL/SKIP/missing national proof stops before commercial processing;
   valid bound PASS_TO_TS also requires explicit owner research authorization.
2. Complete original TS/version and all requirements are mandatory. Duplicate,
   missing or malformed criteria are REVIEW. Every criterion needs evidence;
   one verified FAIL -> NO-GO, UNKNOWN -> REVIEW. Only every MATCH yields
   TS_COMPLIANCE_100_PERCENT. Similar model/part number is never accepted.
3. At least three suppliers AND three independently reviewed economic groups
   are required for GO. Same supplier under conflicting groups is rejected.
   Search snippets, old/expiring prices, insufficient/contradictory stock,
   unknown lead time, unit mismatch and unreviewed FX are excluded. Quote prices
   must remain valid through the application deadline. Separate unconfirmedQuotes
   contain IDs and reasons; retain the immutable input source records alongside
   the result to preserve their unconfirmed prices/stock/delivery/FX separately.
4. The selected quote must itself be valid. Every cost is bound to that quote;
   a cheaper product cannot be combined with another supplier's freight costs.
   Each explicit cost category requires evidence even when zero/not applicable:
   DELIVERY, CUSTOMS, IMPORT_VAT, NONRECOVERABLE_VAT, OUTPUT_VAT_NET,
   BID_SECURITY_COST, PERFORMANCE_SECURITY_COST, CERTIFICATION, PLATFORM_FEES,
   BANK_FEES, FINANCING, INSURANCE, PACKAGING, CONTINGENCY, OTHER.
   Amounts are incremental cash costs: do not count included VAT twice. Security
   principal is not automatically an expense; account for verified fees,
   financing and risk according to the reviewed model. Unknown costs -> REVIEW.
5. Party purchase = quoted unit price × executable/reviewed FX × quantity,
   conservatively rounded upward to tiyn. Net profit deducts all extra costs
   and explicit supplied income tax model. No default tax/FX/risk/fee values.
   GO needs acceptable evidenced competition/legal checks and net profit /
   planned bid >=20%. Cross-multiplication prevents rounding 19.999% into GO.
   Markup uses landed cost denominator, separate from margin. Tax-inclusive
   landed cost, net profit, break-even and minimum bid for 20% are returned.
   Thresholds are conditional on the supplied proportional tax/cost scenario,
   not a substitute for accounting. Nonlinear/unverified tax models -> REVIEW
   until an approved model adapter is added. No automatic purchase or bid.

Result version 1: decision GO/REVIEW/NO-GO, researchAllowed, nationalDecision,
compliance, reasons[], validQuoteIds[], unconfirmedQuotes[], missingCosts[],
finance|null, revenueGuaranteed:false. Finance includes selected quote, KZT,
partyPurchaseCost, additionalCost, profitTax, totalLandedCost, plannedBid,
netProfit, netMarginPercent, markupPercent, breakEvenBid,
minimumBidFor20Percent|null. Same input/time gives same result; inputs untouched.
A GO is a conditional **reviewed bid scenario**, not promised profit/revenue.

## Tiny manual-first flow and real integrations

- Start with 2–10 explicitly owner-authorized lots, each <=10m KZT. For the
  current three lots there is still no approved national proof: remain HOLD.
- Obtain reviewed per-lot national evidence via Issue #22. Never bypass the gate
  by editing Sheets or declaring a screenshot belongs to an unknown Lots.id.
- Collect the original complete TS, verify its lot and current version, and
  retain original bytes/hash in approved storage. The real 43544048 PDF found
  earlier remains research material, not automatic commercial authorization.
- A human reviews every extracted TS criterion and manufacturer identity proof.
  Collect three genuine supplier offers with direct links/snapshots and date,
  stock, quantity, lead time, exact product and independently verified identities.
- Document all costs, planned bid, tax treatment, legal/competition constraints;
  evaluate the selected supplier scenario. Recheck quotes/status before bidding.
  Record outputs in Sheets only after separately authorized storage integration.

Next small production PRs: (1) approved original-document/Drive version adapter;
(2) full PDF text/OCR extraction through an explicitly chosen, billed provider
such as Google Document AI, with page locators and manual criterion review;
(3) permitted supplier catalog/offer APIs or manual offer capture, not simulated
web search; (4) source-review/freshness orchestration and authorized result views.
Apps Script can call such services with UrlFetchApp; provider credentials,
billing, permissions and quotas must be configured securely after owner choice.
Pricing/model names and endpoints are not invented here. This engine needs no
external service/key itself and has no search/OCR pretending to exist.

Existing categories (including the 79-category specification in open PR #5),
technical Sheets, accumulated data, Secrets, manifest/scopes and publish workflow
are unchanged. FULL_SCAN_DISABLED and daily-trigger guard remain active. No full
sync, pilot, watermark, external purchase, publish or Google function was run.
Tests use SYNTHETIC sources/products/suppliers, not real market offers/profit.
