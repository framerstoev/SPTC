# Phase 4E-B local integration

Integration branch in both repositories: `feature/v3-gemma-planning-left-integration`.
Frontend application checkpoint: `e9b1e9cf14ccde0a03534f8cce70a38853403d2f`.
Backend integration: `61726c9890526a5dd79a79ab3ed40c83a3ae9bb3`.

The previously stashed four-file Planning-left change was inspected and applied
without dropping its stash. Desktop Planning / Potential is physically left;
Observed / Tier 3 is right and exclusively owns Q(t). Mobile retains explicit
Planning/Observed tabs. Shared selection, map synchronization, tier switching,
splitters and hide/show behavior remain intact. Visible wording is simplified;
analytical values and formulas are not modified.

Initial layout QA: 116 checks across 1920x1080, 1440x900, 1366x768, 1024x768,
768x900 and 390x844. Zero console errors, uncaught exceptions, automatic Assistant
requests or direct browser port-11434 requests. Frontend JavaScript suites:
122 checks; 12 local resources. Live model acceptance is a separate gate.

## Model and launch

See [development launcher instructions](../../local-demo/README-V3-DEV.md).
The development profile selects `gemma4:12b` and reports partial GPU offload
honestly. Normal UI still says AI Assistant. It does not change the accepted
Qwen launcher or its original tag/checkpoint requirements.

Backend-only changes clarify model instructions, narrow offered decline reasons
to the existing host-valid set, and keep raw history out of Gemma routing while
retaining host-resolved follow-up context. All numerical evidence and warnings
remain deterministic. No new tools, permissive parser, retries or validator
relaxation. The backend's `docs/PHASE4EB_GEMMA_INTEGRATION.md` records diagnosis
and eventual A30 configuration considerations.

Acceptance requires full real-model results, at least 90% compatibility, exact
evidence/safety, and live six-viewport browser/launcher lifecycle validation.
Do not infer acceptance from the existence of this development branch.

## Preserved rollback and deployment

- Frontend Qwen tag: `phase4c1-v3-plain-language-ai-accepted`
  (`345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b`).
- Backend Qwen tag: `phase4c1-plain-language-ai-accepted`
  (`e6b0ad5600e1d0056cd927ba9034bda6243b6030`).
- Both installed models are retained. No old tags moved.
- V1/V2 runtime, research data, Q(t), Candidate B and deterministic statistics
  are outside this change. Public Pages and Jinyu's shipped ZIP/images are not
  updated. No INRIX/User Cost implementation.
- Screenshots of the comparative workspace need refresh because panel order and
  a few descriptive labels changed. QA screenshots remain local artifacts, not
  runtime assets or a poster/video deliverable.
