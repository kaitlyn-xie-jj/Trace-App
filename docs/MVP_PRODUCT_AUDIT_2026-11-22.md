# Trace MVP Product Audit — 2026-11-22

## Scope and evidence limits

Scope: current `master` MVP, drafts PR #1 (key cleanup), PR #2 (save reliability),
PR #3 (Trace Core read/search), plus this audit's narrowly scoped backend fixes.

**Evidence levels**
- **Code-verified**: inspected GitHub source; denotes an implementation or defect hypothesis, not live user acceptance.
- **CI-verified**: GitHub-hosted tests/build completed; does not prove camera, mobile layout, real model, database concurrency or deployed configuration.
- **Unverified**: requires a live application, real SQLite fixture, browser/device, or credentials.

This audit environment could read/write GitHub through the connected integration, but
direct Git clone failed due unavailable DNS for github.com. No mobile-browser session,
real device, deployed endpoint, full interactive E2E run, or provider-backed AI call
has been performed. **This is a code/CI-backed partial audit, not a completed
full product acceptance.**

## Existing MVP feature inventory

| Workflow | Code evidence | Status |
| --- | --- | --- |
| Photo capture or upload | `App.tsx` file input and camera capture attribute | Implemented; real mobile permissions/UX unverified |
| Vision recognition and manual correction | `StorageView.tsx`, Gemini/Qwen service | Implemented; correctness/latency unverified |
| Save a photographed scene | `StorageView.tsx` → `dbService.ts` → SQLite routes | Implemented; reliable error handling addressed in unmerged PR #2 |
| Group, rename, move, delete | `GalleryView.tsx`, `server/index.js` | Implemented; merge/transaction concerns |
| Natural-language lookup and photo results | `ChatSearch.tsx`, AI services | Implemented; output quality unverified |
| Local first lexical search | Unmerged PR #3 | CI validated on that branch, not in master |
| Authentication and customer segregation | SQLite/API source | Missing, public multi-tenant blocker |
| Export, restore, and account deletion | No validated end-to-end path | Unverified/missing |
| Installed iOS/Android application | No validated native packaging | Not implemented/verified |

## Prioritized findings

### P0 — must resolve before a real organizer/lab deployment
1. **Customer/lab data isolation absent.** `/api/scenes`, `/api/chats`
   and `/api/categories` use shared SQLite tables without authenticated
   ownership. **Do not expose to unrelated customers.**
2. **Save reliability:** `App.tsx` previously swallowed write errors;
   `StorageView.tsx` previously deleted a scene before creating its replacement.
   PR #2 proposes fixes but is still separate and not CI-validated.
3. **Restore/backup assurance missing.** A physical storage memory product
   must reliably restore existing customers' records and photos after update,
   crash, or accidental deletion. No restore test evidence observed.

### P1 — user-visible correctness and workflow risk
4. **Server startup race:** previous `initDB()` call did not await schema
   initialization before `app.listen`; addressed in this audit branch.
5. **Clearing a category silently ignored:** `updates.superCategory || existing.superCategory`
   prevented moving a scene to uncategorized; replaced by validated, explicit
   update semantics in this audit branch.
6. **Category merge is not atomic in the intended sense:** inserting a new
   category name conflicts if it already exists, so the current rename endpoint
   cannot safely merge into an existing category. Requires tested semantics
   and UI handling (separate future fix).
7. **Model failure handling:** the AI service may turn provider errors into
   empty recognition results; users need a clear distinction between “no
   items found” and “recognition failed”.
8. **Search accuracy:** lexical direct matching in PR #3 has unit coverage,
   but AI fallback, visual search evidence, duplicate matches, and false
   positives have no mobile E2E evidence.
9. **Frontend dependency reliability:** PR #3 CI initially failed on a missing
   optional Linux Rollup binary, later fixed and CI passed on the branch.
   Dependency audit logs also reported vulnerabilities; each requires triage.

### P2 — polish and partner readiness
10. Need measurable mobile audit at 320/375/390/430px widths, safe-area
    insets, keyboard visibility, camera permissions, screenreader labels and
    reduced-motion mode. Fixed nav/header and absolute overlays warrant review.
11. Need repeatable demo fixtures for a professional organizer's client
    handover and an engineering lab's item-finding workflow.
12. Product does not yet have validated installer, telemetry, support, SLA,
    versioned migrations, or privacy/access-control disclosures.

## Current audit fixes

- Introduce `prepareSceneUpdate` to honor cleared fields and reject malformed
  updates without mutating input.
- Defer `app.listen` until successful SQLite initialization.
- Add six Node unit tests targeting update semantics.
- No schema migration, no new customer data model, no rollout.

## Release gates (not yet passed)

1. **Critical path E2E:** photograph → recognition → correction → save →
   reload → search → photo → edit → delete; failures and retries included.
2. **Database:** empty/fresh DB, seeded legacy DB, reopen/backup/restore,
   concurrent edits, invalid payloads; each must have observable outcomes.
3. **Mobile:** real Android and iPhone, slow network/offline, keyboard, photo
   permission denial, very large image.
4. **Partner pilot:** two isolated organizer clients and at least one small
   engineering lab workspace; demonstrate that no data crosses organization.
5. **CI and delivery:** PR unit/type/build checks, deployment smoke test,
   logs, recovery plan and rollback.

## Next action order

1. Run and merge tested reliability fixes (PR #2 plus this audit branch),
   reconciling shared-file conflicts.
2. Add reproducible API/SQLite integration tests and actual browser E2E
   tests; capture mobile screenshots, not only source review.
3. Fix classification merge, AI failure states, and preservation of user input.
4. Validate backup/restore and authenticated client segregation before B2B trials.
5. Only then expand organizer/lab workflows, while retaining existing MVP UI.

**Decision:** existing MVP is useful as a prototype and code foundation, but
is not yet verified as a production-ready, multi-client product.
