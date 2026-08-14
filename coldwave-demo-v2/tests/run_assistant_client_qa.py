"""Run no-build Phase 3J static, client, action, chat, search, and resource QA."""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
V2_ROOT = REPOSITORY_ROOT / "coldwave-demo-v2"
CHROME_CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        del format, args


def static_checks() -> None:
    index = (V2_ROOT / "index.html").read_text(encoding="utf-8")
    config = (V2_ROOT / "js" / "assistant-config.js").read_text(encoding="utf-8")
    api = (V2_ROOT / "js" / "assistant-api.js").read_text(encoding="utf-8")
    actions = (V2_ROOT / "js" / "assistant-actions.js").read_text(encoding="utf-8")
    chat = (V2_ROOT / "js" / "assistant-chat.js").read_text(encoding="utf-8")
    app = (V2_ROOT / "js" / "app.js").read_text(encoding="utf-8")
    style = (V2_ROOT / "css" / "style.css").read_text(encoding="utf-8")
    script_order = (
        "./js/assistant-config.js",
        "./js/assistant-api.js",
        "./js/assistant-actions.js",
        "./js/assistant-chat.js",
        "./js/app.js",
    )
    positions = [index.index(script) for script in script_order]
    assert positions == sorted(positions)
    assert all(index.count(script) == 1 for script in script_order)
    for relative_path in (
        "index.html",
        "css/style.css",
        "js/assistant-config.js",
        "js/assistant-api.js",
        "js/assistant-actions.js",
        "js/assistant-chat.js",
        "js/app.js",
        "data/summary.json",
        "tests/run_assistant_client_qa.js",
        "tests/run_assistant_client_live_qa.js",
        "tests/assistant-actions-tests.js",
        "tests/run_assistant_actions_qa.js",
        "tests/run_assistant_actions_live_qa.js",
        "tests/assistant-chat-tests.js",
        "tests/run_assistant_chat_qa.js",
        "tests/search-rendering-tests.js",
        "tests/run_search_rendering_qa.js",
        "tests/run_phase2a4_browser_qa.py",
        "tests/run_phase3g_browser_qa.py",
    ):
        assert (V2_ROOT / relative_path).is_file(), relative_path

    assert config.count("http://127.0.0.1:8080") == 1
    assert "backendToolsTimeoutMs = 8000" in config
    assert "backendAgentTimeoutMs = 80000" in config
    assert "fetch(" not in config
    assert all(
        token not in config
        for token in ("localStorage", "sessionStorage", "window.name")
    )
    assert all(
        token not in api
        for token in (
            "/health",
            "/compare",
            "/filter",
            "/rank",
            "/curve",
            "Authorization",
            "api_key",
            "API_KEY",
        )
    )
    assert api.count("/api/v1/assistant/query") == 1
    assert api.count("/api/v1/sections/") == 1
    assert api.count("/api/v1/metrics/") == 1
    assert api.count("/api/v1/reports/review-note") == 1
    assert api.count('credentials: "omit"') == 1
    assert api.count("global.fetch(url, requestOptions)") == 1
    assert "requestReviewedJson" in api
    assert "requestReviewedJson," not in api
    assert all(
        token not in actions
        for token in (
            "innerHTML",
            "outerHTML",
            "insertAdjacentHTML",
            "DOMParser",
            "fetch(",
            "/api/v1/",
            "localStorage",
            "sessionStorage",
            "Authorization",
        )
    )
    assert "queryAssistant" not in actions
    assert all(
        method in actions
        for method in (
            "getSectionSummary",
            "explainMetric",
            "generateSectionReviewNote",
        )
    )
    assert all(
        token not in chat
        for token in (
            "innerHTML",
            "outerHTML",
            "insertAdjacentHTML",
            "DOMParser",
            "fetch(",
            "/api/v1/",
            "localStorage",
            "sessionStorage",
            "Authorization",
        )
    )
    assert "queryAssistant" in chat
    assert all(
        method not in chat
        for method in (
            "getSectionSummary",
            "explainMetric",
            "generateSectionReviewNote",
        )
    )
    assert all(
        token not in index + config + api + chat
        for token in (
            r"E:\\Projects",
            r"C:\\Users",
            "data/tier3",
            "services/resilience-agent",
            "NPMRDS/",
            "Bearer ",
        )
    )
    assert "SPTCAssistant.client" not in app
    assert "/api/v1/" not in app
    assert "ASSISTANT_API_URL" not in app
    assert "11434" not in index + config + api + actions + chat + app
    normal_ui_sources = index + actions + chat + app
    assert all(
        token not in normal_ui_sources
        for token in ("Qwen", "Ollama", "FastAPI", "qwen3:8b", "GPU")
    )
    assert all(
        phrase not in normal_ui_sources
        for phrase in (
            "Local Qwen explains",
            "Local Qwen + backend tools",
            "Local Qwen response ready",
            "First response",
            "Three fixed reviewed actions",
            "Deterministic fixed actions ready",
            "The three fixed actions above",
        )
    )
    assert "Verified result" in actions
    assert "AI-assisted response" in chat
    setup_start = app.index("function setupAssistant()")
    setup_end = app.index("\nfunction ", setup_start + 1)
    setup_assistant = app[setup_start:setup_end]
    assert "button[data-question]" not in setup_assistant
    assert "send.addEventListener" not in setup_assistant
    assert "input.addEventListener" not in setup_assistant
    assert "startAction(" not in setup_assistant
    assert "submitQuestion(" not in setup_assistant
    assert "resetTimelineOnContextChange: false" in setup_assistant
    assert "showContextResetNotice: false" in setup_assistant
    selection_start = app.index("async function selectFeature(")
    selection_end = app.index("\nfunction ", selection_start + 1)
    assert (
        "resetAssistantForSelection(selectedProps)"
        in app[selection_start:selection_end]
    )
    layer_start = app.index('document.getElementById("layerSelect").addEventListener')
    layer_end = app.index("\n});", layer_start) + 4
    assert "resetAssistantForSelection(selectedProps)" in app[layer_start:layer_end]
    assert index.count("data-assistant-action=") == 3
    assert "data-question=" not in index
    assert index.count("data-assistant-question=") == 8
    primary_start = index.index(
        '<div class="assistant-suggestion-grid assistant-suggestion-primary"'
    )
    primary_end = index.index("</div>", primary_start)
    primary_suggestions = index[primary_start:primary_end]
    assert primary_suggestions.count("data-assistant-question=") == 3
    assert all(
        label in primary_suggestions
        for label in (
            "What happened here?",
            "Explain this warning.",
            "Planning vs. observed evidence?",
        )
    )
    more_start = index.index('<details class="assistant-more-suggestions">')
    more_end = index.index("</details>", more_start)
    more_suggestions = index[more_start:more_end]
    assert more_suggestions.count("data-assistant-question=") == 5
    assert "More suggestions" in more_suggestions
    assert '<details class="assistant-more-suggestions" open' not in index
    assert 'id="assistantAgent" hidden aria-hidden="true" aria-busy="false"' in index
    assert 'id="assistantComposer" hidden aria-hidden="true"' in index
    assert 'id="assistantInput"' in index and 'maxlength="1000"' in index
    assert 'type="file"' not in index
    assert 'id="assistantSend" type="button" disabled' in index
    assert 'id="assistantCancel" type="button" hidden disabled' in index
    assert 'id="assistantCharacterCount" aria-live="polite"' in index
    assert "Enter to send; Shift+Enter for a new line." in index
    assert (
        'id="assistantActionAvailability" aria-live="polite" aria-atomic="true"'
    ) in index
    assert index.count('id="assistantMessages"') == 1
    assert 'id="assistantChatMessages"' not in index
    assert 'id="assistantReviewContainer"' not in index
    aside_marker = '<aside class="panel left-panel" id="analysisPanel"'
    assert index.count(aside_marker) == 1
    assert index.count('<section class="map-shell"') == 1
    assert "right-panel" not in index
    aside_start = index.index(aside_marker)
    aside_end = index.index("</aside>", aside_start) + len("</aside>")
    assistant_launcher_start = index.index('id="assistantLauncher"')
    assistant_panel_start = index.index('id="assistantPanel"')
    assert assistant_launcher_start > aside_end
    assert assistant_panel_start > aside_end
    sidebar = index[aside_start:aside_end]
    assert "assistantLauncher" not in sidebar
    assert "assistantPanel" not in sidebar
    assert 'id="layerSelect"' in sidebar
    assert 'id="legend"' not in sidebar
    assert "legend-details" not in sidebar
    assert 'id="assistantLauncher"' in index
    launcher_tag = index[
        index.rfind("<button", 0, assistant_launcher_start) : assistant_launcher_start + 200
    ]
    assert 'aria-expanded="false"' in launcher_tag
    assert 'id="assistantPanel"' in index
    panel_tag_start = index.rfind("<section", 0, assistant_panel_start)
    panel_tag_end = index.index(">", assistant_panel_start)
    panel_tag = index[panel_tag_start:panel_tag_end]
    assert 'aria-hidden="true"' in panel_tag and "hidden" in panel_tag
    assert 'id="curveDetails" open' in index
    assert "Select a control section to view Q(t)." in index
    assert 'class="chart-wrap" id="curveChartWrap" hidden' in index
    assert 'class="detail-block" id="curveMetricBlock" hidden' in index
    assert 'id="contextDetails"' in index and 'id="contextDetails" open' not in index
    assert '<details class="technical-details method-details">' in index
    selected_start = sidebar.index('<section class="selected"')
    selected_end = sidebar.index("</section>", selected_start)
    selected_section = sidebar[selected_start:selected_end]
    assert 'id="warningCard"' in selected_section
    method_start = sidebar.index('<details class="technical-details method-details">')
    assert 'id="warningCard"' not in sidebar[method_start:]
    assert 'id="headlineMetrics"' in index and "hidden" in index[
        index.rfind("<section", 0, index.index('id="headlineMetrics"')) :
        index.index(">", index.index('id="headlineMetrics"'))
    ]
    for metric_key in (
        "score_v0",
        "q_min",
        "resilience_loss_area",
        "recovery_duration_hours",
    ):
        assert f'"{metric_key}"' in app

    assert index.count("Roadway Resilience Explorer") == 2
    assert "Experimental Roadway Resilience Explorer" not in index
    assert '<span class="prototype-badge"' in index and ">Prototype</span>" in index
    assert 'data-application-shell data-active-view="explorer"' in index
    assert 'id="appViewHost"' in index
    assert index.count('data-app-view="explorer"') == 1
    assert 'data-app-view="overview"' not in index.lower()
    assert ">Overview<" not in index
    assert "status-line" not in index
    header_start = index.index('<header class="app-header">')
    header_end = index.index("</header>", header_start) + len("</header>")
    header = index[header_start:header_end]
    for count_id in (
        "totalSections",
        "curveSections",
        "validDetections",
        "censoredCount",
    ):
        assert index.count(f'id="{count_id}"') == 1
        assert f'id="{count_id}"' in header
        assert f'id="{count_id}"' not in sidebar
    assert "%" not in header
    assert 'id="mapLegend"' in index
    assert 'id="mapLegendToggle"' in index
    assert index.count('id="legend"') == 1
    map_shell_start = index.index('<section class="map-shell"')
    map_shell_end = index.index("</section>", map_shell_start)
    assert 'id="mapLegend"' in index[map_shell_start:map_shell_end]
    assert 'mapLegendControl = L.control({ position: "bottomleft" })' in app
    assert app.index("setupMapLegendControl();") < app.index("updateLegend();")
    assert 'className: "resilience-basemap-tile"' in app
    assert ".leaflet-tile-pane .resilience-basemap-tile img.leaflet-tile" in style
    assert "filter: saturate(0.72) contrast(0.9) brightness(1.04);" in style
    for forbidden_filter_target in (
        "#map {\n  filter:",
        ".leaflet-map-pane {\n  filter:",
        ".leaflet-overlay-pane {\n  filter:",
        ".leaflet-control {\n  filter:",
    ):
        assert forbidden_filter_target not in style
    assert "function clearSelectedMapHighlight()" in app
    assert "function createSelectedMapHighlight(feature)" in app
    assert app.count("interactive: false") >= 2
    assert 'color: featureColor(selectedProps || {})' in app
    assert 'color: "#ffffff"' in app and 'color: "#0f172a"' in app
    assert all(
        candidate not in index + config + api + actions + chat + app
        for candidate in (
            "get_network_summary",
            "count_sections_by_status",
            "summarize_metric_distribution",
            "summarize_support_coverage",
            "summarize_by_district",
        )
    )
    assert "@import" not in style and "@font-face" not in style
    assert 'id="analysisSplitter"' in index
    assert 'role="separator"' in index
    assert 'aria-orientation="vertical"' in index
    assert 'aria-label="Resize analysis panel"' in index
    assert 'aria-controls="analysisPanel"' in index
    assert 'aria-valuemin="320"' in index
    assert 'aria-valuemax="650"' in index
    assert 'aria-valuenow="420"' in index
    assert 'tabindex="0"' in index
    assert "--analysis-panel-width: 420px;" in style
    assert "grid-template-columns: var(--analysis-panel-width) 10px minmax(0, 1fr);" in style
    assert "map?.invalidateSize({ pan: false, debounceMoveend: true });" in app
    assert "ANALYSIS_PANEL_MIN_WIDTH = 320" in app
    assert "ANALYSIS_PANEL_MAX_WIDTH = 650" in app
    assert "MAP_MIN_DESKTOP_WIDTH = 480" in app
    assert "ANALYSIS_PANEL_KEYBOARD_STEP = 16" in app
    assert all(token not in app for token in ("localStorage", "sessionStorage"))
    splitter_start = app.index("function setupAnalysisSplitter()")
    splitter_end = app.index("\nasync function ", splitter_start)
    splitter_setup = app[splitter_start:splitter_end]
    for event_name in (
        '"pointerdown"',
        '"pointermove"',
        '"pointerup"',
        '"pointercancel"',
        '"keydown"',
    ):
        assert event_name in splitter_setup
    for key_name in ('"ArrowLeft"', '"ArrowRight"', '"Home"', '"End"'):
        assert key_name in splitter_setup
    assert "applyAnalysisPanelWidth(ANALYSIS_PANEL_DEFAULT_WIDTH)" in splitter_setup
    assert 'splitter.setAttribute("aria-valuenow"' in app
    assert 'splitter.setAttribute("aria-valuetext"' in app
    floating_start = app.index("function setupFloatingAssistant()")
    floating_end = app.index("\nfunction ", floating_start + 1)
    floating_setup = app[floating_start:floating_end]
    assert "setExpanded(false);" in floating_setup
    assert 'launcher.addEventListener("click"' in floating_setup
    assert 'close.addEventListener("click"' in floating_setup
    assert 'event.key !== "Escape"' in floating_setup
    assert "launcher.focus()" in floating_setup
    assert ".assistant-floating-panel[hidden]" in style
    assert ".assistant-more-suggestions > summary" in style
    agent_start = style.index(".assistant-agent {")
    agent_style = style[agent_start : style.index("}", agent_start)]
    assert "max-height: clamp(132px, calc(74dvh - 436px), 224px);" in agent_style
    assert "overflow-y: auto;" in agent_style
    mobile_style = style[style.index("@media (max-width: 520px)") :]
    assert ".assistant-agent {" in mobile_style
    assert "max-height: 190px;" in mobile_style
    assert all(
        breakpoint in style
        for breakpoint in (
            "@media (max-width: 980px)",
            "@media (max-width: 768px)",
            "@media (max-width: 520px)",
        )
    )
    assert "html,\nbody {\n  height: 100%;\n  margin: 0;\n  overflow: hidden;" in style
    assert "const response = await fetch(props.curve_file);" in app
    assert 'label: "Raw Q(t) observations"' in app
    assert 'label: "Centered six-observation rolling median"' in app
    assert "centered six-observation rolling median" in index
    assert "observations, not elapsed hours" in index
    assert "no missing-hour interpolation" in index
    assert "6-hour smoothing" not in index + app

    summary = json.loads(
        (V2_ROOT / "data" / "summary.json").read_text(encoding="utf-8")
    )
    assert summary["total_control_sections"] == 10_029
    assert summary["sections_with_curve_json"] == 3_842
    assert summary["valid_phase_detections"] == 3_473
    assert summary["recovery_endpoint_censored"] == 18
    curve_index = json.loads(
        (V2_ROOT / "data" / "curve_index.json").read_text(encoding="utf-8")
    )
    for section_id in ("1081", "257", "3597", "583693"):
        assert section_id in curve_index
        curve_path = V2_ROOT / curve_index[section_id]
        json.loads(curve_path.read_text(encoding="utf-8"))
    assert "1" not in curve_index


def find_browser() -> Path:
    for candidate in CHROME_CANDIDATES:
        if candidate.is_file():
            return candidate
    raise RuntimeError("Chrome or Edge is required for the no-build browser QA harness")


def find_javascript_runtime() -> tuple[Path, dict[str, str]] | None:
    node = shutil.which("node")
    if node:
        return Path(node), {}

    code_command = shutil.which("code.cmd") or shutil.which("code")
    if code_command:
        electron = Path(code_command).resolve().parent.parent / "Code.exe"
        if electron.is_file():
            return electron, {"ELECTRON_RUN_AS_NODE": "1"}
    return None


def run_javascript_tests(driver_name: str) -> str | None:
    runtime = find_javascript_runtime()
    if runtime is None:
        return None
    executable, environment_updates = runtime
    driver = V2_ROOT / "tests" / driver_name
    environment = os.environ.copy()
    environment.update(environment_updates)
    environment["ELECTRON_ENABLE_LOGGING"] = "1"
    debug_log = driver.parent / "debug.log"
    if debug_log.exists():
        raise RuntimeError(f"Refusing to replace existing runtime log: {debug_log}")
    try:
        completed = subprocess.run(
            [str(executable), str(driver)],
            cwd=driver.parent,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=45,
        )
    finally:
        time.sleep(1.5)
        if debug_log.exists():
            debug_log.unlink()
    if completed.returncode != 0:
        diagnostic = (completed.stdout + "\n" + completed.stderr)[-4000:]
        raise RuntimeError(f"JavaScript contract QA failed:\n{diagnostic}")
    return completed.stdout.strip()


def fetch_resource(url: str, *, method: str = "GET") -> tuple[int, int]:
    request = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(request, timeout=15) as response:
        length = int(response.headers.get("Content-Length", "0"))
        if method == "HEAD":
            return response.status, length
        return response.status, len(response.read())


def run_browser(browser: Path, url: str) -> None:
    with tempfile.TemporaryDirectory(
        prefix="sptc-phase2a3-", ignore_cleanup_errors=True
    ) as profile:
        command = [
            str(browser),
            "--headless=new",
            "--disable-gpu",
            "--disable-breakpad",
            "--disable-crash-reporter",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={profile}",
            "--virtual-time-budget=15000",
            "--dump-dom",
            url,
        ]
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=45,
        )
    if completed.returncode != 0 or 'data-status="passed"' not in completed.stdout:
        diagnostic = (completed.stdout + "\n" + completed.stderr)[-4000:]
        raise RuntimeError(
            "Headless browser QA failed for "
            f"{url} (exit={completed.returncode}, stdout={len(completed.stdout)}, "
            f"stderr={len(completed.stderr)}):\n{diagnostic}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--browser",
        action="store_true",
        help="also require the Phase 2A2 client-contract Chrome/Edge runtime tests",
    )
    parser.add_argument(
        "--skip-javascript",
        action="store_true",
        help="run only static/resource QA even when an existing JavaScript runtime is available",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help=(
            "also call the accepted backend at 127.0.0.1:8080 through the "
            "production client and action controller"
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    static_checks()
    client_result = None
    action_result = None
    chat_result = None
    search_result = None
    if not args.skip_javascript:
        client_result = run_javascript_tests("run_assistant_client_qa.js")
        action_result = run_javascript_tests("run_assistant_actions_qa.js")
        chat_result = run_javascript_tests("run_assistant_chat_qa.js")
        search_result = run_javascript_tests("run_search_rendering_qa.js")
    live_client_result = None
    live_action_result = None
    if args.live:
        if args.skip_javascript:
            raise RuntimeError("--live cannot be combined with --skip-javascript")
        live_client_result = run_javascript_tests("run_assistant_client_live_qa.js")
        live_action_result = run_javascript_tests("run_assistant_actions_live_qa.js")
        if live_client_result is None or live_action_result is None:
            raise RuntimeError(
                "--live requires an existing compatible JavaScript runtime"
            )
    handler = functools.partial(QuietHandler, directory=str(REPOSITORY_ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        base = f"http://127.0.0.1:{port}/coldwave-demo-v2"
        resources = (
            "",
            "/css/style.css",
            "/js/assistant-config.js",
            "/js/assistant-api.js",
            "/js/assistant-actions.js",
            "/js/assistant-chat.js",
            "/js/app.js",
            "/tests/assistant-actions-tests.js",
            "/tests/run_assistant_actions_qa.js",
            "/tests/run_assistant_actions_live_qa.js",
            "/tests/assistant-chat-tests.js",
            "/tests/run_assistant_chat_qa.js",
            "/tests/search-rendering-tests.js",
            "/tests/run_search_rendering_qa.js",
            "/tests/run_phase3g_browser_qa.py",
            "/data/summary.json",
            "/data/curves/CS_1081.json",
            "/data/curves/CS_257.json",
            "/data/curves/CS_3597.json",
            "/data/curves/CS_583693.json",
        )
        for resource in resources:
            status, body_length = fetch_resource(f"{base}/{resource.lstrip('/')}")
            assert status == 200 and body_length > 0, resource
        geojson_status, geojson_length = fetch_resource(
            f"{base}/data/data_driven_resilience_map_v0.geojson",
            method="HEAD",
        )
        assert geojson_status == 200
        assert geojson_length == 21_044_231

        if args.browser:
            browser = find_browser()
            test_path = "/coldwave-demo-v2/tests/assistant-client-tests.html"
            run_browser(
                browser,
                f"http://127.0.0.1:{port}{test_path}?assistantMode=backend-tools",
            )
            run_browser(
                browser,
                f"http://localhost:{port}{test_path}?assistantMode=backend-tools",
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    print("Phase 3J static/resource regression QA passed")
    if client_result:
        print(client_result)
    if action_result:
        print(action_result)
    if chat_result:
        print(chat_result)
    if search_result:
        print(search_result)
    elif not args.skip_javascript:
        print(
            "JavaScript contract QA not run; no existing compatible runtime was found"
        )
    if live_client_result:
        print(live_client_result)
    if live_action_result:
        print(live_action_result)
    if args.browser:
        print(
            "Phase 2A2 client-contract browser runtime QA passed for "
            "127.0.0.1 and localhost"
        )
    else:
        print(
            "Isolated production-page browser QA not run; use "
            "run_phase2a4_browser_qa.py and run_phase3g_browser_qa.py for acceptance"
        )


if __name__ == "__main__":
    main()
