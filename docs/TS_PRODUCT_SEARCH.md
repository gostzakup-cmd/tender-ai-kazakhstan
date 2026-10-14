# TS product search by technical parameters

`planTenderTsParameterSearch(lot,productLabel,criteria,markets)` produces bounded KZ, RU and CN domain-specific search queries directly from known technical criteria. Brand, model, part number, certificate, price and stock are not required. The plan retains all constraints for eventual comparison, though the text query contains only two. It is a pure offline plan, not live sourcing.

Results remain `PENDING_PRODUCT_SEARCH` and `TECHNICAL_REVIEW` until exact product variants and every original technical criterion have been checked against trustworthy product documentation. This change does not run API queries, incur fees, publish Apps Script, or write Sheets. National and commercial participation decisions remain separate.
