# Issue #30 — Product card to supplier evidence queue

`assembleTenderCardOfferEvidence` joins an exact read-only card response from `ProductCardProbe.gs` to an approved shortlist and separately supplied seller, stock and delivery snapshots. The only price is the **observed** JSON-LD price whose response bytes were hashed by the card probe. The adapter does not search for missing data, infer stock quantity from `InStock`, infer delivery to Kazakhstan, assume an FX rate or certify supplier ownership. If seller, stock or delivery evidence is missing, the record stays REVIEW with a concrete missing-evidence reason.

Where all three **unreviewed** observations exist, the bridge generates structured input to `intakeTenderSupplierOffers`; independent verification via `ReviewedSupplierQuotes.gs` is still mandatory before any quote can count towards three suppliers, TS 100% or 20% net margin. Price comparison is **within the same currency and lot** only, not converted into KZT without reviewed FX, tax and logistics data. `previewTenderCardOfferEvidenceCsv` creates a formula-safe CSV preview string without Sheets writes.

No live retailer pages were fetched by this PR, no official supplier relationship is verified, and no Apps Script deployment, trigger, Sheets writes, billed API call, bidding or national proof is created. Tests use synthetic cards and evidence.
