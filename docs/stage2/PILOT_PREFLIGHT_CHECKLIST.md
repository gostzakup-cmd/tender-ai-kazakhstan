# Bounded pilot — owner run checklist

This checklist is a **preflight**, not permission to deploy or execute. PR #4 CI passing proves offline behavior only.

## Gates (all required before running)
- [ ] Official OWS v3 date timezone and range semantics confirmed, documented in issue #6; do not assume Asia/Almaty.
- [ ] PR #4 reviewed and approved for publishing; backup and prepare/publish verification performed.
- [ ] Script properties verified without revealing secrets; GOSZAKUP_API_DATE_TIMEZONE is based on official evidence.
- [ ] Fresh testGoszakupV3Connection and getTenderStatus show valid proof and mvpReady=true.
- [ ] Select a *past* <=1-hour window with 2–10 independently known lot IDs; record source timestamps, status, trdBuyId, and expected IDs.
- [ ] Confirm remaining Google Apps Script quotas and no existing automation conflict.

## Controlled execution
1. Set TENDER_PILOT_WINDOW JSON with confirmed source timezone and exact from/to values.
2. Run **only** runTenderBoundedPilot once manually.
3. Inspect PILOT_RUNS: complete, per-stream counts, HTTP attempts, error reasons, quota and quarantine.
4. Compare PILOT_LOTS and PILOT_EVENTS with the independently known IDs; verify status changes are not mislabeled as new publications.
5. Inspect PILOT_QUARANTINE for unknown plans/types. Do not silently treat quarantined lots as goods.
6. Re-run the identical window to check idempotent events, staying within 200 requests/rolling 24h.
7. Record observed date boundary and index lag; repeat controlled windows only after evaluation.

## Hard stop conditions
- Any unknown timezone/filter boundary, missing fresh proof, mvpReady=false, or unreviewed deployment.
- Unstable pagination, inconsistent filtered totalCount, unexpected API changes, quota or duration cap.
- No verified source coverage or quarantined types misclassified as goods.

## Explicitly prohibited in this stage
Do not call syncTenderLots, dailyTenderSync, installDailyTrigger, or advance watermarks. Do not claim nationwide completeness, supplier verification, or daily readiness from this pilot.

References: docs/BOUNDED_PILOT.md, docs/STAGE2_READINESS.md, docs/stage2/GOSZAKUP_API_SUPPORT_REQUEST.md and issue #6.