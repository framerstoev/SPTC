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

Public URL and final validation: pending actual GitHub deployment, not inferred.
The V3 entry is `coldwave-demo-v3/` beneath the Pages URL returned by GitHub.
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

Redeploy only reviewed, tested changes on the dedicated branch. The workflow runs
builder invariants before uploading. Existing accepted tags and main are not moved.
No backend or K3s deployment belongs to this workflow.
