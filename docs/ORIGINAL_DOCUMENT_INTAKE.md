# Issue #25: original procurement-document byte intake

`acceptTenderOriginalDocument(input, policy, nowIso)` is Apps Script JavaScript.
It accepts actual bytes (for example, `blob.getBytes()` from a separately approved
acquisition adapter) and returns a verified artifact reference or HOLD_DOCUMENT.
There is no network, file creation, Sheets/Drive/Properties access, secret read,
logging, automatic publication or analysis in this module.

## Required trusted inputs

- `input.lot`, `nationalProof`, `researchAuthorized:true`: same normalized contract
  as NationalEvidence.gs. Only fully bound current PASS_TO_TS reaches intake.
  Existing real HOLD_NATIONAL lots stay blocked even if PDF bytes are supplied.
- `input.document`: kind ORIGINAL_PROCUREMENT_DOCUMENT, official source HTTPS URL,
  nonempty version, SHA-256, observedAt (normalized UTC ISO), application/pdf MIME,
  context containing id/lotNumber/announcementId/announcementNumber/revisionHash
  and complete planIds. These are internal contract fields, not invented API names.
- `input.bytes`: an Array of integer unsigned 0..255 or signed -128..127 bytes.
  Google Blob.getBytes() representation is supported; caller retains original.
- `policy.national`: trusted separately reviewed national source registry.
- `policy.documents`: approved:true, explicit maxAgeMs, explicit maxBytes
  (16 bytes through 10 MiB), and reviewed artifact records with exact metadata,
  context and approved/sourceBindingReviewed/currentVersionReviewed/
  fullOriginalReviewed:true.

The document registry is a **trusted upstream source-review boundary**. It must
not be populated from a filename, FileLots.objectId, manual K column, user/AI
assertions or PDF header heuristics. A supplied approved=true is not proof of
truth. Future adapters must review official source lineage, exact lot/plan and
announcement binding, current version and complete original. No real registry,
source permission or positive national evidence is created/approved by this PR.

Only previously observed official original-document origins old.goszakup.gov.kz
and v3bl.goszakup.gov.kz are supported. URL paths are supplied and reviewed, never
constructed from guessed IDs/endpoints. Query/fragment/credential-bearing URLs
are rejected and not reflected in errors. Supporting other origins needs a
separately reviewed integration; there are no HTTP calls or redirects here.

## Acceptance checks and meaning

1. National gate and explicit research authorization before byte/hash handling.
2. Exact reviewed source URL/hash/version/time; fresh source observation with an
   explicit approved policy. No assumed version from indexDate or source filename.
3. Full stable Lots.id/visible number/announcement/current revision and plan binding.
4. Integer bytes and configured size limit, basic %PDF-1.x/2.0 envelope and terminal
   %%EOF, then exact SHA-256 of the original bytes without modifying them.

On success: status ORIGINAL_BYTES_VERIFIED, accepted:true, artifact with lot and
announcement identity, revision, source URL, version, SHA-256, byte length, MIME
and observation date. This can key later Drive deduplication/version retention.
The function does not persist anything or discard prior versions.

**Byte hash and envelope checks are not a PDF parser, cryptographic signature
verification or proof that PDF text contains the lot number.** Reviewed upstream
binding is still required. Always pdfParseVerified:false, signatureVerified:false,
extractedTextVerified:false, tsCompliance:UNVERIFIED, commercialDecision:REVIEW.
No GO or MATCH is produced. An encrypted, active-content or structurally malformed
PDF must be handled by a separately approved parser/security review before TS
extraction; intake does not render/execute it. Test envelopes are SYNTHETIC, not
claims of valid complete PDFs. No fake OCR/AI or supplier searches are added.

The real 43544048 PDF observed in prior research is recorded in
national/issue22-document-observations.json. Its current source version and the
lot's national absence are still unapproved; it is not automatically admitted.

## Next integration and a real 2–10-lot cycle

After approved national proof and separately authorized runtime publication:
obtain original bytes via the approved document source, call intake with trusted
reviewed context, then retain original bytes and accepted reference in an explicitly
approved Drive folder. Drive writes/scopes and version handling are a separate PR.
Next extraction must read the whole PDF with real parser/OCR and page locators,
preserve unknown characteristics, and obtain reviewed criterion evidence before
ResearchPipeline can count 100% compliance. Receiving a PDF is not TS approval.
Use 2–10 owner-authorized real lots and real supplier offers only after these gates;
no real full-cycle pilot, full sync or daily trigger was run here.

Offline tests cover wrong/stale context/version/hash, incomplete plan bindings,
HTML masquerading as PDF, MIME/EOF/size/byte errors, signed-byte SHA compatibility,
blocked national states before hashing, replay and input preservation. VM has
no network or Google storage services. CI uses `node --test tests/*.test.cjs`.
Manifest/scopes, existing category/specification files, Sheets/formulas, Secrets,
FULL_SCAN_DISABLED and trigger guards are unchanged.
