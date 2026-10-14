# Manufacturer PDF OCR fact worklist — Issue #30

`mfrPdfTextReviewCandidates(capture,candidate,receipt,policy,nowIso)` validates an externally supplied OCR response against the **actual PR #47 captured PDF SHA-256**, an exact candidate URL and explicit review policy, then retains all nonblank text per verified page anchor. Missing pages, overlapping anchors, unassigned text, stale sources and wrong hashes fail closed. `mfrPdfTextFactWorklist` is only a review checklist with null parameter codes, values and units; it does not manufacture engineering specifications.

This module does not fetch PDFs, call paid OCR, certify manufacturer ownership, validate the variant/current passport revision or assert TS match. These still require independent evidence and the existing `ManufacturerComparison.gs` review gate. Code runs offline and is synthetic CI tested; no Apps Script publication, Sheets write, billable call or live test.
