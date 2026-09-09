"""Run Phase 4C no-build QA while preserving the accepted Phase 4B workspace."""

from __future__ import annotations

import argparse
import functools
import hashlib
import http.server
import json
import os
import shutil
import subprocess
import tempfile
import threading
import urllib.request
from html.parser import HTMLParser
from pathlib import Path


V3_ROOT = Path(__file__).resolve().parents[1]
V2_ROOT = V3_ROOT.parent / "coldwave-demo-v2"
REPOSITORY_ROOT = V3_ROOT.parent
EXPECTED_LAYERS = ("tier1", "tier2", "potential")
REPRESENTATIVE_SECTIONS = ("CS_1081", "CS_257", "CS_3597", "CS_1", "CS_583693")


class DashboardParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.local_resources: list[str] = []
        self.tier_buttons: list[dict[str, str | None]] = []
        self.tier_options: list[dict[str, str | None]] = []
        self.suggestions: list[str] = []
        self.quick_action_details: list[dict[str, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.append(str(values["id"]))
        for name in ("href", "src"):
            value = values.get(name)
            if value and not value.startswith(("http://", "https://", "#", "data:")):
                self.local_resources.append(value)
        if tag == "button" and values.get("data-analysis-layer"):
            self.tier_buttons.append(values)
        if tag == "option" and values.get("value") in EXPECTED_LAYERS:
            self.tier_options.append(values)
        if tag == "button" and values.get("data-assistant-question"):
            self.suggestions.append(str(values["data-assistant-question"]))
        if tag == "details" and "assistant-quick-actions" in (values.get("class") or ""):
            self.quick_action_details.append(values)


def read(relative_path: str) -> str:
    return (V3_ROOT / relative_path).read_text(encoding="utf-8")


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def assert_data_copy() -> dict[str, int]:
    v2_files = {
        path.relative_to(V2_ROOT / "data"): path.stat().st_size
        for path in (V2_ROOT / "data").rglob("*")
        if path.is_file()
    }
    v3_files = {
        path.relative_to(V3_ROOT / "data"): path.stat().st_size
        for path in (V3_ROOT / "data").rglob("*")
        if path.is_file()
    }
    assert v3_files == v2_files, "V3 data copy differs from the accepted V2 data manifest"
    for relative_path in (
        Path("summary.json"),
        Path("data_driven_resilience_map_v0.geojson"),
        *(Path("curves") / f"{section}.json" for section in REPRESENTATIVE_SECTIONS if section != "CS_1"),
    ):
        assert digest(V3_ROOT / "data" / relative_path) == digest(V2_ROOT / "data" / relative_path)
    return {"data_files": len(v3_files), "curve_files": len(list((V3_ROOT / "data" / "curves").glob("*.json")))}


def assert_release_fields() -> dict[str, int]:
    summary = json.loads(read("data/summary.json"))
    geojson = json.loads(read("data/data_driven_resilience_map_v0.geojson"))
    features = geojson["features"]
    assert len(features) == summary["total_control_sections"] == 10029
    by_id = {feature["properties"]["CTRL_SECT_KEY"]: feature["properties"] for feature in features}
    for section_id in REPRESENTATIVE_SECTIONS:
        assert section_id in by_id
    assert by_id["CS_1081"]["detection_status"] == "detected"
    assert by_id["CS_257"]["detection_status"] == "no_sustained_drop"
    assert by_id["CS_3597"]["detection_status"] == "recovery_endpoint_censored"
    assert by_id["CS_1"]["detection_status"] == "no_observed_support"
    for feature in features:
        properties = feature["properties"]
        for field in (
            "WEATHER_REI",
            "NETRISK_LITE",
            "Potential_Resilience_Score",
            "observed_curve_resilience_score_v0",
        ):
            assert field in properties
    dallas_count = sum(
        1
        for feature in features
        if str(feature["properties"].get("county_name", "")).casefold() == "dallas"
    )
    assert dallas_count == 58
    return {"features": len(features), "dallas_sections": dallas_count}


def assert_repository_scope() -> dict[str, object]:
    branch = subprocess.run(
        ["git", "branch", "--show-current"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout.strip()
    assert branch == "feature/v3-assistant-analysis-depth", branch
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout.splitlines()
    unexpected = [line for line in status if "coldwave-demo-v3/" not in line.replace("\\", "/")]
    launcher_paths = {"local-demo/lib/LocalDemo.V3.ps1", "local-demo/lib/LocalDemo.Core.psm1", "local-demo/tests/run-local-demo-v3-tests.ps1", "local-demo/README-V3.md"}
    tracked_outside_v3 = [line for line in unexpected if line != "?? debug.log" and line[3:] not in launcher_paths]
    assert not tracked_outside_v3, f"Tracked changes outside V3: {tracked_outside_v3[:10]}"
    v2_diff = subprocess.run(
        ["git", "diff", "--quiet", "4e542843d25afc7fcf5329217181f33900034b99", "--", "coldwave-demo", "coldwave-demo-v2", "coldwave-demo-v3/data"],
        cwd=REPOSITORY_ROOT,
        check=False,
    )
    assert v2_diff.returncode == 0, "Accepted V2 tracked files changed"
    # Only the explicit V3 constants block may differ in the shared module.
    import re
    old_core = subprocess.run(
        ["git", "show", "88d040740c424543d0144daec75d767e913ededf:local-demo/lib/LocalDemo.Core.psm1"],
        cwd=REPOSITORY_ROOT, capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout
    core = (REPOSITORY_ROOT / "local-demo/lib/LocalDemo.Core.psm1").read_text(encoding="utf-8")
    pattern = r'if \(\$LauncherProfile -eq "v3"\) \{.*?\n\}'
    assert re.sub(pattern, "V3_CONSTANTS", core, count=1, flags=re.S) == re.sub(
        pattern, "V3_CONSTANTS", old_core, count=1, flags=re.S
    ), "Shared launcher behavior outside V3 constants changed"
    return {
        "branch": branch,
        "untracked_outside_v3": [line[3:] for line in unexpected],
    }


def static_checks() -> dict[str, object]:
    required_files = (
        "index.html",
        "css/style.css",
        "js/deployment-config.js",
        "js/assistant-config.js",
        "js/assistant-api.js",
        "js/assistant-actions.js",
        "js/assistant-chat.js",
        "js/workspace.js",
        "js/app.js",
        "README.md",
        "docs/DEPLOYMENT_READINESS.md",
    )
    for relative_path in required_files:
        assert (V3_ROOT / relative_path).is_file(), relative_path

    index = read("index.html")
    app = read("js/app.js")
    api = read("js/assistant-api.js")
    actions = read("js/assistant-actions.js")
    chat = read("js/assistant-chat.js")
    config = read("js/assistant-config.js")
    deployment = read("js/deployment-config.js")
    style = read("css/style.css")

    parser = DashboardParser()
    parser.feed(index)
    assert len(parser.ids) == len(set(parser.ids)), "Duplicate DOM IDs"
    assert tuple(item["data-analysis-layer"] for item in parser.tier_buttons) == EXPECTED_LAYERS
    assert sum(item.get("aria-checked") == "true" for item in parser.tier_buttons) == 1
    assert next(
        item for item in parser.tier_buttons if item.get("aria-checked") == "true"
    )["data-analysis-layer"] == "potential"
    assert tuple(item.get("tabindex") for item in parser.tier_buttons) == ("-1", "-1", "0")
    assert all("active" not in (item.get("class") or "").split() for item in parser.tier_buttons)
    assert tuple(item["value"] for item in parser.tier_options) == EXPECTED_LAYERS
    assert sum("selected" in item for item in parser.tier_options) == 1
    assert next(item for item in parser.tier_options if "selected" in item)["value"] == "potential"
    assert len(parser.suggestions) == 3
    assert parser.suggestions == [
        "Rank control sections by Tier 3 observed resilience.",
        "Compare Potential and Observed Resilience for this selected section.",
        "How did roadway sections in Dallas County perform during this event?",
    ]
    assert len(parser.quick_action_details) == 1
    assert "open" not in parser.quick_action_details[0]
    for old_id in (
        "layerSelect",
        "analysisSplitter",
        "curveDetails",
        "supportingMetricsDetails",
        "assistantMoreSuggestions",
    ):
        assert old_id not in parser.ids
    for forbidden_visible_text in ("NETRISK_LITE", "NETRISK Lite", "EVENT_REI", "Event REI", "Score v0"):
        assert forbidden_visible_text not in index

    script_order = (
        "./js/deployment-config.js",
        "./js/assistant-config.js",
        "./js/assistant-api.js",
        "./js/assistant-actions.js",
        "./js/assistant-chat.js",
        "./js/assistant-window.js",
        "./js/ranking-browser.js",
        "./js/workspace.js",
        "./js/app.js",
    )
    positions = [index.index(path) for path in script_order]
    assert positions == sorted(positions)
    for local_resource in parser.local_resources:
        assert (V3_ROOT / local_resource).resolve().is_file(), local_resource

    assert 'let activeAnalysisLayer = "potential"' in app
    assert all(f"  {layer}: Object.freeze({{" in app for layer in EXPECTED_LAYERS)
    assert 'sourceField: "WEATHER_REI"' in app
    assert 'sourceField: "NETRISK_LITE"' in app
    assert 'sourceField: "Potential_Resilience_Score"' in app
    assert 'sourceField: "observed_curve_resilience_score_v0"' in app
    assert "setupAnalysisSplitter" not in app
    assert "syncTierControlState" in app
    assert 'classList.toggle("is-active"' not in app
    assert "Observed class:" not in app
    for label in ('metricCard("Score"', 'metricCard("Minimum"', 'metricCard("Loss Area"', 'metricCard("Recovery"'):
        assert app.count(label) == 1
    assert 'if (activeAnalysisLayer === "tier3")' not in app
    assert "await renderCurve(selectedProps)" in app

    assert 'assistant_profile: "v3"' in api
    assert '"active_analysis_layer"' in api
    assert all(result_type in api and result_type in chat for result_type in (
        "section_ranking",
        "county_resilience_summary",
        "tier_alignment_summary",
    ))
    assert "row.warning_codes" not in api
    assert "row.warning_codes" not in chat
    assert "record.metric_name)" not in chat
    assert "result.source_metric" not in chat
    assert "safeDisplayText" in actions and "safeDisplayText" in chat
    assert "innerHTML" not in actions and "innerHTML" not in chat
    assert "result.common_support_count" in chat
    assert "result.status_counts.no_sustained_drop" in chat
    assert "result.status_counts.recovery_endpoint_censored" in chat
    assert "result.direction" in chat and "row.metric_rank" in chat

    assert 'backend_target: "local-loopback"' in deployment
    assert 'localLoopback: "local-loopback"' in config
    assert 'sameOrigin: "same-origin"' in config
    assert config.count("http://127.0.0.1:8080") == 1
    assert 'pageUrl.protocol === "https:"' in config
    assert "credentials: \"omit\"" in api
    assert "Authorization" not in api
    assert "localStorage" not in config and "sessionStorage" not in config
    for dom_id in ("planningMap", "workspaceSplitter", "observedSplitter", "planningSplitter", "toggleObserved", "togglePlanning", "observedSideContent", "planningSideContent"):
        assert dom_id in parser.ids
    for absent in ("warningCard", "tierFootnote", "layerNote", "activeTierChip"):
        assert absent not in parser.ids
    assert "--maroon: #500000" in style
    assert "max-width: 900px" in style
    assert "minmax(0,1fr)" in style
    assert "innerHTML" not in read("js/workspace.js")
    assert "fetch(" not in read("js/workspace.js")
    frozen_workspace = subprocess.run(
        ["git", "show", "88d040740c424543d0144daec75d767e913ededf:coldwave-demo-v3/js/workspace.js"],
        cwd=REPOSITORY_ROOT, capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout
    assert read("js/workspace.js") == frozen_workspace, "Phase 4B workspace changed"
    for path in ("js/assistant-window.js", "js/ranking-browser.js"):
        assert "queryAssistant" not in read(path)
        assert "innerHTML" not in read(path)
    baseline_app = subprocess.run(
        ["git","show","4e542843d25afc7fcf5329217181f33900034b99:coldwave-demo-v3/js/app.js"],
        cwd=REPOSITORY_ROOT, capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout
    # Exact source preservation of reviewed class/range, numeric helpers and overlay math.
    for function in ("numberOrNull", "percentile", "computeScoreClassBreaks", "scoreClassIndex", "scoreClassInfo", "computeRanges", "rampColor", "nearestIndex"):
        marker = "function " + function + "("
        current_body = app[app.index(marker):].split("\nfunction ",1)[0]
        old_body = baseline_app[baseline_app.index(marker):].split("\nfunction ",1)[0]
        assert current_body == old_body, function + " changed unexpectedly"
    start = "const phaseOverlayPlugin = {"
    end = "Chart.register(phaseOverlayPlugin);"
    assert app.split(start)[1].split(end)[0] == baseline_app.split(start)[1].split(end)[0]

    data_results = assert_data_copy()
    release_results = assert_release_fields()
    return {
        "dom_ids": len(parser.ids),
        "tier_modes": len(parser.tier_buttons),
        "suggestions": len(parser.suggestions),
        **data_results,
        **release_results,
    }


def find_javascript_runtime() -> tuple[Path, dict[str, str]] | None:
    node = shutil.which("node")
    if node:
        return Path(node), {}
    code_command = shutil.which("code.cmd") or shutil.which("code")
    if not code_command:
        return None
    electron = Path(code_command).resolve().parent.parent / "Code.exe"
    return (electron, {"ELECTRON_RUN_AS_NODE": "1"}) if electron.is_file() else None


def run_javascript_tests() -> list[str]:
    runtime = find_javascript_runtime()
    if runtime is None:
        raise RuntimeError("Node or VS Code Electron is required for JavaScript QA")
    executable, environment_updates = runtime
    environment = os.environ.copy()
    environment.update(environment_updates)
    outputs: list[str] = []
    runtime_directory = tempfile.gettempdir()
    for driver_name in (
        "run_assistant_client_qa.js",
        "run_assistant_actions_qa.js",
        "run_assistant_chat_qa.js",
        "run_search_rendering_qa.js",
        "run_tier_rendering_qa.js",
        "run_analytical_ui_qa.js",
    ):
        completed = subprocess.run(
            [str(executable), str(V3_ROOT / "tests" / driver_name)],
            cwd=runtime_directory,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if completed.returncode != 0:
            raise RuntimeError(
                f"{driver_name} failed:\n{completed.stdout}\n{completed.stderr}"
            )
        outputs.extend(line for line in completed.stdout.splitlines() if line.strip())
    return outputs


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        del format, args


def live_resource_check() -> list[str]:
    handler = functools.partial(QuietHandler, directory=str(REPOSITORY_ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}/coldwave-demo-v3"
    paths = (
        "/",
        "/css/style.css",
        "/js/deployment-config.js",
        "/js/assistant-config.js",
        "/js/assistant-api.js",
        "/js/assistant-actions.js",
        "/js/assistant-chat.js",
        "/js/workspace.js",
        "/js/app.js",
        "/data/summary.json",
        "/data/curves/CS_1081.json",
    )
    checked: list[str] = []
    try:
        for path in paths:
            with urllib.request.urlopen(f"{base}{path}", timeout=10) as response:
                assert response.status == 200
                assert response.read(256)
            checked.append(path)
        request = urllib.request.Request(
            f"{base}/data/data_driven_resilience_map_v0.geojson",
            method="HEAD",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            assert response.status == 200
            assert int(response.headers["Content-Length"]) > 0
        checked.append("/data/data_driven_resilience_map_v0.geojson [HEAD]")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    return checked


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-javascript", action="store_true")
    parser.add_argument("--live", action="store_true", help="Run a temporary loopback resource check")
    args = parser.parse_args()

    repository = assert_repository_scope()
    result = static_checks()
    print(
        f"V3 static QA passed on {repository['branch']}: "
        f"{json.dumps(result, sort_keys=True)}"
    )
    if repository["untracked_outside_v3"]:
        print(
            "Preserved unrelated untracked paths outside V3: "
            f"{json.dumps(repository['untracked_outside_v3'])}"
        )
    if not args.skip_javascript:
        for output in run_javascript_tests():
            print(output)
    if args.live:
        checked = live_resource_check()
        print(f"V3 live resource QA passed: {len(checked)} resources")


if __name__ == "__main__":
    main()
