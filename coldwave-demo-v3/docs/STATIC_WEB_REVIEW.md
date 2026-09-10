# V3 static web review

## Publication decision

Confirmed 2026-09-09 through the user's instruction: Jason / project leadership
reviewed and approved public/browser-accessible interactive review of the accepted
V3 derived frontend assets. Source: `phase4c1-v3-plain-language-ai-accepted`,
`345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b`.

This is project-level approval, not a separate third-party license grant or legal
opinion. Existing governance notes do not explicitly name an additional external
approving authority; their licensing and attribution obligations remain. Approval
covers the accepted map and derived curves, not raw source datasets. There are
3,848 JSON files, of which 3,842 are curves, plus one GeoJSON. The verified origin
`https://github.com/framerstoev/SPTC.git` is the authorized publication target.

## Runtime separation

The Pages builder uses an explicit immutable profile: `mode=static-review`,
`assistantEnabled=false`, `backendEnabled=false`. It removes Assistant/ranking
markup and omits every Assistant/client script from the artifact. Only the two
Assistant initialization calls in the copied app are gated by this profile;
analytical source and values are unchanged. URL parameters cannot enable AI.

The local full-AI application and its deployment configuration are byte-for-byte
unchanged. Its accepted branch and launcher remain separate from publication.
There is no FastAPI, Ollama, model, GPU, credential or backend URL in the V3 artifact.

Retained: shared search/selection, both synchronized Canvas maps, Tier 1, Tier 2,
Potential, observed Tier 3, metrics, Q(t), legends, splitters, hide/show and mobile
layout. Ranking option B is used: backend ranking is omitted because rounded
frontend values cannot guarantee full-precision backend tie/ordering parity.
County benchmarking, narratives and other AI-only actions are intentionally absent.

## Deployment

The controlled branch is `feature/v3-static-github-review`. Only pushes to that
branch (or its manual workflow) deploy. Official configure/upload/deploy-pages
actions publish a clean artifact; no generated data copy is committed. The builder
also preserves the pre-existing public root and V1/V2 assets byte-for-byte from
`f79d31a8a279dd5a7fac805fc1fda32a482910f2`, rather than publishing local V2 changes.
This compatibility portion prevents an Actions deployment from removing old URLs.

Public review URL: **https://framerstoev.github.io/SPTC/coldwave-demo-v3/**

This URL was obtained from GitHub's Pages configuration and the deployed V3 entry,
then verified in a real browser. Initial validated deployment source:
`9c0575e0cdd8f6cdf73b22e93fed9b927b82934c`, successful Actions run
https://github.com/framerstoev/SPTC/actions/runs/34435875287 . Subsequent documentation
publication preserves runtime bytes except the deployment commit in metadata.
The exact currently served deployment commit is available from the public
`release.json`; the final accepted local tag is
`phase4d-v3-static-web-review-accepted`, created only after public validation.
`release.json` records source commit/tag, deployment commit and disabled AI state.

Build locally with Python (standard library only):

```powershell
python coldwave-demo-v3/tests/build_static_review.py --output <new-empty-directory>
python -m http.server 8002 --bind 127.0.0.1 --directory <artifact-parent>
```

Use an artifact directory named `SPTC` to test `/SPTC/coldwave-demo-v3/`, then
serve that directory directly to test `/coldwave-demo-v3/`. Both must work.
Never serve the repository directory as the public artifact. Tests, launchers,
diagnostics, local paths, credentials and caches are excluded.

The V3 source inventory is 3,849 data files / 137,767,781 bytes. Browser delivery
includes only 3,842 curves, the map and summary (3,844 data files); four QA JSONs
and the unused curve index remain in source, not in the new V3 public artifact.
Local full-AI regression passed 113 browser checks, including a real Qwen concept
answer (1.745s), then safe stop/unload. Existing frontend tests passed 122 checks
and 12 local resources; original V3/V2 launcher suites passed 134/92 respectively.
The initial static artifact passed 153 real-browser checks across root/nested
paths and six viewports. The final runtime-only artifact also passed all 153
checks before push. The REAL public URL passed 79 checks across all six viewports:
1920x1080, 1440x900, 1366x768, 1024x768, 768x900 and 390x844. Search, representative
section statuses, metrics, Q(t), map synchronization, tiers, legends, splitters,
hide/show and responsive layout passed. No AI DOM or client is delivered, even
with attempted backend query overrides. FastAPI, Assistant, localhost:8080,
Ollama/11434, WebSocket and unexpected API requests were all zero; console errors
and HTTP errors were zero. Existing V1 and V2 public URLs both returned HTTP 200.

## Publication audit and operational boundaries

| Item | Verified result |
| --- | --- |
| Original source branch | `feature/v3-plain-language-ai` |
| Static branch pushed | `feature/v3-static-github-review` only |
| Origin | `https://github.com/framerstoev/SPTC.git`, unchanged |
| Project approval | Jason/project leadership confirmation, 2026-09-09; project-level only |
| Named additional external approval in repository notes | None explicitly required; no third-party license grant claimed |
| Accepted source data inventory | 3,849 files / 137,767,781 bytes |
| Published V3 data | 3,844 files / 137,602,131 bytes, unchanged accepted values |
| V3 runtime artifact | 3,850 files; no tests, diagnostics, backend or AI client |
| Legacy compatibility runtime | 7,704 existing files copied from the immutable public baseline |
| Complete Pages artifact | 11,554 files / 404,333,200 bytes (385.602 MiB) |
| Largest V3 data file | Map GeoJSON, 21,044,231 bytes |
| Largest complete artifact file | `event_rei_texas_demo.geojson`, 36,676,542 bytes, existing legacy asset |
| New reachable Git blobs before initial push | 254 / 6,708,728 uncompressed bytes; largest 103,560 bytes |
| Source-history secret scan | Passed; no newly uploaded raw data copy |
| Artifact secret/private-path scan | Passed |
| V3 backend endpoint scan | Passed |
| Focused static tests | 12 passed |
| Existing frontend tests / resources | 122 / 12 passed |
| Original V3 / V2 launcher regressions | 134 / 92 passed |
| Local full-AI browser regression | 113 passed; one real concept call, no unsolicited requests |
| Local Qwen runtime | RTX 4060, Code 0, NVIDIA 616.56, 100% GPU; 6,017 MiB total VRAM used |
| Local launcher startup | Warm-up 5.825s, backend 5.302s, frontend 1.158s, total 20.055s |
| Local cleanup | Owned services stopped, model unloaded, 8001/8080 free; external Ollama retained |

The only deployment changes are this document, the static profile, the builder,
source audit and two test scripts, and `.github/workflows/v3-static-pages.yml`.
V1/V2, accepted V3 runtime source, local launcher and backend are unchanged.
Backend remains `e6b0ad5600e1d0056cd927ba9034bda6243b6030`. There was no recalculation
or modification of formulas, data, Candidate B, Q(t), metrics or thresholds.

Pages was switched from legacy main/root publication to official Actions. Its
environment retains the existing `main` branch rule and additionally allows only
the dedicated static branch. No merge to main, force push, backend push, unrelated
branch push or tag push occurred. The build uses official checkout/configure/
upload/deploy actions and only read access in its build job. Deployment has Pages
and OIDC write access. The original site routes are not redirected or replaced.

The completed site is suitable for sending to Jason as a static review URL; it
requires no Python, backend, model or GPU installation. Backend security/hosting,
K3s, model deployment and further product development remain outside this phase.

## Return to the accepted full local AI version

The deployment branch intentionally contains extra publication files and does not
repoint or loosen the full-AI launcher's checkpoint policy. With a clean worktree,
switch to the original accepted branch before using that unchanged launcher:

```powershell
git switch feature/v3-plain-language-ai
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\local-demo\start-local-chatbot-demo-v3.ps1
```

Stop with `local-demo/stop-local-chatbot-demo-v3.ps1`, then switch back to the
dedicated static branch only for reviewed publication work. Public users simply
open the URL above; these local commands are not needed by reviewers.

Official publication references: [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
and [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

Redeploy only reviewed, tested changes on the dedicated branch. The workflow runs
builder invariants before uploading. Existing accepted tags and main are not moved.
No backend or K3s deployment belongs to this workflow.
