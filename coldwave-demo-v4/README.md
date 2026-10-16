# SPTC Roadway Resilience Explorer V4

Standalone static design-review frontend: Explore, Compare, and Methods & Data.
It requires no Assistant, model, backend, package manager or compilation step.
V3 and all accepted analytical methods remain separate.

## Start the existing local preview

From the SPTC project root, using an available Python 3.10+ interpreter:

```powershell
python -m http.server 8004 --bind 127.0.0.1 --directory data/front-end
```

Open the local research preview:

<http://127.0.0.1:8004/sptc-demo/coldwave-demo-v4/?mode=LOCAL_RESEARCH_PREVIEW>

Without the mode query, the page opens the code-only public showcase. A simple
static server is sufficient; do not use file URLs or the Gemma launcher.
All application paths are relative and work beneath a project subdirectory.
OpenStreetMap basemap tiles need internet access; UI libraries are vendored.

## Prepare data on a new authorized local checkout

The current project already has its local preview. Do not regenerate it merely
to start the application. On a new checkout with the reviewed source products:

```powershell
python data/front-end/sptc-demo/coldwave-demo-v4/tools/prepare_local_preview.py --project-root .
```

This writes only V4's ignored `.local-preview/`, refuses an existing target,
and reads the frozen January run, existing geometry/curves and temperature
section products. It does not execute analytical pipelines or alter inputs.
The package retains `REVIEW_READY / NOT_APPROVED` and is available only through
an explicit loopback preview request. A missing package shows an unavailable
state. A checkout containing only this feature branch has no research data.

## Public distribution

```powershell
python data/front-end/sptc-demo/coldwave-demo-v4/tools/build_public.py --output data/front-end/sptc-demo/coldwave-demo-v4/.public-build
```

The builder requires a fresh destination and copies an explicit runtime
allowlist. The result contains 21 files and zero analytical data files. Its
manifest forces `PUBLIC_SHOWCASE`, even if a local-preview query is supplied.
Research values, geometry, curves, temperature products, economic packages,
ledgers and raw probe records are absent. Empty public data is intentional:
data redistribution approval is still required. Do not deploy the research
source directory or its ignored preview folder as a public artifact.

No hosting or deployment configuration is changed by this frontend branch.

## Focused verification

```powershell
node data/front-end/sptc-demo/coldwave-demo-v4/tests/run_core_tests.js
python data/front-end/sptc-demo/coldwave-demo-v4/tests/verify_data_boundary.py --project-root . --public-dir data/front-end/sptc-demo/coldwave-demo-v4/.public-build
python data/front-end/sptc-demo/coldwave-demo-v4/tests/browser_qa.py --url 'http://127.0.0.1:8004/sptc-demo/coldwave-demo-v4/?mode=LOCAL_RESEARCH_PREVIEW' --public-url 'http://127.0.0.1:8004/sptc-demo/coldwave-demo-v4/.public-build/' --output-dir .local/v4-audit/browser
```

The core test needs a JavaScript runtime; the application does not. The browser
test uses installed Chrome and Python with `websocket-client`, writes private local
screenshots/reports, and closes only its own browser. Fidelity tests require
authorized local source data. Keep screenshots containing review-only results
outside the public repository.

See [architecture](docs/ARCHITECTURE.md), [reference audit](docs/REFERENCE_DESIGN_AUDIT.md)
and [design acceptance](docs/DESIGN_ACCEPTANCE.md).
