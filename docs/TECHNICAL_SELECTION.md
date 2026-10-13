# Issue #30 — Technical-first product shortlist

`selectTenderTechnicalProducts(lot,ts,manufacturerPackets,policy,nowIso)` assesses the exact original TS against independently reviewed manufacturer datasheets, **without needing any supplier, quotation, warehouse stock, shipment, tax, FX or margin evidence**.

- `TECHNICAL_MATCH`: every single original TS criterion has a confirmed exact manufacturer match; TS compliance 100%.
- `TECHNICAL_REVIEW`: any missing/unreviewed/ambiguous technical evidence. A numeric suggestion never counts by itself.
- `TECHNICAL_FAIL`: at least one reviewed requirement fails. All original criteria are still reported.
  
Independent original PDF/current-lot/source registry and exact reviewer assignments are mandatory; no self-approval. Product brand/model/part number are exact and duplicate identities are blocked. The technical result is **not** a tender participation `GO`: national regime remains `HOLD_NATIONAL`, commercial decision `REVIEW`, financial values null. Prior to participation, use the existing national, legal, quote, stock, shipping, VAT, FX, costs and >=20% net margin gate separately.

Bounded to a single current goods lot <=10m KZT, <=20 manufacturer product packets and <=200 independently reviewed TS criteria. `previewTenderTechnicalProductsCsv` produces a formula-safe technical comparison only. No Sheets writes, scheduled execution, Apps Script deployment, paid services, manufacturer lookup or live document access took place. Synthetic CI is not evidence for any real product.
