# Cold-Wave Demo Deployment Notes

## Detected Repository Structure

- `E:\Projects\PhD\SPTC` contains project data and scripts, but `git status` from that directory reports that it is not a valid Git working tree.
- The valid Git repository for the existing GitHub Pages demo is:
  `E:\Projects\PhD\SPTC\data\front-end\sptc-demo`
- That repository is on branch `main` and has remote:
  `https://github.com/framerstoev/SPTC.git`
- The repository root contains:
  - `.nojekyll`
  - `index.html`
  - `event_rei_texas_demo.geojson`
  - `event_rei_top100.csv`
- No `docs/` folder or `.github/workflows/` deployment workflow was detected.
- No local `gh-pages` branch was detected.

## Recommended Deployment Path

Keep the existing root `index.html` untouched and deploy this dashboard as a subfolder inside the valid Pages repository:

```text
E:\Projects\PhD\SPTC\data\front-end\sptc-demo\coldwave-demo\
```

This preserves the existing online homepage and adds the new dashboard at a subpath.

## Expected Online URL

After committing and pushing the `coldwave-demo/` subfolder to the `main` branch of `framerstoev/SPTC`, the expected GitHub Pages URL is:

```text
https://framerstoev.github.io/SPTC/coldwave-demo/
```

## Local Preview

Run a local server from the valid Pages repository root:

```powershell
cd E:\Projects\PhD\SPTC\data\front-end\sptc-demo
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/coldwave-demo/
```
