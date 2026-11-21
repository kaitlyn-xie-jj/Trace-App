# Trace Core v0 — Compatibility-first inventory read model

## Purpose

Trace is developing two workflows in parallel:
- **Professional organizers**: capture a client's rooms and storage spots; deliver a searchable record.
- **Engineering labs**: find tools and components by location; later support quantities and borrowing.

Neither workflow requires replacing the existing Scene editor as a prerequisite.

## Implemented in this PR

`GET /api/core/inventory` reads existing rows in `scenes` and derives a normalized response:

```json
{
  "schemaVersion": 1,
  "source": "legacy-scenes",
  "ownershipScope": "unassigned",
  "locations": [
    {"id": "[\"实验室\",\"抽屉 A\"]", "spaceName": "实验室", "name": "抽屉 A", "source": "legacy-scenes"}
  ],
  "items": [
    {
      "id": "[\"scene-123\",0]",
      "name": "万用表",
      "category": "工具",
      "locationId": "[\"实验室\",\"抽屉 A\"]",
      "sourceSceneId": "scene-123",
      "sourceIndex": 0,
      "recordedAt": 1700000000000,
      "identityStatus": "provisional",
      "attributes": {
        "remarks": "",
        "preciseLocation": "",
        "isPerishable": false,
        "shelfLifeDays": null
      }
    }
  ],
  "warnings": []
}
```

- The original `scenes` rows remain authoritative and are never modified by the projection.
- The endpoint deliberately excludes photographs / base64 blobs, avoiding large search-list responses.
- Same-named spots in different spaces are distinct.
- Malformed historical items are reported as warnings rather than stopping the entire list.
- Every fresh request reprojects current scene contents, so old edit/delete routes remain compatible.

## Not yet implemented (do not assume otherwise)

- **No stable item identity**: provisional item IDs are derived from `scene.id` + array index and can change when items are reordered or deleted.
- **No organization/customer separation or authentication**: `ownershipScope: unassigned` is explicit. This endpoint shares the same authorization weakness as existing routes and is NOT safe for public multi-tenant use.
- No item movement, borrowing, quantity ledger, QR, history, hardware device integration, write API, or standalone item table.
- No automatic migration, no production backup, and no API version stability guarantee.

## Next design gate

Before the first **write** to Trace Core, decide durable item IDs, organizations/clients, user membership and RBAC, physical location hierarchy, migration rollback, and sync policy between legacy scene writes and new item writes.

Suggested acceptance tests for that future gate:
1. Existing scene galleries and chats remain unaffected.
2. Every historical scene remains recoverable after migration.
3. Editing a scene and editing a structured item do not silently diverge.
4. A client/project cannot read another client/project's inventory.
5. Lab quantities and borrow/return operations are recorded transactionally.

## Verify locally

```bash
npm install
npm test
npm run build
```

CI runs these commands for pull requests. The architecture document does not assert that any specific run has passed.

## T-01: Deterministic search

New endpoint: `GET /api/core/search?q=护照&limit=20`.

It runs `projectInventory` over the same legacy scene rows, followed by
`searchInventory`. It does not send data to any AI provider.

- Exact names rank above name-in-question/substring matches, followed by category,
  storage spot, space and descriptions.
- Results include the originating `sourceSceneId`, provisional record ID,
  location and `matchedField`; they are **evidence of the last recording**,
  not proof the physical item remains there.
- `count` is total matches and `truncated` indicates whether the requested
  1–100 limit cut off any results.
- Input is bounded to 1–200 query characters and the route returns 400 for
  invalid inputs.
- The matching is lexical, not semantic: synonyms, typos and ambiguous terms
  are not guaranteed to match. The existing AI-powered chat remains unchanged.
- **Security**: this endpoint shares the unauthenticated legacy API boundary.
  Do not expose organizer/customer or laboratory information to untrusted users
  until account ownership and authorization are implemented.

CI: unit tests cover both the legacy projection and this search module.
A prior CI run passed the initial 6 tests but failed the frontend build on the
missing optional `@rollup/rollup-linux-x64-gnu` dependency. This branch adds a
Linux CI-only install step; it must still be verified on a fresh workflow run.

The T-01 endpoint is an **API foundation**: the current React chat screen is not
yet wired to use it. The follow-up acceptance gate is a client-side path with
lexical-first search, carefully scoped AI fallback, and UI integration tests.
