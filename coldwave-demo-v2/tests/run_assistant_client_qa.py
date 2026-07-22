"""Run no-build Phase 2A2 static and headless-browser QA."""

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
import time
import urllib.request
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
V2_ROOT = REPOSITORY_ROOT / "coldwave-demo-v2"
CHROME_CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
)
EXPECTED_APP_SHA256 = "fe29f97a658f00beb311738e3627a954bfa4d10562b67140315646b052b92d02"
EXPECTED_STYLE_SHA256 = (
    "75fe222a6e660027fbc8d233c2acacba429df5e2da0450f64eee0ffcde203b13"
)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        del format, args


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def static_checks() -> None:
    index = (V2_ROOT / "index.html").read_text(encoding="utf-8")
    config = (V2_ROOT / "js" / "assistant-config.js").read_text(encoding="utf-8")
    api = (V2_ROOT / "js" / "assistant-api.js").read_text(encoding="utf-8")
    script_order = (
        "./js/assistant-config.js",
        "./js/assistant-api.js",
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
        "js/app.js",
        "data/summary.json",
        "tests/run_assistant_client_qa.js",
        "tests/run_assistant_client_live_qa.js",
    ):
        assert (V2_ROOT / relative_path).is_file(), relative_path

    assert config.count("http://127.0.0.1:8080") == 1
    assert "timeoutMs = 8000" in config
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
            "/assistant",
            "Authorization",
            "api_key",
            "API_KEY",
        )
    )
    assert api.count('credentials: "omit"') == 1
    assert api.count("global.fetch(url, requestOptions)") == 1
    assert "requestReviewedJson" in api
    assert "requestReviewedJson," not in api
    assert all(
        token not in index + config + api
        for token in (
            r"E:\\Projects",
            r"C:\\Users",
            "data/tier3",
            "services/resilience-agent",
            "NPMRDS/",
            "Bearer ",
        )
    )
    app = (V2_ROOT / "js" / "app.js").read_text(encoding="utf-8")
    assert "SPTCAssistant.client" not in app
    assert "/api/v1/" not in app
    assert sha256(V2_ROOT / "js" / "app.js") == EXPECTED_APP_SHA256
    assert sha256(V2_ROOT / "css" / "style.css") == EXPECTED_STYLE_SHA256

    summary = json.loads(
        (V2_ROOT / "data" / "summary.json").read_text(encoding="utf-8")
    )
    assert summary["total_control_sections"] == 10_029
    assert summary["sections_with_curve_json"] == 3_842
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
        prefix="sptc-phase2a2-", ignore_cleanup_errors=True
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
        help="also require automated Chrome/Edge runtime tests",
    )
    parser.add_argument(
        "--skip-javascript",
        action="store_true",
        help="run only static/resource QA even when an existing JavaScript runtime is available",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="also call the accepted backend at 127.0.0.1:8080 through the production client",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    static_checks()
    javascript_result = (
        None
        if args.skip_javascript
        else run_javascript_tests("run_assistant_client_qa.js")
    )
    live_result = None
    if args.live:
        if args.skip_javascript:
            raise RuntimeError("--live cannot be combined with --skip-javascript")
        live_result = run_javascript_tests("run_assistant_client_live_qa.js")
        if live_result is None:
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
            "/js/app.js",
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
    print("Phase 2A2 static/resource QA passed")
    if javascript_result:
        print(javascript_result)
    elif not args.skip_javascript:
        print(
            "JavaScript contract QA not run; no existing compatible runtime was found"
        )
    if live_result:
        print(live_result)
    if args.browser:
        print("Phase 2A2 browser runtime QA passed for 127.0.0.1 and localhost")
    else:
        print(
            "Browser runtime QA not run; use --browser or the documented manual steps"
        )


if __name__ == "__main__":
    main()
