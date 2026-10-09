# Bounded pilot evidence report template

**Status:** NOT RUN. Fill only with observed data; never invent counts, timestamps, supplier prices or coverage.

## Provenance
- Pilot run timestamp (with timezone): PENDING
- Git commit SHA and Apps Script deployed version: PENDING
- Official OWS v3 date semantics evidence URL / support response: PENDING
- Test window from/to, source timezone and inclusivity: PENDING
- API connection proof timestamp, mvpReady: PENDING
- Independent known lot IDs and portal/API links: PENDING

## Execution observations
| Field | Actual evidence |
| --- | --- |
| Run ID and complete flag | PENDING |
| Four streams: pages, filtered totals, observed IDs | PENDING |
| HTTP attempts and 24h quota remaining | PENDING |
| Unique Lots.id and plan fallback IDs | PENDING |
| PILOT_EVENTS by type and unique event keys | PENDING |
| PILOT_QUARANTINE count and reasons | PENDING |
| SourceChangedDuringRun / pagination errors | PENDING |
| Duration and stop reason | PENDING |
| Repeat same-window result and duplicate count | PENDING |

## Reconciliation
- [ ] Each independently expected lot ID appears, or a documented discrepancy is recorded.
- [ ] Lots.amount <= 10m KZT eligibility is based on Lots only; goods classification requires complete confirmed Plans.
- [ ] New publication and changes to existing lot/status are distinct.
- [ ] All excluded, deleted, missing-plan or ambiguous items have explicit reasons.
- [ ] No token, Authorization header, or personal data in evidence.
- [ ] All discrepancies investigated before claiming window completeness.

## Decision
**Pilot verdict:** NOT RUN / PASS LIMITED WINDOW / REVIEW / FAIL
**Nationwide daily coverage verified:** NO
**Watermark advanced:** NO
**Production daily trigger enabled:** NO
**Supplier pricing and profitability verified:** NO

Related: issue #6; docs/BOUNDED_PILOT.md; docs/stage2/PILOT_PREFLIGHT_CHECKLIST.md.