# Issue #30 — manufacturer PDF integrity adapter

`ManufacturerPdfIntegrity.gs` handles one owner-approved URL discovered from an independently reviewed manufacturer-host sitemap. It verifies exact lot, model and source link binding, no redirects, 200 PDF MIME, size, PDF envelope and computes SHA-256 over received bytes. It does **not** parse the PDF, prove manufacturer's authorship, establish current product variant or supply any technical `MATCH`. Output is `BYTES_HASHED_UNREVIEWED` and does not contain PDF bytes.

There are no default permissions to execute network calls. Each request requires owner-approved policy and uses a shared request-attempt quota. Source identity and document semantics require separate review before the existing manufacturer comparison and technical-only shortlist can accept product facts. An SHA-256 hash only establishes the identity of received bytes, not authenticity or completeness.

CI uses synthetic PDFs; no live manufacturer download, paid API, Apps Script deployment, sheet write or bid occurred.
