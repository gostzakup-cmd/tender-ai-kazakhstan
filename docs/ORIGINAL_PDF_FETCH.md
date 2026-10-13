# Issue #30 — exact approved original PDF fetch

`OriginalPdfFetch.gs` introduces `preflightTenderOriginalPdf_`, `inspectTenderOriginalPdfResponse_` and `inspectTenderOriginalPdfOnce`. This is **not** a general PDF URL finder or a source-approval engine.

Only an exact, separately reviewed public `https://v3bl.goszakup.gov.kz/files/download_file/<opaque>/<opaque>/` URL may be requested. The opaque path IDs must **not** be generated from `FileLots.id` or `objectId`; `filePath` is not a verified source URL. Caller supplies current full normalized lot/plan/announcement context, reviewed official per-lot `NO` national evidence (else `HOLD_NATIONAL` or `SKIP`), explicitly approved original-document URL/hash/version/date/lot binding, and a separate owner-reviewed per-file download allowlist. A boolean alone does not independently establish source truth.

When authorized to execute in a separately deployed Apps Script runtime, the module performs **at most one** bounded GET, no redirects, cookies or auth headers, and charges the existing rolling request-attempt quota. It rejects non-200 HTTP, non-PDF MIME, unknown content encoding, oversized bytes and inconsistent declared content length; then reuses `acceptTenderOriginalDocument` for independent PDF envelope, exact SHA-256, source age/context and national gate checks. A malformed or stale source cannot be accepted; errors are redacted and PDF bytes are not returned, logged or written to Sheets/Drive.

Output `ORIGINAL_BYTES_VERIFIED` confirms only that the downloaded bytes match *an already reviewed approved source artifact*. It does not verify parsing, digital signature, all pages, technical requirements, supplier match, 100% compliance or profitability. The previous `extractTenderPdfRequirementCandidates` OCR adapter still requires separate explicitly reviewed billing approval. No paid OCR is invoked.

**Not executed live.** No Apps Script deployment, authorization change, national source attestation, token access, Sheets write, trigger, bid or PDF download took place in this PR. Offline synthetic tests cover the guarded transport and failure modes. This is source integration code, not completion of Issue #30.
