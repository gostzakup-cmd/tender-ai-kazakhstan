# Issue #30 — Certificate-independent technical product search

Product discovery does not require a certificate, declaration, price, stock or shipping evidence. `planCertificateIndependentProductSearch` uses only brand/model/part number as discovery inputs; certificate requirements are tracked separately as `DOCUMENT_NOT_VERIFIED`. `attachCertificateStatusToTechnicalShortlist` does not remove previously technically matched products because a certificate is missing.

This change does not waive compulsory bid-submission or statutory documentation: documentary compliance is separately `DOCUMENT_REQUIRED` and commercial participation remains `REVIEW`. The existing independent technical source-review engine still requires credible original TS and product technical facts; no false 100% TS certification is inferred from missing evidence. Pure offline regression tests only.
