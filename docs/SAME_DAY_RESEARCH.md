# Issue #30 / PR B: same-day evidence join

Depends on PR #31. `analyzeTenderSameDay(shortlist, inputs, policy, nowIso)` is a
pure offline preview: no network, paid OCR, storage, secrets, triggers or logging.
It reuses the national gate, original PDF byte intake and reviewed research engine.
It does not search the internet, manufacture supplier offers or infer restrictions.

Use the JSON result of inspectTenderSameDay plus at most 30 independently reviewed
research inputs in the existing evaluateTenderResearch schema. Each input also
contains original PDF bytes and the document metadata required by
acceptTenderOriginalDocument. Existing policy.national, policy.documents and
maxEvidenceAgeMs retain all protections. Set shortlistMaxAgeMs to an explicitly
chosen positive interval <=300000 (5 minutes); a fresh reread is required afterwards.

The lot in each input must exactly match the snapshot's Lots.id, user lot number,
announcement ID/number, status, planned and actual methods, per-lot budget,
quantity, complete plan IDs, effective start/deadline and verifiedAt equal to
shortlist.observedAt. Do not silently rebind old evidence to a changed lot.
Revision hash and unit are still independently verified by the existing evidence
registry; this join does not invent either. A future/missing/stale snapshot,
duplicate research input, changed context, elapsed deadline or changed portal day
cannot receive GO. Unknown national proof -> HOLD_NATIONAL; verified YES -> SKIP.

After current authorized NO, original PDF bytes must match their reviewed source,
lot, version and SHA-256. Reviewed TS evidence must match that same original
URL/hash/version before the existing research engine runs. OCR output alone is
not full-document review. All existing criteria, exact product identity, three
independent real supplier offers, stock/delivery, exchange rates, zero/nonzero cost
evidence, tax, legal and competition checks remain. The selected planned bid is
not guaranteed revenue. Net margin below 20% produces NO-GO, absent evidence REVIEW.
The summary exposes validated supplier source URLs and original TS provenance,
finance and missing/unconfirmed evidence without writing a Sheet.

## What is genuinely executable and what is blocked

Both JavaScript functions execute with reviewed inputs and return JSON. Unit tests
are synthetic; they do not establish a profitable real tender. Existing research
suite verifies conditional GO, exactly 20% net threshold and unsafe-input blocking.
Integration tests verify gate order/context binding and a real national gate with
no source proof. No live suppliers, paid OCR, real PDF extraction or API execution
was performed for this PR. The normal portal remains the manual shortlist source.

Owner prerequisites for the first real 2–10 lot run: independently confirmed
source/portal timezone and repeat/method-status policy; actual portal-selected
Lots.id; current authorized per-lot national YES/NO evidence; original full TS PDF
with reviewed binding/version; complete technical criteria and exact product match;
real independent supplier offers with price/availability/delivery; reviewed taxes,
costs and proposed bid. Paid OCR is optional and still needs separate authorization;
manual full-PDF review may supply genuine inputs without enabling billing.
Apps Script deployment/execution and any future Sheet writes require their separate
owner approvals. This PR never makes those approvals or changes Secrets.
