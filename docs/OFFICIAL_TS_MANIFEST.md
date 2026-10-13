# Issue #30 — Official OWS V3 original-TS metadata preview

Adds `prepareTenderTsManifest(shortlist,rows,nowIso)`, `inspectTenderOfficialTsMetadata(shortlist,policy)`, and `joinTenderTsManifestPreview(workflow,metadata)`.

Official schema confirms `Lots.Files: [FileLots]` and `FileLots.id,objectId,originalName,nameRu,nameKz,indexDate,systemId`. The bounded opt-in GraphQL read fetches **exactly the selected IDs**, up to 30 in batches of 10, with a shared quota and max four network attempts (including transport retries). It verifies lot number, announcement ID/number, method, status, amount, quantity and effective deadline fields remain identical to the recent selected shortlist. No broad scan, file download, GUI scraping or other site access.

File names of the precise pattern `techspec_{announcementId}_{lotId}.pdf` are **hints only**. `objectId` semantics and document version are not verified by the API SDL; no download URL is inferred from `filePath` or IDs. There are no verified PDF bytes, signature, version, current revision, full TS assessment or national yes/no. `HOLD_DOCUMENT`, `METADATA_ONLY`, `HOLD_NATIONAL`, `REVIEW` are deliberate. Explicit null, empty, malformed, duplicate and oversized relation statuses stay visible. The existing `acceptTenderOriginalDocument` approved byte/URL/hash policy remains mandatory.

`joinTenderTsManifestPreview` adds filename hints to the PR #37 tender review report **without overriding** confirmed original links or creating new links. No 100% TS compliance or price/margin is inferred.

No Apps Script deployment, Sheet writes, trigger, watermark, paid OCR, paid API, bid or original PDF HTTP download. Unit tests are offline synthetic only; real FileLots response and URL binding remain future owner-authorized integration requirements.
