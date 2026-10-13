# Issue #30 — public structured inventory and Kazakhstan shipping signals

The existing approved exact product-card HTTP probe now parses schema.org `Offer.inventoryLevel` and a single `OfferShippingDetails` with an explicit Kazakhstan `DefinedRegion`, bounded `QuantitativeValue` handling/transit days and `MonetaryAmount` shipping rate/currency. Ambiguous routes, units, thresholds, quantity scopes and prices remain null with review reasons. Public `InStock` alone does not become an inventory count.

`ProductCardProbe.gs` preserves SHA-256 over received bytes and returns `offerSignals.verification=UNREVIEWED`. `CardOfferEvidence.gs` carries public inventory and shipping as separate observed hints, not reviewed quantities, binding seller logistics, payable landed costs or verified quotes. Existing externally reviewed PRICE, STOCK and DELIVERY source snapshots are still mandatory. No conversion to `CONFIRMED`, no override of national HOLD, 100% TS or >=20% net profit.

No live web fetch, deploy, authorization to change Sheets, paid API, trigger, purchase or bid. CI uses synthetic schema.org payloads.
