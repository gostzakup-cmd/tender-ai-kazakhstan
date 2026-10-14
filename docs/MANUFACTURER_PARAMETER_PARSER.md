# Issue #30 — manufacturer OCR numeric parameter suggestions

`proposeTenderManufacturerOcrParameters` takes PR #48's original page-anchored OCR line worklist and returns conservative suggestions for power (kW), voltage (V), frequency (Hz), head (m) and flow (m3/h). Exact numeric tokens and explicit units are required; ambiguous, multi-value, range and uncertain lines remain REVIEW. Decimal commas are normalized only for the numeric *suggestion*, never for a confirmed manufacturer claim. Every suggested fact retains its page, source URL, SHA-256 and original text. Nothing is written to Sheets and there is no OCR call.

**These are not confirmed manufacturer parameters or a technical MATCH.** The independently reviewed datasheet identity, specific product variant, all TS criteria, original file bytes and existing reviewer evidence are still required before technical selection can pass. Synthetic tests do not attest any real product.
