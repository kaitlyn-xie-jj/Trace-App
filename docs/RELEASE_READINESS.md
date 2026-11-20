# Trace release readiness — security baseline

Status: **NOT READY for public deployment or app-store submission**.

## Immediate incident response

- [ ] Revoke/rotate the DashScope credential previously hard-coded in `services/qwenService.ts`. Removing it from HEAD **does not remove it from Git history, existing clones, or deployed bundles**.
- [ ] Review DashScope usage and billing for unauthorized use.
- [ ] Check any deployed browser bundles and other branches for the credential. Do not reintroduce the key as a `VITE_*` variable.

## Release blockers (confirmed by code inspection)

1. **Browser-visible AI credentials.** `services/qwenService.ts` sends a client-side token; `services/geminiService.ts` also reads a `VITE_GEMINI_API_KEY`. All provider calls must be made by the server using server-only environment variables. The existing `/dashscope-api/*path` route forwards an arbitrary client Authorization header and is **not** a secure replacement.
2. **No user separation.** The `/api/scenes`, `/api/categories`, and `/api/chats` routes have no session authentication or ownership checks. The SQLite schema does not associate data with an account. Do not deploy multi-user or publicly reachable storage APIs until this is addressed.
3. **Unsafe default sharing.** All scenes and chat history live in shared database tables. Add account/home scope, authorization checks for every read/write/delete operation, and automated cross-account isolation tests before beta.
4. **Image/data limits and privacy.** `express.json({ limit: '50mb' })` permits very large base64 payloads. Introduce bounded uploads, media storage, retention/export/deletion paths and a privacy policy describing what is sent to model providers.
5. **Operational readiness.** Add repeatable build/typecheck/test steps, backend integration tests, backup/restore procedures, migrations, a health endpoint, and production observability before mobile packaging.

## Recommended launch sequence

- **P0 security:** rotate compromised credential; migrate Gemini/Qwen to authenticated, rate-limited backend routes; remove browser API secrets; confirm credentials cannot appear in production bundles.
- **P1 usable private beta:** accounts or explicit single-user local-first mode; per-user data ownership; reliable photo capture, manual correction, text search, backup/export/delete, and failure recovery.
- **P2 mobile:** choose Capacitor to reuse the React/Vite UI initially; implement iOS/Android permissions, camera/photo library, offline/poor-network behavior, accessibility and device testing.
- **P3 store submission:** legal/privacy disclosures, app icon/screenshots, support contact, account deletion (if accounts exist), Apple/Google policy check, TestFlight and Play closed testing, then submission.

## Product acceptance criteria for initial beta

1. A new user can capture one drawer, correct recognized items, save the location, and search for a saved item in under a minute.
2. A second user cannot read, modify, or delete the first user's images, inventory, or conversation history.
3. No AI provider credential appears in JavaScript assets or browser network requests.
4. Failed AI requests do not destroy user-provided location or item data.
5. User data can be exported and deleted without developer intervention.

This checklist is an engineering plan, **not** evidence that these requirements have been implemented or tested.
