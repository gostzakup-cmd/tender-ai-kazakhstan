# Issue #25 / PR #29: real PDF OCR and requirement candidates

Apps Script has no native complete PDF text parser. This module uses the real
Google Document AI `processors.process` API, with a reviewed OCR processor,
original full PDF `rawDocument.content` base64 and application/pdf MIME.
Official schemas checked 2026-10-13:
- https://cloud.google.com/document-ai/docs/reference/rest/v1/projects.locations.processors/process
- https://cloud.google.com/document-ai/docs/reference/rest/v1/Document

No request was sent to the paid service during development. All OCR fixtures
are SYNTHETIC. API fields are documented, not guessed; requestSourceSha256 /
providerResponse are our internal transport receipt, not Google response fields.

## Executable path

`extractTenderPdfRequirementCandidates(input, policy, nowIso, transport)` first
calls the original-byte intake from PR #28. Current national/source/version HOLD
states stop before base64/OAuth/OCR. Required extraction policy:

```
extraction: {
  approved: true, provider: 'GOOGLE_DOCUMENT_AI',
  projectId: /* actual approved project */, location: 'us' or 'eu',
  processorId: /* actual OCR processor */,
  expectedPageCount: /* independently reviewed original PDF count */,
  pageCountReviewed: true, pageCountSourceSha256: /* original PDF SHA */,
  maxTextChars: /* explicit limit, <= 1000000 */
}
```

The source/national registries remain trusted reviewed-adapter inputs, never AI
self-approval or manual K cells. No real policy/registry/processor is approved by
this PR. Expected page count is reviewed independently against original bytes;
it is not inferred from the response being checked. Safety cap is 15 pages,
not a guarantee of every processor's limits. Larger files need a separately
reviewed batch integration. No page selector is sent, so full PDF is submitted.

`createTenderDocumentAiTransport({approved:true,billingReviewed:true})` creates a
single-use real transport. It reads ScriptApp.getOAuthToken only at invocation,
POSTs to a validated fixed us/eu Document AI host, checks HTTP 200/JSON/size,
forbids redirects, and never reads/forwards GOSZAKUP_TOKEN. No retries or search
loops. Reusing the same transport fails before another billed request.

The extractor requires the receipt's original SHA, exact expected page count,
unique 1..N page numbers and bounded anchors in Document.text. All nonblank text
must be assigned to exactly one page. Missing/unread/blank pages, overlap,
invalid indices, unassigned text, service errors or changed source -> REVIEW
without candidates. Sharded out-of-range anchors are not silently truncated.
Google describes TextSegment indices as UTF-8 char indices; BMP text (Russian,
Kazakh, English) is handled, while surrogate/astral text is REVIEW until index
mapping is separately verified. No guessed Unicode byte/code-unit conversion.

Every nonblank OCR line is retained, including headings/table text and repeated
requirements on different pages. Each candidate contains text, exact
verbatimText, pageNumber, sourceSha256 (original PDF, not OCR response), sourceUrl,
sourceVersion, character locator and UNREVIEWED confirmation. This deliberately
retains potential requirements rather than dropping unclassified content.
Multiline requirements must be grouped by review while retaining their anchors.

All results remain status REVIEW, allTechnicalRequirementsVerified:false,
tsCompliance:UNVERIFIED, commercialDecision:REVIEW. OCR page/text coverage is
not semantic coverage or recognition correctness: an OCR engine can miss a
symbol, table or image requirement even when it returns all pages. Review every
candidate against original pages, identify administrative text, and confirm full
technical coverage before creating MATCH assessments for ResearchPipeline.
Unread/uncertain requirements never become 100% compliance or GO. Extraction
alone cannot authorize a product or substitute supplier evidence.

## Owner setup (not performed here)

1. Choose/enable a real Document AI OCR processor in an approved Google Cloud
   project and region, enable Document AI API, link billing and review quotas,
   data handling/retention and the selected processor's file/page limits.
2. Review current provider charges: https://cloud.google.com/document-ai/pricing
   Billing is per processed pages/processor tier. No price is hard-coded or
   invented here; a 2–10-lot run incurs actual provider charges and Apps Script
   UrlFetch/runtime quotas. No external API key/server is required for this
   Google OAuth mechanism.
3. Grant the executing principal the documented process permission and,
   only after separate consent, add cloud-platform OAuth scope and reauthorize
   Apps Script. Existing manifest does NOT grant that scope; it is intentionally
   unchanged in this PR. Do not copy tokens/service-account keys into chat.
4. Separately approve publication through existing prepare/review/publish.
   Then use only reviewed PASS_TO_TS/source-bound originals, approved policies
   and one newly created single-use transport per explicitly authorized file.
5. Inspect REVIEW candidates for 2–10 real authorized lots. Preserve original
   bytes/hash/version and reviewed corrections. Storage/Drive writes and the
   reviewer UI remain a separate PR; Sheets/Secrets are untouched here.

Tests cover full-page text/locators, source SHA, complete request bytes, unread or
missing pages, anchors/Unicode/receipt errors, duplication/replay, service failures,
Google-only OAuth, no redirects, single-use billing and blocking before paid calls.
No live Document AI execution, PDF semantic analysis or commercial result is
claimed by offline fixtures. FULL_SCAN_DISABLED/daily-trigger guard unchanged.
