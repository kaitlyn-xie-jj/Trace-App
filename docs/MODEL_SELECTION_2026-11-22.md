# Trace model selection — preliminary shortlist (2026-11-22)

**Decision state: experiment-first, not a production provider switch.** The existing MVP supports Qwen/Gemini through client-side services. This note records what to compare next; no claim of having run live provider benchmarks is made.

## Product workloads (not general chatbot leaderboard)

1. **Capture**: one drawer/shelf photograph → item names, category, short appearance features, approximate location/box, optional expiry flags. An incorrect *invented item* is worse than an acknowledged uncertain result.
2. **Retrieval**: question like "那个黑色圆形的小东西在哪里" → grounded Scene/Item references. Description-based search matters as much as exact name search.
3. **Edit & recovery**: model failure must not discard user corrections, overwrite existing memories or appear as an empty photo.
4. **Regional use**: organizers/families in mainland China; students/engineering labs in UK/international regions. Region and data retention/consent must be decided before production.

## Provider candidates (official docs verified 2026-11-22)

| Model | Proposed role | Strength to test | Caveat |
| --- | --- | --- | --- |
| **Alibaba Model Studio qwen3.8-flash** | **Primary candidate** | Native image understanding, structured output, low listed token price; China and international deployment options | Must measure tiny-item recall, Chinese mixed SKU reading, 2D coordinates, latency and actual image token usage |
| **Google Gemini 3.8 Flash** | Independent quality challenger / fallback candidate | Multimodal understanding and structured output via Gemini API | Image-token accounting, price transition after 2026-12-31, and region/network restrictions |
| **Alibaba qwen3-vl-plus** | High-detail/grounding challenger | Vision-specific family; 2D localization and OCR potential | Not assumed to be better or cheaper; benchmark before using on every capture |

Official references:
- Qwen model capability list: https://www.alibabacloud.com/help/en/model-studio/text-generation-model
- Qwen model pricing: https://www.alibabacloud.com/help/en/model-studio/model-pricing
- Qwen OpenAI-compatible VL API and regional endpoints: https://www.alibabacloud.com/help/en/model-studio/qwen-vl-compatible-with-openai
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini image understanding: https://ai.google.dev/gemini-api/docs/vision

**Published standard/token pricing (USD per 1M tokens, not per photograph):**
- Qwen3.8 Flash Beijing: input $0.113, output $0.382; Singapore: input $0.15, output $0.47.
- Gemini 3.8 Flash standard: input $0.75, output $3.75 through 2026-12-31, announced $1.50 and $7.50 beginning 2027-01-01.
- Prices are region-specific and time-dependent. An actual photograph may consume widely varying visual tokens, so use billed usage in the bakeoff; do not infer cost per photo directly.

## Pre-registered bakeoff (requires consented photos and server-held credentials)

- 60 photos from three scenarios, manually annotated:
  - 20 home/organizer drawers, including hidden, stacked, glossy, similar objects.
  - 20 workshop/lab drawers with mixed English/Chinese SKU, M5/M4 fasteners, cables and sensors.
  - 20 pantry/fridge/shared home locations with expiration-relevant items.
- Annotate items, spatial locations/boxes if visible, visual descriptions, and **not-visible/uncertain** cases. Separate poor-quality images.
- Run each model on the **same resized input** and **same JSON schema**, temperature/thinking mode fixed where supported, same retries and concurrency. Record actual request usage.
- Metrics: item precision/recall (both equally important), small-item recall, false-positive rate, JSON validity, box IoU where applicable, p50/p95 latency, billed cost per image and per successful scene, failure rate.
- Retrieval set: 120 manually written queries covering exact names, paraphrases, appearance descriptions, vague terms, and intentionally absent items. Evaluate Recall@3, MRR, grounded-answer error rate, false-presence rate.
- Evaluate results separately by cohort. Do not collapse high-volume easy objects into a single average.
- Production gates: no cross-customer leakage; non-invented location claims; explicit failure/uncertainty; user corrections persist through model failure. A provider is preferred only after matched evidence.

## Important current engineering liabilities

1. **Client-exposed API credentials**: `VITE_*` keys (and the legacy Qwen hardcoded fallback still on the current parent branch) are available to browser clients. The expired key is not the objective; shipping new billing keys this way would be unsafe.
2. **Unauthenticated backend**: there are no customer/session ownership checks. A generic server-side paid-model proxy would be an abuse/billing endpoint without authentication, rate limits and quotas.
3. **Current costs are inflated by repeat attempts**: Gemini image analysis currently launches four parallel model calls; Qwen retrieval launches two responses plus up to three visual re-verifications. Do not silently remove this behavior until matched recall-vs-cost experiments show the effect.
4. **Model identity is not audit-ready**: choice is held by client localStorage rather than recorded with server-side inference policy, version, region, success/error, latency, tokens and cost.

## Migration plan (no user disruption)

- Phase A (this PR): shortlist + bakeoff specification; preserve existing provider selection and behavior.
- Phase B: add an **authenticated** backend model gateway with server-only secrets, per-workspace policy, quotas, request-size bounds, explicit model identifiers and privacy notices; keep the existing AI result schema so the UI stays compatible.
- Phase C: run the bakeoff in a non-production environment with consented/anonymized inputs, choose default *per region/task*, retain an opt-out and disable automatic failover across jurisdictions unless user/organization has agreed.
- Phase D: A/B deploy gradually, monitor cost and search failures, keep rollback to the prior provider.

**Recommendation:** provisionally trial Qwen3.8 Flash first for both capture and Chinese-language search; hold Gemini 3.8 Flash as challenger, plus Qwen3-VL-Plus for small-object/bounding-box accuracy. **No provider winner, credentials, production switchover or latency/accuracy claims yet.**
