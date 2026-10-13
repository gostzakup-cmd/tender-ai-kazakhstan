# Issue #30 / PR A: closing-day shortlist

Manual read-only selected-ID MVP, not discovery of all tenders in Kazakhstan or
all tenders closing today. Existing sync/pilot/trigger/watermark blockers remain.
No Sheets reads/writes, Secret changes, automatic publication or paid services.
The only persistent write on execution is the existing shared attempt quota ledger
`TENDER_PILOT_QUOTA` under the script lock; never lot history or owner data.

## Official source and bounded coverage

https://ows.goszakup.gov.kz/help/v3/schema/lotsfiltersinput.doc.html returned
HTTP 200 during development on 2026-10-13. Existing checked-in
`docs/v3-schema/lotsfiltersinput.graphql` documents `id: [Int]`; neither it nor
TrdBuyFiltersInput documents an acceptance deadline filter. No invented endDate
filter, portal endpoint or publication-date substitute is used.
Existing V3_FIELDS maps `TrdBuy.endDate`, repeatStartDate/repeatEndDate and
Lots.amount/count. Method IDs remain separate planned/actual fields.

Select up to 30 actual Lots.id from the ordinary portal's closing-day search.
The module does not automate that UI search or bypass access restrictions.
`inspectTenderSameDay(selection, policy)` refetches exactly those IDs in batches
of 10, without cursors. Missing IDs are reported, duplicate IDs are quarantined.
Returned scope is validated per batch. Null API lists are conservatively blocked,
not guessed to mean empty. At most four attempts including existing retry
attempts, 30 seconds between attempts/batches, and shared rolling 24-hour quota.
One in-flight UrlFetch request can overrun the soft time limit; its late result
is rejected. Failed runs expose no partial shortlist or raw errors.

## Running after separate deployment authorization

Do not deploy/run automatically. In the owner's authorized Apps Script project,
use a wrapper returning the JSON report:

```javascript
function previewSelectedClosingDay() {
  return inspectTenderSameDay(
    {date: '2026-10-13', ids: [/* independently selected actual Lots.id */]},
    reviewedClosingDayPolicy // separately reviewed configuration described below
  );
}
```

An empty ids list is rejected without HTTP. No token belongs in the wrapper;
existing API transport reads the existing GOSZAKUP_TOKEN property. Date is the
current portal-local date at response observation time, not publication date.
Expired same-day lots remain EXPIRED. Future-start/ambiguous lots remain
REVIEW_DATE. No bid submission is implemented.

`reviewedClosingDayPolicy` is an internal trusted configuration, not an API field
or unreviewed AI assertion. It must contain approved=true, timezoneVerified=true,
timezoneProofUrl (the actually reviewed source), sourceTimezone and
portalTimezone (independently proven IANA zones), repeatSelectionVerified=true
(reviewed applicability of the paired repeat dates), and methodStatuses entries
{approved:true, actualMethodId, codes:[...]}, scoped to confirmed bid/offer
acceptance states for that method. No timezone or method/status policy is supplied
as confirmed by this PR. Matching date strings alone is not timezone proof.
Unknown source timezone/policy blocks classification, even when date strings match.
Optional lotUrlVerified=true plus lotUrlTemplate using {id}/{trdBuyId} may only be
supplied after verifying that route for the selected methods/lots; otherwise
sourceUrl=null, never a guessed direct link. API source is the existing fixed OWS
V3 endpoint. The report stores both raw deadlines and normalized effective
deadline/timezone, announcement/lot identities, planned/actual method and observation.

Review every retained candidate manually before bidding. Re-run close to deadline:
this is a snapshot, not a guaranteed continuing opportunity or a price forecast.

## Next small PR B

Join at most 10–30 SAME_DAY_CANDIDATE snapshots to original-document and research
inputs with exact identity/current revision validation. Reuse
assessTenderNationalEvidence, acceptTenderOriginalDocument,
extractTenderPdfRequirementCandidates and evaluateTenderResearch. Unknown national
proof remains HOLD_NATIONAL. No actual suppliers/prices/OCR results are generated
by PR A. Real reviewed supplier offers, full TS evidence and costs remain required
before any conditional GO; lot budget is never guaranteed contract revenue.
No billing authorization is implied. Paid OCR remains disabled.

## Validation and remaining blockers

`node --test tests/*.test.cjs`: offline synthetic tests for selected-ID batching,
source failure redaction, quota accounting, method distinction, missing Plans,
repeat deadlines, midnight boundaries, expiration, duplicate IDs and absent source
proof. Existing national/research/document tests run unchanged. No real OWS request
was made: cloud has no authorized Goszakup token binding; the owner's token stays
in Apps Script. No claim of live closing-day coverage or profitable real lot.
Owner still needs independently proven timezone/repeat/status policy, a small list
of portal-selected Lots.id, and later explicit deployment/execution authorization.
