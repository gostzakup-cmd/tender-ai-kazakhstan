# National gate: offline reviewed evidence contract (#22, #25)

`assessTenderNationalEvidence(lot, proof, policy, nowIso)` is a pure function.
It does not read Sheets, Properties, network, the clock, or user K-column values.
It returns HOLD_NATIONAL, SKIP, or PASS_TO_TS and allowedResearch.

The policy and its source registry are a **trusted adapter boundary**, not user
claims. No real adapter/registry is approved or installed in this PR. A JSON
object saying approved=true does not establish legal authority. Future runtime
wiring must obtain reviewed artifacts from a separately approved source adapter,
verify actual source bytes/hash, semantics and permission, and never load this
registry from NATIONAL_GATE/manual inputs. Current three lots remain HOLD.

A registry artifact attests the source URL/hash/version, actual YES/NO,
observation time, complete context and review of all plan rows and method-specific
exceptions. Changing NO/YES, timestamp or context while retaining the approved
hash is rejected. Current lot context includes Lots.id, visible number,
announcement ID/number, status, both methods, revision hash and all plan IDs.
Explicit owner-approved maxAgeMs is required; no arbitrary production TTL is set.
UTC timestamps are normalized upstream by a verified timezone adapter.

YES with complete current binding -> SKIP. NO also needs verified goods, all
plans, open application interval, active status, positive quantity and each
lot amount <=10m KZT before PASS_TO_TS. Neither outcome is a commercial GO.

Current official-source research remains in NATIONAL_LOT_PROOF.md and
NATIONAL_DOCUMENT_METADATA.md. The owner screenshot of announcement 17745688
proves a displayed YES, but its lot number/Lots.id remain unknown. The observed
frontend national_withdrawn is not added to OWS GraphQL. No new official API
facts, source approvals, signatures or freshness policy are fabricated here.

Tests use SYNTHETIC artifacts at example.invalid, exercise wrong/stale/changed
context, manual PASS, incomplete plans and exceptions, idempotency and tampering.
The VM has no Google services; all inputs must remain unchanged. CI runs all
`tests/*.test.cjs`. Publication, sync, trigger, Sheets and Secrets are untouched.
