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
