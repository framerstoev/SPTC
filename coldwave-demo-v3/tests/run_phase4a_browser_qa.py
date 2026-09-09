"""Run isolated real-browser acceptance QA against the production V3 page.

The harness never starts or stops the frontend, FastAPI, or Ollama. The
``ui`` scenario requires the static frontend on ``127.0.0.1:8001``. The
``live`` scenario additionally requires the reviewed V3-enabled backend and
pre-warmed local model on ``127.0.0.1:8080``.

Chrome is launched only when no Chrome process is already running, with a
GUID-named temporary profile and loopback-only DevTools endpoint. The browser
is closed through its exact CDP connection; the harness never kills browser
processes broadly. Screenshots are written beneath an explicit output
directory in a new per-run folder. Standard output contains bounded case
metadata and summaries, never prompts, answers, request bodies, model payloads,
internal paths, or reasoning content.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import queue
import re
import shutil
import statistics
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    import websocket
except ImportError as error:  # pragma: no cover - audited host capability guard
    raise SystemExit(
        "websocket-client is required for isolated Chrome/CDP QA; use the "
        "already audited base Python environment."
    ) from error


FRONTEND_ORIGIN = "http://127.0.0.1:8001"
BACKEND_ORIGIN = "http://127.0.0.1:8080"
V3_PATH = "/coldwave-demo-v3/"
V2_PATH = "/coldwave-demo-v2/"
V3_URL = f"{FRONTEND_ORIGIN}{V3_PATH}?assistantMode=backend-agent"
V2_URL = f"{FRONTEND_ORIGIN}{V2_PATH}?assistantMode=backend-agent"
ASSISTANT_QUERY_URL = f"{BACKEND_ORIGIN}/api/v1/assistant/query"
CHROME_CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
)
VIEWPORTS = ((1440, 900), (1024, 768), (768, 900), (390, 844))
PAGE_READY_TIMEOUT = 60.0
MODEL_RESPONSE_TIMEOUT = 120.0
ACTION_TIMEOUT = 20.0
FRONTEND_METRIC_ABS_TOLERANCE = 5.1e-7
EXPECTED_RELEASE = "coldwave_2026_01_r1"
EXPECTED_METHOD = "data_driven_resilience_v0"
EXPECTED_LAYER_METRICS = {
    "tier1": "weather_rei",
    "tier2": "netrisk_lite",
    "potential": "potential_resilience_score",
    "tier3": "observed_curve_resilience_score_v0",
}
ALLOWED_REQUEST_FIELDS = {
    "message",
    "selected_section_id",
    "active_metric",
    "active_analysis_layer",
    "assistant_profile",
    "history",
}
FORBIDDEN_VISIBLE = re.compile(
    r"(?:NETRISK[_ ]LITE|\bLite\b|\bTier\s*2[-_ ]Lite\b|\bEVENT_REI\b|"
    r"\bEvent\s+REI\b|Observed Curve Resilience Score v0|\bScore\s*v0\b|"
    r"\bQwen(?:3)?\b|\bOllama\b|\bFastAPI\b|qwen3:8b|"
    r"Method and limitations|More suggestions|"
    r"[A-Za-z]:\\|file://|Traceback|services[/\\]resilience-agent|data[/\\]tier3)",
    re.IGNORECASE,
)
RAW_JSON = re.compile(
    r"\{\s*[\"']?(?:status|answer|tools_used|evidence|warnings|structured_result)"
    r"[\"']?\s*:",
    re.IGNORECASE,
)
DIRECT_OLLAMA = re.compile(r"^(?:https?|wss?)://[^/?#]+:11434(?:/|$)", re.I)
UNSUPPORTED_AFFIRMATIVE_CLAIM = re.compile(
    r"(?:\b(?:weather|cold|pavement|network)\s+(?:caused|will cause)\b|"
    r"\bCS_[1-9][0-9]*\s+(?:will fail|should be rebuilt|should receive investment)\b|"
    r"\brecommend(?:s|ed|ing)?\s+(?:rebuilding|investing in)\s+CS_[1-9][0-9]*\b)",
    re.IGNORECASE,
)


class BrowserQAError(RuntimeError):
    """Raised when an acceptance gate fails."""


@dataclass
class QAReport:
    checks: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def check(self, condition: bool, name: str, detail: str = "") -> None:
        if not condition:
            suffix = f": {detail[:300]}" if detail else ""
            raise BrowserQAError(f"FAILED {name}{suffix}")
        self.checks.append(name)

    def note(self, message: str) -> None:
        self.notes.append(message[:300])


@dataclass(frozen=True)
class PromptResult:
    case_id: str
    status: str
    intent: str | None
    tool_name: str | None
    structured_type: str | None
    latency_seconds: float


class CDPConnection:
    """Small thread-safe CDP JSON-RPC connection with an event journal."""

    def __init__(self, websocket_url: str) -> None:
        self._socket = websocket.create_connection(
            websocket_url,
            timeout=10,
            suppress_origin=True,
        )
        self._socket.settimeout(None)
        self._next_id = 1
        self._pending: dict[int, queue.Queue[dict[str, Any]]] = {}
        self._events: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._event_condition = threading.Condition(self._lock)
        self._closed = False
        self._receiver_error: BaseException | None = None
        self._receiver = threading.Thread(target=self._receive, daemon=True)
        self._receiver.start()

    def _receive(self) -> None:
        try:
            while not self._closed:
                raw = self._socket.recv()
                if not raw:
                    break
                message = json.loads(raw)
                with self._event_condition:
                    message_id = message.get("id")
                    pending = self._pending.get(message_id)
                    if pending is not None:
                        pending.put(message)
                    else:
                        self._events.append(message)
                        self._event_condition.notify_all()
        except BaseException as error:  # socket closure is handled by close()
            if not self._closed:
                self._receiver_error = error
        finally:
            with self._event_condition:
                for pending in self._pending.values():
                    pending.put({"error": {"message": "CDP connection closed"}})
                self._event_condition.notify_all()

    def command(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: float = 15.0,
    ) -> dict[str, Any]:
        response_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        with self._lock:
            if self._closed:
                raise BrowserQAError(f"CDP connection is closed before {method}")
            message_id = self._next_id
            self._next_id += 1
            self._pending[message_id] = response_queue
            self._socket.send(
                json.dumps(
                    {
                        "id": message_id,
                        "method": method,
                        "params": params or {},
                    }
                )
            )
        try:
            response = response_queue.get(timeout=timeout)
        except queue.Empty as error:
            raise BrowserQAError(f"CDP command timed out: {method}") from error
        finally:
            with self._lock:
                self._pending.pop(message_id, None)
        if "error" in response:
            raise BrowserQAError(
                f"CDP {method} failed: {response['error'].get('message', 'unknown')}"
            )
        return response.get("result", {})

    def event_mark(self) -> int:
        with self._lock:
            return len(self._events)

    def events_since(
        self,
        mark: int,
        method: str | None = None,
    ) -> list[dict[str, Any]]:
        with self._lock:
            events = list(self._events[mark:])
        if method is None:
            return events
        return [event for event in events if event.get("method") == method]

    def wait_event(
        self,
        method: str,
        *,
        mark: int = 0,
        predicate: Callable[[dict[str, Any]], bool] | None = None,
        timeout: float = 15.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        with self._event_condition:
            while True:
                for event in self._events[mark:]:
                    if event.get("method") != method:
                        continue
                    params = event.get("params", {})
                    if predicate is None or predicate(params):
                        return params
                if self._receiver_error is not None:
                    raise BrowserQAError(f"CDP receiver failed while waiting for {method}")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise BrowserQAError(f"Timed out waiting for CDP event {method}")
                self._event_condition.wait(timeout=min(remaining, 0.25))

    def close(self) -> None:
        self._closed = True
        with suppress(Exception):
            self._socket.close()
        self._receiver.join(timeout=2)


def chrome_process_count() -> int:
    completed = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV", "/NH"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    return sum(
        1
        for line in completed.stdout.splitlines()
        if line.lstrip().lower().startswith('"chrome.exe"')
    )


def read_json(url: str, timeout: float = 10.0) -> Any:
    request = urllib.request.Request(url, headers={"Connection": "close"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


class IsolatedChrome:
    """Own an isolated headless Chrome profile and exact CDP sessions."""

    PROFILE_PREFIX = "sptc-phase4a-cdp-"

    def __init__(
        self,
        chrome_path: Path | None = None,
        isolated_profile: Path | None = None,
    ) -> None:
        self.chrome_path = chrome_path or next(
            (candidate for candidate in CHROME_CANDIDATES if candidate.is_file()),
            None,
        )
        if self.chrome_path is None:
            raise BrowserQAError("Installed Google Chrome was not found")
        self._attached_profile = isolated_profile
        self._temporary_profile: tempfile.TemporaryDirectory[str] | None = None
        self.debugging_port: int | None = None
        self.browser: CDPConnection | None = None
        self.page: CDPConnection | None = None
        self._extra_pages: list[CDPConnection] = []

    @property
    def profile(self) -> Path:
        if self._attached_profile is not None:
            return self._attached_profile.resolve()
        if self._temporary_profile is None:
            raise BrowserQAError("Isolated Chrome profile is unavailable")
        return Path(self._temporary_profile.name).resolve()

    def _connect_profile(self) -> None:
        port_file = self.profile / "DevToolsActivePort"
        deadline = time.monotonic() + 20
        while not port_file.is_file() and time.monotonic() < deadline:
            time.sleep(0.1)
        if not port_file.is_file():
            raise BrowserQAError("Chrome did not create its isolated DevTools port")
        port_lines = port_file.read_text(encoding="utf-8").splitlines()
        if not port_lines or not port_lines[0].isdigit():
            raise BrowserQAError("Chrome returned an invalid DevTools port")
        self.debugging_port = int(port_lines[0])
        version = read_json(f"http://127.0.0.1:{self.debugging_port}/json/version")
        self.browser = CDPConnection(version["webSocketDebuggerUrl"])
        targets = read_json(f"http://127.0.0.1:{self.debugging_port}/json/list")
        target = next((item for item in targets if item.get("type") == "page"), None)
        if target is None:
            raise BrowserQAError("Isolated Chrome did not expose a page target")
        self.page = CDPConnection(target["webSocketDebuggerUrl"])

    def _validate_attached_profile(self) -> None:
        profile = self.profile
        temp_root = Path(tempfile.gettempdir()).resolve()
        if (
            profile.parent != temp_root
            or not profile.name.startswith(self.PROFILE_PREFIX)
            or not profile.is_dir()
        ):
            raise BrowserQAError(
                "--isolated-profile must be an existing Phase 4A profile directly "
                "under the OS temporary directory"
            )
        if chrome_process_count() == 0:
            raise BrowserQAError("No Chrome process owns the supplied isolated profile")

    @staticmethod
    def _powershell_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    def _launch(self) -> None:
        active = chrome_process_count()
        if active:
            raise BrowserQAError(
                "Refusing isolated QA while Chrome is running; close personal Chrome sessions first"
            )
        self._temporary_profile = tempfile.TemporaryDirectory(
            prefix=self.PROFILE_PREFIX,
            ignore_cleanup_errors=False,
        )
        arguments = [
            str(self.chrome_path),
            "--headless=new",
            "--disable-gpu",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-extensions",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-first-run",
            "--no-default-browser-check",
            "--noerrdialogs",
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=0",
            f"--user-data-dir={self.profile}",
            "--window-size=1440,900",
            "about:blank",
        ]
        argument_list = ",".join(self._powershell_literal(argument) for argument in arguments[1:])
        launch_script = (
            "$process = Start-Process "
            f"-FilePath {self._powershell_literal(arguments[0])} "
            f"-ArgumentList @({argument_list}) "
            "-WindowStyle Hidden -PassThru; $process.Id"
        )
        launched = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                launch_script,
            ],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
        if launched.returncode != 0:
            raise BrowserQAError("PowerShell could not start isolated Chrome")

    def __enter__(self) -> IsolatedChrome:
        if self._attached_profile is not None:
            self._validate_attached_profile()
        else:
            self._launch()
        try:
            self._connect_profile()
        except Exception:
            self._close_exact_browser()
            self._cleanup_profile()
            raise
        return self

    def new_page(self, url: str = "about:blank") -> tuple[str, CDPConnection]:
        if self.browser is None or self.debugging_port is None:
            raise BrowserQAError("Browser CDP session is unavailable")
        created = self.browser.command("Target.createTarget", {"url": url})
        target_id = created.get("targetId")
        if not isinstance(target_id, str):
            raise BrowserQAError("Chrome did not create the requested page target")
        deadline = time.monotonic() + 10
        target: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            targets = read_json(f"http://127.0.0.1:{self.debugging_port}/json/list")
            target = next((item for item in targets if item.get("id") == target_id), None)
            if target and target.get("webSocketDebuggerUrl"):
                break
            time.sleep(0.1)
        if not target or not target.get("webSocketDebuggerUrl"):
            raise BrowserQAError("Chrome did not expose the additional page target")
        connection = CDPConnection(target["webSocketDebuggerUrl"])
        self._extra_pages.append(connection)
        return target_id, connection

    def close_page(self, target_id: str, connection: CDPConnection) -> None:
        if connection in self._extra_pages:
            self._extra_pages.remove(connection)
        connection.close()
        if self.browser is not None:
            self.browser.command("Target.closeTarget", {"targetId": target_id}, timeout=3)

    def _close_exact_browser(self) -> None:
        for connection in self._extra_pages:
            connection.close()
        self._extra_pages.clear()
        if self.page is not None:
            self.page.close()
            self.page = None
        connection = self.browser
        if connection is None:
            # A launch can succeed before _connect_profile() reaches the
            # browser assignment. Reconnect only through this exact profile's
            # DevToolsActivePort so failure cleanup never targets Chrome
            # broadly.
            port_file = self.profile / "DevToolsActivePort"
            if port_file.is_file():
                try:
                    port_lines = port_file.read_text(encoding="utf-8").splitlines()
                    port = int(port_lines[0])
                    version = read_json(f"http://127.0.0.1:{port}/json/version")
                    connection = CDPConnection(version["webSocketDebuggerUrl"])
                except Exception:
                    connection = None
        if connection is not None:
            with suppress(Exception):
                connection.command("Browser.close", timeout=3)
            connection.close()
        self.browser = None

    def _cleanup_profile(self) -> None:
        deadline = time.monotonic() + 10
        while chrome_process_count() and time.monotonic() < deadline:
            time.sleep(0.2)
        if chrome_process_count():
            raise BrowserQAError(
                "Chrome remains after exact CDP close; no broad process termination was used"
            )
        if self._temporary_profile is not None:
            self._temporary_profile.cleanup()
            self._temporary_profile = None
        elif self._attached_profile is not None and self.profile.is_dir():
            shutil.rmtree(self.profile)

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        del exc_type, exc, traceback
        self._close_exact_browser()
        self._cleanup_profile()


class Phase4ABrowserQA:
    # Later acceptance subclasses may add exact, reviewed deterministic routes.
    # The accepted Phase 4A/4B default remains unchanged.
    additional_reviewed_api_routes: tuple[str, ...] = ()
    """Drive the production V3 DOM and retain only sanitized measurements."""

    def __init__(
        self,
        chrome: IsolatedChrome,
        report: QAReport,
        artifact_directory: Path,
    ) -> None:
        if chrome.page is None or chrome.browser is None:
            raise BrowserQAError("Chrome CDP sessions are unavailable")
        self.chrome = chrome
        self.page = chrome.page
        self.report = report
        self.artifact_directory = artifact_directory
        self.prompt_results: list[PromptResult] = []
        self.page.command("Page.enable")
        self.page.command("Runtime.enable")
        self.page.command("Log.enable")
        self.page.command(
            "Network.enable",
            {
                "maxTotalBufferSize": 100 * 1024 * 1024,
                "maxResourceBufferSize": 4 * 1024 * 1024,
            },
        )
        self.page.command("Network.setCacheDisabled", {"cacheDisabled": True})
        self.console_mark = self.page.event_mark()
        self.page_load_api_count = 0

    def evaluate(self, expression: str, *, await_promise: bool = True) -> Any:
        result = self.page.command(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": await_promise,
                "returnByValue": True,
                "userGesture": True,
            },
        )
        if "exceptionDetails" in result:
            raise BrowserQAError("Production-page JavaScript evaluation failed")
        return result.get("result", {}).get("value")

    def wait_js(
        self,
        expression: str,
        description: str,
        timeout: float = ACTION_TIMEOUT,
    ) -> Any:
        deadline = time.monotonic() + timeout
        last_value: Any = None
        while time.monotonic() < deadline:
            try:
                last_value = self.evaluate(expression)
                if last_value:
                    return last_value
            except BrowserQAError:
                pass
            time.sleep(0.1)
        raise BrowserQAError(
            f"Timed out waiting for {description}; last value type={type(last_value).__name__}"
        )

    def navigate(self, url: str = V3_URL) -> int:
        mark = self.page.event_mark()
        result = self.page.command("Page.navigate", {"url": url})
        if result.get("errorText"):
            raise BrowserQAError("Production-page navigation failed")
        self.page.wait_event(
            "Page.loadEventFired",
            mark=mark,
            timeout=PAGE_READY_TIMEOUT,
        )
        self.wait_js(
            "document.querySelector('#totalSections')?.textContent.trim() === '10,029' "
            "&& document.querySelector('#map')?.classList.contains('leaflet-container') "
            "&& typeof activeAnalysisLayer === 'string'",
            "the production V3 map application",
            PAGE_READY_TIMEOUT,
        )
        resources = self.evaluate(
            "performance.getEntriesByType('resource').map(entry => entry.name)"
        )
        self.report.check(
            any(url.endswith("/coldwave-demo-v3/js/app.js") for url in resources),
            "production V3 app.js loaded",
        )
        self.report.check(
            not any("assistant-client-tests.html" in url for url in resources),
            "acceptance uses the production page rather than a test fixture",
        )
        local_versioned_resources = [
            resource
            for resource in resources
            if resource.startswith(FRONTEND_ORIGIN) and "/coldwave-demo" in resource
        ]
        self.report.check(
            local_versioned_resources
            and all(V3_PATH in resource for resource in local_versioned_resources),
            "production V3 loads no runtime asset from V2",
        )
        return mark

    def all_requests(self, mark: int = 0) -> list[dict[str, Any]]:
        return [
            event.get("params", {})
            for event in self.page.events_since(mark, "Network.requestWillBeSent")
            if event.get("params", {}).get("request", {}).get("url")
        ]

    def api_requests(self, mark: int = 0) -> list[dict[str, Any]]:
        return [
            params
            for params in self.all_requests(mark)
            if params.get("request", {}).get("url", "").startswith(f"{BACKEND_ORIGIN}/api/v1/")
            and params.get("request", {}).get("method") != "OPTIONS"
        ]

    def query_requests(self, mark: int = 0) -> list[dict[str, Any]]:
        return [
            params
            for params in self.api_requests(mark)
            if params.get("request", {}).get("url") == ASSISTANT_QUERY_URL
        ]

    def websocket_urls(self, mark: int = 0) -> list[str]:
        return [
            event.get("params", {}).get("url", "")
            for event in self.page.events_since(mark, "Network.webSocketCreated")
            if event.get("params", {}).get("url")
        ]

    def click(self, selector: str) -> None:
        clicked = self.evaluate(
            "(() => { const node = document.querySelector("
            + json.dumps(selector)
            + "); if (!node) return false; node.click(); return true; })()"
        )
        if not clicked:
            raise BrowserQAError(f"Required production control is missing: {selector}")

    def ensure_assistant_open(self) -> None:
        if not self.evaluate("document.querySelector('#assistantPanel').hidden"):
            return
        mark = self.page.event_mark()
        self.click("#assistantLauncher")
        self.wait_js(
            "!document.querySelector('#assistantPanel').hidden "
            "&& document.querySelector('#assistantLauncher').getAttribute('aria-expanded') "
            "=== 'true'",
            "the V3 Assistant panel",
        )
        self.report.check(
            not self.api_requests(mark),
            "opening the Assistant sends no automatic API request",
        )

    def ensure_assistant_closed(self) -> None:
        if self.evaluate("document.querySelector('#assistantPanel').hidden"):
            return
        mark = self.page.event_mark()
        self.click("#assistantClose")
        self.wait_js(
            "document.querySelector('#assistantPanel').hidden",
            "the V3 Assistant panel to close",
        )
        self.report.check(
            not self.api_requests(mark),
            "closing the Assistant sends no automatic API request",
        )

    def initial_ui_acceptance(self) -> None:
        page_mark = self.navigate()
        time.sleep(0.5)
        page_api = self.api_requests(page_mark)
        self.page_load_api_count = len(page_api)
        self.report.check(
            not page_api,
            "V3 page load sends zero Assistant or deterministic-tool requests",
        )
        state = self.evaluate(
            """
            (() => {
              const buttons = Array.from(document.querySelectorAll(
                '#analysisTierControl [data-analysis-layer]'));
              const options = Array.from(document.querySelectorAll('#tierSelect option'));
              const visible = node => {
                const style = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden'
                  && rect.width > 0 && rect.height > 0;
              };
              return {
                title: document.querySelector('.app-header h1')?.textContent.trim(),
                context: document.querySelector('.app-context')?.textContent.trim(),
                prototype: document.querySelector('.prototype-badge')?.textContent.trim(),
                layers: buttons.map(node => node.dataset.analysisLayer),
                options: options.map(node => node.value),
                checked: buttons.filter(
                  node => node.getAttribute('aria-checked') === 'true').length,
                visuallyMaroon: buttons.filter(node =>
                  getComputedStyle(node).backgroundColor === 'rgb(80, 0, 0)').length,
                selectedValue: document.querySelector('#tierSelect')?.value,
                prompts: Array.from(document.querySelectorAll(
                  '[data-assistant-question]'), node => ({
                    label: node.textContent.trim(), question: node.dataset.assistantQuestion
                  })),
                quickCollapsed: !document.querySelector('.assistant-quick-actions').open,
                quickActions: Array.from(document.querySelectorAll(
                  '[data-assistant-action]'), node => node.textContent.trim()),
                legacyControls: document.querySelectorAll(
                  '#layerSelect,#analysisSplitter,#curveDetails,#supportingMetricsDetails,' +
                  '#assistantMoreSuggestions').length,
                buttonControlVisible: visible(document.querySelector('#analysisTierControl')),
                normalText: document.body.innerText
              };
            })()
            """
        )
        self.report.check(
            state["title"] == "Roadway Resilience Explorer"
            and state["prototype"] == "Prototype"
            and "Multi-Tier Roadway Resilience" in state["context"],
            "V3 header states the product purpose and prototype status",
        )
        self.report.check(
            state["layers"] == ["tier1", "tier2", "potential", "tier3"]
            and state["options"] == ["tier1", "tier2", "potential", "tier3"],
            "normal UI contains exactly the four reviewed analytical tiers",
        )
        self.report.check(
            state["checked"] == 1
            and state["visuallyMaroon"] == 1
            and state["selectedValue"] == "tier3"
            and state["buttonControlVisible"],
            "initial Tier 3 selection is singular and visually obvious",
        )
        self.report.check(
            state["legacyControls"] == 0,
            "V3 has no old layer menu, splitter, or duplicate analysis accordions",
        )
        self.report.check(
            len(state["prompts"]) == 3
            and [item["label"] for item in state["prompts"]]
            == [
                "Rank Tier 3 sections",
                "Compare potential & observed",
                "Summarize Dallas County",
            ]
            and state["quickCollapsed"]
            and state["quickActions"]
            == [
                "Explain this section",
                "Explain current metric",
                "Generate review note",
            ],
            "chat-first UI has three demo prompts and collapsed deterministic actions",
        )
        runtime = self.evaluate(
            "({runtime:window.SPTCAssistant.runtime, "
            "deployment:window.SPTCV3Deployment, controller:assistantChatController.getState(), "
            "localKeys:Object.keys(localStorage), sessionKeys:Object.keys(sessionStorage)})"
        )
        self.report.check(
            runtime["runtime"].get("effective_mode") == "backend-agent"
            and runtime["runtime"].get("assistant_profile") == "v3"
            and runtime["runtime"].get("backend_target") == "local-loopback"
            and runtime["runtime"].get("backend_base_url") == BACKEND_ORIGIN
            and runtime["deployment"] == {"backend_target": "local-loopback"}
            and runtime["controller"].get("activeAnalysisLayer") == "tier3"
            and runtime["controller"].get("activeMetric") == EXPECTED_LAYER_METRICS["tier3"],
            "V3 runtime uses explicit local deployment and host-owned profile context",
        )
        self.report.check(
            not runtime["localKeys"] and not runtime["sessionKeys"],
            "V3 writes no browser credential or configuration storage",
        )
        self.report.check(
            FORBIDDEN_VISIBLE.search(state["normalText"]) is None,
            "initial visible UI has no forbidden technical or implementation branding",
        )

    def select_section(self, section_id: str) -> None:
        mark = self.page.event_mark()
        value = json.dumps(f"CS_{section_id}")
        self.evaluate(
            "(() => { const input = document.querySelector('#csSearch'); input.value = "
            + value
            + "; input.dispatchEvent(new Event('input', {bubbles:true})); return true; })()"
        )
        selector = f'.search-result[data-key="{section_id}"]'
        self.wait_js(
            f"Boolean(document.querySelector({json.dumps(selector)}))",
            f"the search result for CS_{section_id}",
        )
        self.click(selector)
        self.wait_js(
            f"document.querySelector('#selectedTitle').textContent.includes('CS {section_id}')",
            f"selection of CS_{section_id}",
        )
        self.report.check(
            not self.api_requests(mark),
            "section selection sends no automatic Assistant request",
        )

    def set_tier(self, tier: str) -> None:
        if tier not in EXPECTED_LAYER_METRICS:
            raise BrowserQAError("Harness received an unknown tier")
        mark = self.page.event_mark()
        selector = f'[data-analysis-layer="{tier}"]'
        self.click(selector)
        self.wait_js(
            "activeAnalysisLayer === "
            + json.dumps(tier)
            + " && document.querySelector("
            + json.dumps(selector)
            + ").getAttribute('aria-checked') === 'true' "
            + "&& document.querySelector('#tierSelect').value === "
            + json.dumps(tier),
            f"the {tier} map/panel context",
        )
        self.report.check(
            not self.api_requests(mark),
            f"switching to {tier} sends no automatic Assistant request",
        )

    def tier_state(self) -> dict[str, Any]:
        return self.evaluate(
            """
            (() => {
              const buttons = Array.from(document.querySelectorAll(
                '#analysisTierControl [data-analysis-layer]'));
              const curve = document.querySelector('#curvePanel');
              const legend = document.querySelector('#legend');
              return {
                layer: activeAnalysisLayer,
                checked: buttons.filter(node => node.getAttribute('aria-checked') === 'true')
                  .map(node => node.dataset.analysisLayer),
                visuallyMaroon: buttons.filter(node =>
                  getComputedStyle(node).backgroundColor === 'rgb(80, 0, 0)')
                  .map(node => node.dataset.analysisLayer),
                mobile: document.querySelector('#tierSelect').value,
                chip: document.querySelector('#activeTierChip').textContent.trim(),
                eyebrow: document.querySelector('#tierPanelEyebrow').textContent.trim(),
                heading: document.querySelector('#tierPanelHeading').textContent.trim(),
                labels: Array.from(document.querySelectorAll('#tierMetrics .metric-card > span'),
                  node => node.textContent.trim()),
                keys: Array.from(document.querySelectorAll('#tierMetrics [data-metric]'),
                  node => node.dataset.metric),
                curveHidden: curve.hidden || getComputedStyle(curve).display === 'none',
                legendTitle: legend.querySelector('.legend-title')?.textContent.trim() || '',
                legendText: legend.textContent,
                layerNote: document.querySelector('#layerNote').textContent.trim(),
                footnote: document.querySelector('#tierFootnote').textContent.trim(),
                warning: document.querySelector('#warningCard').textContent.trim(),
                badges: document.querySelector('#statusBadges').textContent.trim()
              };
            })()
            """
        )

    def tier_synchronization_acceptance(self) -> None:
        self.select_section("1081")
        expected = {
            "tier1": {
                "labels": ["WEATHER_REI"],
                "keys": ["weather_rei"],
                "chip": "Tier 1 — Weather",
                "eyebrow": "Tier 1",
                "heading": "Weather Resilience Context",
                "legend": "Tier 1 — Weather Resilience Context",
                "direction": "exposure concern",
                "curve": True,
            },
            "tier2": {
                "labels": ["NETWORK_REI", "AADT"],
                "keys": ["network_rei", "aadt"],
                "chip": "Tier 2 — Network",
                "eyebrow": "Tier 2",
                "heading": "Network Resilience Context",
                "legend": "Tier 2 — Network Resilience Context",
                "direction": "network",
                "curve": True,
            },
            "potential": {
                "labels": [
                    "Potential Resilience",
                    "Tier 1 — Weather",
                    "Tier 2 — Network",
                ],
                "keys": [
                    "potential_resilience_score",
                    "weather_rei",
                    "network_rei",
                ],
                "chip": "Tier 1+2 — Potential",
                "eyebrow": "Tier 1+2",
                "heading": "Potential Resilience",
                "legend": "Tier 1+2 — Potential Resilience",
                "direction": "favorable",
                "curve": True,
            },
            "tier3": {
                "labels": ["Score", "Minimum", "Loss Area", "Recovery"],
                "keys": [
                    "observed_resilience_score",
                    "q_min",
                    "resilience_loss_area",
                    "recovery_duration_hours",
                ],
                "chip": "Tier 3 — Observed Resilience",
                "eyebrow": "Tier 3",
                "heading": "Observed Resilience",
                "legend": "Tier 3 — Observed Resilience",
                "direction": "favorable",
                "curve": False,
            },
        }
        for tier, contract in expected.items():
            self.set_tier(tier)
            state = self.tier_state()
            self.report.check(
                state["layer"] == tier
                and state["checked"] == [tier]
                and state["visuallyMaroon"] == [tier]
                and state["mobile"] == tier,
                f"{tier} has one synchronized authoritative selection",
            )
            self.report.check(
                state["labels"] == contract["labels"]
                and state["keys"] == contract["keys"]
                and state["chip"] == contract["chip"]
                and state["eyebrow"] == contract["eyebrow"]
                and state["heading"] == contract["heading"],
                f"{tier} panel contains only its reviewed compact metrics",
            )
            self.report.check(
                state["curveHidden"] is contract["curve"],
                f"{tier} controls Q(t) visibility without a second accordion",
            )
            self.report.check(
                state["legendTitle"] == contract["legend"]
                and contract["direction"] in (state["legendText"] + state["layerNote"]).lower(),
                f"{tier} legend and interpretation direction are synchronized",
            )
            self.report.check(
                FORBIDDEN_VISIBLE.search(" ".join(state["labels"])) is None,
                f"{tier} panel uses only reviewed V3 display labels",
            )

        self.wait_js(
            "document.querySelector('#curveChart').getBoundingClientRect().height > 0 "
            "&& typeof curveChart !== 'undefined' && curveChart !== null",
            "the automatic CS_1081 Q(t) curve",
            PAGE_READY_TIMEOUT,
        )
        curve = self.evaluate(
            """
            (() => ({
              labels: curveChart.data.datasets.map(item => item.label),
              markerCount: document.querySelectorAll('#phaseMarkerLegend span').length,
              markerText: document.querySelector('#phaseMarkerLegend').textContent,
              note: document.querySelector('#curveNote').textContent,
              metricCount: document.querySelectorAll('#tierMetrics .metric-card').length
            }))()
            """
        )
        self.report.check(
            curve["metricCount"] == 4
            and curve["labels"][:2]
            == ["Raw Q(t) observations", "Centered six-observation rolling median"],
            "Tier 3 shows exactly four KPIs plus raw and rolling-median Q(t)",
        )
        self.report.check(
            curve["markerCount"] == 3
            and all(
                phrase in curve["markerText"]
                for phrase in ("Detected onset", "Minimum Q(t)", "Recovery endpoint")
            ),
            "Tier 3 Q(t) retains reviewed phase markers",
        )

    def warning_state_acceptance(self) -> None:
        self.set_tier("tier3")
        cases = {
            "1081": ("detected phase pattern", ""),
            "257": ("no sustained drop detected", "not evidence of no impact"),
            "3597": ("recovery endpoint censored", "censored"),
            "1": (
                "no observed npmrds support",
                "missing support is not low resilience",
            ),
        }
        for section_id, (badge, warning) in cases.items():
            self.select_section(section_id)
            state = self.tier_state()
            self.report.check(
                badge in state["badges"].lower()
                and (
                    state["warning"] == "" if warning == "" else warning in state["warning"].lower()
                ),
                f"CS_{section_id} retains its essential Tier 3 warning",
            )
        self.select_section("1081")

    def capture_screenshot(self, stem: str, *, full_page: bool) -> str:
        data = self.page.command(
            "Page.captureScreenshot",
            {
                "format": "png",
                "fromSurface": True,
                "captureBeyondViewport": full_page,
            },
            timeout=30,
        ).get("data", "")
        try:
            decoded = base64.b64decode(data, validate=True)
        except ValueError as error:
            raise BrowserQAError("Chrome returned an invalid screenshot") from error
        self.report.check(len(decoded) > 1000, f"{stem} screenshot contains image data")
        filename = f"{stem}.png"
        destination = self.artifact_directory / filename
        if destination.exists():
            raise BrowserQAError("Refusing to overwrite an existing screenshot artifact")
        destination.write_bytes(decoded)
        return filename

    def set_viewport(self, width: int, height: int) -> None:
        self.page.command(
            "Emulation.setDeviceMetricsOverride",
            {
                "width": width,
                "height": height,
                "deviceScaleFactor": 1,
                "mobile": False,
            },
        )
        self.evaluate("window.dispatchEvent(new Event('resize')); window.scrollTo(0, 0)")
        time.sleep(0.25)

    def assistant_viewport_acceptance(self, prefix: str) -> list[str]:
        artifacts: list[str] = []
        self.ensure_assistant_open()
        for width, height in VIEWPORTS:
            self.set_viewport(width, height)
            layout = self.evaluate(
                """
                (() => {
                  const panel = document.querySelector('#assistantPanel');
                  const messages = document.querySelector('#assistantMessages');
                  const map = document.querySelector('#map');
                  const rect = node => { const r = node.getBoundingClientRect(); return {
                    left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height
                  }; };
                  const p = rect(panel); const m = rect(messages); const mapRect = rect(map);
                  return {
                    panel:p, messages:m, map:mapRect,
                    panelPosition:getComputedStyle(panel).position,
                    messagesOverflow:getComputedStyle(messages).overflowY,
                    horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1,
                    viewport:{
                      width:innerWidth,
                      height:innerHeight,
                      clientWidth:document.documentElement.clientWidth
                    },
                    promptCount:document.querySelectorAll(
                      '[data-assistant-question]').length,
                    messageCount:messages.children.length,
                    quickCollapsed:!document.querySelector('.assistant-quick-actions').open,
                    unsafe:document.querySelectorAll(
                      '#assistantMessages script,#assistantMessages iframe,' +
                      '#assistantMessages [onclick],#assistantMessages [onerror]').length
                  };
                })()
                """
            )
            panel = layout["panel"]
            layout_width = layout["viewport"]["clientWidth"]
            self.report.check(
                layout["panelPosition"] == "fixed"
                and panel["left"] >= -1
                and panel["right"] <= layout_width + 1
                and panel["top"] >= -1
                and panel["bottom"] <= height + 1
                and panel["width"] >= min(360, layout_width - 20)
                and panel["height"] >= min(390, height - 24),
                f"{width}x{height} keeps the larger Assistant within the viewport",
                json.dumps(
                    {"panel": panel, "viewport": layout["viewport"]},
                    sort_keys=True,
                    allow_nan=False,
                ),
            )
            self.report.check(
                (
                    layout["messageCount"] == 0
                    or (
                        layout["messagesOverflow"] in {"auto", "scroll"}
                        and layout["messages"]["height"] >= 100
                    )
                )
                and not layout["horizontalOverflow"]
                and layout["unsafe"] == 0,
                f"{width}x{height} keeps the chat timeline scrollable and safe",
                json.dumps(
                    {
                        "messages": layout["messages"],
                        "messageCount": layout["messageCount"],
                        "messagesOverflow": layout["messagesOverflow"],
                        "horizontalOverflow": layout["horizontalOverflow"],
                        "unsafe": layout["unsafe"],
                    },
                    sort_keys=True,
                    allow_nan=False,
                ),
            )
            self.report.check(
                layout["promptCount"] == 3 and layout["quickCollapsed"],
                f"{width}x{height} retains three prompts and demoted quick actions",
            )
            artifacts.append(
                self.capture_screenshot(
                    f"{prefix}-assistant-{width}x{height}",
                    full_page=False,
                )
            )
        self.page.command("Emulation.clearDeviceMetricsOverride")
        return artifacts

    def dashboard_viewport_acceptance(self) -> list[str]:
        artifacts: list[str] = []
        self.ensure_assistant_closed()
        self.set_tier("tier3")
        self.select_section("1081")
        self.wait_js(
            "document.querySelector('#curveChart').getBoundingClientRect().height > 0",
            "Q(t) before responsive QA",
        )
        for width, height in VIEWPORTS:
            self.set_viewport(width, height)
            layout = self.evaluate(
                """
                (() => {
                  const visible = node => getComputedStyle(node).display !== 'none'
                    && node.getBoundingClientRect().width > 0;
                  const header = document.querySelector('.app-header');
                  const map = document.querySelector('#map');
                  const curve = document.querySelector('#curveChart');
                  const curveWrap = document.querySelector('#curveChartWrap');
                  const tiers = document.querySelector('#analysisTierControl');
                  const select = document.querySelector('#tierSelect');
                  return {
                    maroon:getComputedStyle(header).backgroundColor,
                    horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1,
                    viewport:{
                      width:innerWidth,
                      height:innerHeight,
                      clientWidth:document.documentElement.clientWidth,
                      scrollWidth:document.documentElement.scrollWidth
                    },
                    mapWidth:map.getBoundingClientRect().width,
                    mapHeight:map.getBoundingClientRect().height,
                    curveWidth:curve.getBoundingClientRect().width,
                    curveHeight:curve.getBoundingClientRect().height,
                    curveWrapHeight:curveWrap.getBoundingClientRect().height,
                    tiersVisible:visible(tiers), selectVisible:visible(select),
                    checked:document.querySelectorAll(
                      '#analysisTierControl [aria-checked="true"]').length,
                    labels:Array.from(document.querySelectorAll(
                      '#tierMetrics .metric-card > span'), node => node.textContent.trim()),
                    mapReady:map.classList.contains('leaflet-container')
                  };
                })()
                """
            )
            self.report.check(
                layout["maroon"] == "rgb(80, 0, 0)"
                and layout["mapReady"]
                and layout["mapWidth"] > 300
                and layout["mapHeight"] >= 390
                and layout["curveWidth"] > 250
                and layout["curveHeight"] >= 220
                and layout["curveWrapHeight"] >= 250
                and not layout["horizontalOverflow"],
                f"{width}x{height} keeps maroon chrome, map, Q(t), and no overflow",
                json.dumps(layout, sort_keys=True, allow_nan=False),
            )
            self.report.check(
                layout["checked"] == 1
                and layout["labels"] == ["Score", "Minimum", "Loss Area", "Recovery"]
                and (
                    (width <= 700 and not layout["tiersVisible"] and layout["selectVisible"])
                    or (width > 700 and layout["tiersVisible"] and not layout["selectVisible"])
                ),
                f"{width}x{height} uses the correct tier control and four Tier 3 KPIs",
            )
            artifacts.append(
                self.capture_screenshot(
                    f"dashboard-{width}x{height}",
                    full_page=True,
                )
            )
        self.page.command("Emulation.clearDeviceMetricsOverride")
        return artifacts

    def simultaneous_v2_v3_acceptance(self) -> None:
        target_id, second = self.chrome.new_page()
        try:
            for method in ("Page.enable", "Runtime.enable", "Network.enable"):
                second.command(method)
            mark = second.event_mark()
            second.command("Page.navigate", {"url": V2_URL})
            second.wait_event("Page.loadEventFired", mark=mark, timeout=PAGE_READY_TIMEOUT)

            def second_evaluate(expression: str) -> Any:
                result = second.command(
                    "Runtime.evaluate",
                    {
                        "expression": expression,
                        "returnByValue": True,
                        "awaitPromise": True,
                    },
                )
                if "exceptionDetails" in result:
                    raise BrowserQAError("V2 coexistence tab evaluation failed")
                return result.get("result", {}).get("value")

            deadline = time.monotonic() + PAGE_READY_TIMEOUT
            ready = False
            while time.monotonic() < deadline:
                ready = bool(
                    second_evaluate(
                        "document.querySelector('#totalSections')?.textContent.trim() "
                        "=== '10,029' && document.querySelector('#map')?.classList"
                        ".contains('leaflet-container')"
                    )
                )
                if ready:
                    break
                time.sleep(0.1)
            self.report.check(ready, "accepted V2 initializes in a simultaneous tab")
            v2_state = second_evaluate(
                "({url:location.href,hasV2:Boolean(document.querySelector('#layerSelect')),"
                "hasV3:Boolean(document.querySelector('#analysisTierControl'))})"
            )
            v3_state = self.evaluate(
                "({url:location.href,hasV2:Boolean(document.querySelector('#layerSelect')),"
                "hasV3:Boolean(document.querySelector('#analysisTierControl'))})"
            )
            v2_api = [
                event
                for event in second.events_since(mark, "Network.requestWillBeSent")
                if event.get("params", {})
                .get("request", {})
                .get("url", "")
                .startswith(f"{BACKEND_ORIGIN}/api/v1/")
                and event.get("params", {}).get("request", {}).get("method") != "OPTIONS"
            ]
            self.report.check(
                V2_PATH in v2_state["url"]
                and v2_state["hasV2"]
                and not v2_state["hasV3"]
                and V3_PATH in v3_state["url"]
                and v3_state["hasV3"]
                and not v3_state["hasV2"],
                "V2 and V3 remain distinct while open simultaneously",
            )
            self.report.check(
                not v2_api,
                "simultaneous V2 page load sends no automatic Assistant request",
            )
        finally:
            self.chrome.close_page(target_id, second)

    def chat_controller_state(self) -> dict[str, Any]:
        state = self.evaluate(
            """
            (() => {
              try {
                if (typeof assistantChatController === 'undefined'
                    || !assistantChatController) return null;
                return assistantChatController.getState();
              } catch { return null; }
            })()
            """
        )
        if not isinstance(state, dict):
            raise BrowserQAError("The V3 chat controller state is unavailable")
        return state

    def chat_assistant_count(self) -> int:
        return int(
            self.evaluate(
                "document.querySelectorAll("
                "'#assistantMessages [data-result-kind=ai-assisted]').length"
            )
            or 0
        )

    def set_chat_input(self, message: str) -> None:
        self.ensure_assistant_open()
        self.evaluate(
            "(() => { const input = document.querySelector('#assistantInput');"
            f"input.value = {json.dumps(message)};"
            "input.dispatchEvent(new Event('input', {bubbles:true}));"
            "input.focus(); return !input.disabled; })()"
        )
        self.report.check(
            self.evaluate("!document.querySelector('#assistantSend').disabled"),
            "explicit bounded chat input enables Send",
        )

    def latest_assistant_render(self) -> dict[str, Any]:
        rendered = self.evaluate(
            """
            (() => {
              const messages = Array.from(document.querySelectorAll(
                '#assistantMessages [data-result-kind="ai-assisted"]'));
              const node = messages.at(-1);
              if (!node) return null;
              const card = node.querySelector('.assistant-structured-card');
              const text = selector => node.querySelector(selector)?.textContent.trim() || '';
              const texts = selector => Array.from(node.querySelectorAll(selector),
                item => item.textContent.trim());
              const field = name => text(`[data-field="${name}"]`);
              return {
                status: node.dataset.assistantStatus || null,
                source: text('.assistant-chat-source'),
                answer: text('.assistant-chat-answer'),
                clarification: text('.assistant-chat-clarification'),
                structuredType: card?.dataset.structuredResult || null,
                structuredCount: node.querySelectorAll('.assistant-structured-card').length,
                direction: field('direction'),
                metricRankHeaders: texts('th[data-field="metric_rank"]'),
                metricRankCells: texts('td[data-field="metric_rank"]'),
                commonSupport: field('common_support_count'),
                classificationStatus: field('classification_status'),
                consistentCount: field('consistent_count'),
                mismatchCount: field('mismatch_count'),
                representativeExamples: field('representative_examples'),
                countyStatus: {
                  detected: field('status_counts.detected'),
                  no_sustained_drop: field('status_counts.no_sustained_drop'),
                  recovery_endpoint_censored:
                    field('status_counts.recovery_endpoint_censored'),
                  no_observed_support: field('status_counts.no_observed_support')
                },
                countyMetricRows: node.querySelectorAll(
                  '.county-result .metric-summary-table tbody tr').length,
                coverageCaveat: text('.county-result .assistant-result-note'),
                warningTexts: texts('.assistant-chat-warnings li'),
                evidenceCount: node.querySelectorAll('.assistant-chat-evidence-item').length,
                tools: texts('.assistant-chat-tools li'),
                metadata: text('.assistant-chat-metadata'),
                openDetails: node.querySelectorAll('details[open]').length,
                unsafeCount: node.querySelectorAll(
                  'script,img,iframe,object,embed,form,input,textarea,select,a,' +
                  '[onclick],[onerror],[onload],[onmouseover]').length,
                visibleText: node.textContent
              };
            })()
            """
        )
        if not isinstance(rendered, dict):
            raise BrowserQAError("The expected V3 assistant result was not rendered")
        return rendered

    def assert_one_request(
        self,
        mark: int,
        method: str,
        absolute_url: str,
        case_id: str,
    ) -> dict[str, Any]:
        requests = self.api_requests(mark)
        self.report.check(
            len(requests) == 1,
            f"{case_id} sends exactly one reviewed backend request",
            str(len(requests)),
        )
        request = requests[0]
        actual = request.get("request", {})
        self.report.check(
            actual.get("method") == method and actual.get("url") == absolute_url,
            f"{case_id} uses the exact reviewed FastAPI route",
        )
        headers = {key.lower() for key in actual.get("headers", {})}
        self.report.check(
            "authorization" not in headers and "cookie" not in headers,
            f"{case_id} sends no browser credential or API-key header",
        )
        return request

    def response_for(self, request_id: str) -> dict[str, Any]:
        responses = [
            event.get("params", {}).get("response", {})
            for event in self.page.events_since(0, "Network.responseReceived")
            if event.get("params", {}).get("requestId") == request_id
        ]
        if not responses:
            raise BrowserQAError("No browser response was recorded for a reviewed request")
        return responses[-1]

    def response_payload(self, request_id: str) -> dict[str, Any]:
        result = self.page.command(
            "Network.getResponseBody",
            {"requestId": request_id},
            timeout=15,
        )
        raw = result.get("body", "")
        if result.get("base64Encoded"):
            try:
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            except (ValueError, UnicodeDecodeError) as error:
                raise BrowserQAError("A reviewed backend response could not be decoded") from error
        try:
            payload = json.loads(raw)
        except (TypeError, json.JSONDecodeError) as error:
            raise BrowserQAError("A reviewed backend response is not JSON") from error
        if not isinstance(payload, dict):
            raise BrowserQAError("A reviewed backend response is not an object")
        return payload

    @staticmethod
    def _contains_nested_warning_contract(value: Any) -> bool:
        if isinstance(value, dict):
            if any(
                key in value
                for key in ("warnings", "warning_code", "warning_codes", "warning_flag")
            ):
                return True
            return any(
                Phase4ABrowserQA._contains_nested_warning_contract(item) for item in value.values()
            )
        if isinstance(value, list):
            return any(Phase4ABrowserQA._contains_nested_warning_contract(item) for item in value)
        return False

    def assert_request_context(
        self,
        request: dict[str, Any],
        message: str,
        context: dict[str, Any],
        case_id: str,
    ) -> None:
        try:
            body = json.loads(request.get("request", {}).get("postData", "{}"))
        except json.JSONDecodeError as error:
            raise BrowserQAError("The V3 assistant request body is not JSON") from error
        self.report.check(
            isinstance(body, dict)
            and set(body).issubset(ALLOWED_REQUEST_FIELDS)
            and body.get("message") == message
            and body.get("assistant_profile") == "v3",
            f"{case_id} sends the bounded V3 profile contract",
        )
        layer = context.get("activeAnalysisLayer")
        expected_metric = EXPECTED_LAYER_METRICS.get(str(layer))
        self.report.check(
            layer in EXPECTED_LAYER_METRICS
            and body.get("active_analysis_layer") == layer
            and context.get("activeMetric") == expected_metric
            and body.get("active_metric") == expected_metric,
            f"{case_id} sends the exact host-owned tier and source metric",
        )
        selected = context.get("selectedSectionId")
        self.report.check(
            (selected is None and "selected_section_id" not in body)
            or body.get("selected_section_id") == f"CS_{selected}",
            f"{case_id} sends only the current selected-section context",
        )
        history = body.get("history", [])
        self.report.check(
            isinstance(history, list)
            and len(history) <= 4
            and all(
                isinstance(item, dict)
                and set(item) == {"role", "content"}
                and item.get("role") in {"user", "assistant"}
                and isinstance(item.get("content"), str)
                and 0 < len(item["content"]) <= 1000
                for item in history
            ),
            f"{case_id} keeps chat history bounded and text-only",
        )

    def assert_common_response(
        self,
        payload: dict[str, Any],
        rendered: dict[str, Any],
        case_id: str,
        *,
        expected_status: str,
        expected_intent: str,
        expected_tool: str,
        expected_structured: str | None,
        expected_warnings: list[str],
        expected_evidence_count: int,
    ) -> None:
        tools = payload.get("tools_used", [])
        warnings = payload.get("warnings", [])
        evidence = payload.get("evidence", [])
        warning_codes = [item.get("code") for item in warnings if isinstance(item, dict)]
        self.report.check(
            payload.get("status") == expected_status
            and payload.get("intent") == expected_intent
            and isinstance(tools, list)
            and len(tools) == 1
            and tools[0].get("tool_name") == expected_tool,
            f"{case_id} selects the expected reviewed tool and response status",
        )
        self.report.check(
            payload.get("data_release") == EXPECTED_RELEASE
            and payload.get("method_version") == EXPECTED_METHOD
            and rendered["status"] == expected_status
            and EXPECTED_RELEASE in rendered["metadata"]
            and EXPECTED_METHOD in rendered["metadata"],
            f"{case_id} preserves reviewed release and method provenance",
        )
        self.report.check(
            warning_codes == expected_warnings
            and len(rendered["warningTexts"]) == len(expected_warnings)
            and all(
                code in text
                for code, text in zip(
                    expected_warnings,
                    rendered["warningTexts"],
                    strict=True,
                )
            )
            and all(
                isinstance(item, dict)
                and set(item).issubset({"code", "severity", "message", "section_id"})
                and item.get("severity") in {"info", "caution"}
                for item in warnings
            ),
            f"{case_id} renders the exact authoritative top-level warnings",
        )
        self.report.check(
            isinstance(evidence, list)
            and len(evidence) == expected_evidence_count
            and rendered["evidenceCount"] == expected_evidence_count,
            f"{case_id} preserves deterministic evidence cardinality",
        )
        self.report.check(
            not self._contains_nested_warning_contract(payload.get("structured_result"))
            and not self._contains_nested_warning_contract(evidence)
            and not self._contains_nested_warning_contract(tools),
            f"{case_id} exposes warnings only through the top-level array",
        )
        self.report.check(
            rendered["structuredType"] == expected_structured
            and rendered["structuredCount"] == (1 if expected_structured else 0),
            f"{case_id} renders the expected strict structured-result shape",
        )
        visible = str(rendered["visibleText"])
        self.report.check(
            rendered["unsafeCount"] == 0
            and RAW_JSON.search(visible) is None
            and FORBIDDEN_VISIBLE.search(visible) is None
            and UNSUPPORTED_AFFIRMATIVE_CLAIM.search(str(rendered["answer"])) is None,
            f"{case_id} renders text safely without raw JSON or internal branding",
        )
        self.report.check(
            rendered["openDetails"] == 0,
            f"{case_id} keeps secondary evidence details collapsed initially",
        )

    def assert_ranking_result(
        self,
        payload: dict[str, Any],
        rendered: dict[str, Any],
    ) -> None:
        result = payload.get("structured_result", {})
        expected = self.evaluate(
            """
            (() => {
              const rows = mapData.features.map(feature => feature.properties || {})
                .map(props => ({
                  id: String(props.CTRL_SECT_NORM ?? props.CTRL_SECT_ ?? '')
                    .replace(/^CS_/, ''),
                  raw: props.observed_curve_resilience_score_v0,
                  value: Number(props.observed_curve_resilience_score_v0)
                }))
                .filter(row => row.raw !== null && row.raw !== undefined && row.raw !== ''
                  && /^[1-9][0-9]*$/.test(row.id) && Number.isFinite(row.value));
              const rank = (items, descending) => {
                const ordered = [...items].sort((left, right) => {
                  const delta = descending ? right.value - left.value : left.value - right.value;
                  return delta || Number(left.id) - Number(right.id);
                });
                const metricRanks = new Map();
                ordered.forEach(row => {
                  if (!metricRanks.has(row.value)) metricRanks.set(row.value, metricRanks.size + 1);
                });
                return ordered.slice(0, 10).map(row => ({
                  section_id: `CS_${row.id}`,
                  value: row.value,
                  metric_rank: metricRanks.get(row.value)
                }));
              };
              const values = rows.map(row => row.value).sort((a, b) => a - b);
              const median = values.length % 2
                ? values[(values.length - 1) / 2]
                : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
              return {
                population_count: mapData.features.length,
                available_count: values.length,
                missing_count: mapData.features.length - values.length,
                minimum: values[0], median, maximum: values.at(-1),
                highest: rank(rows, true), lowest: rank(rows, false)
              };
            })()
            """
        )
        distribution = result.get("distribution", {})
        self.report.check(
            result.get("result_type") == "section_ranking"
            and result.get("metric", {}).get("metric") == "tier3_observed_resilience"
            and result.get("direction") == "descending"
            and result.get("limit_per_tail") == 10
            and result.get("county") is None,
            "ranking structured result states its metric, scope, direction, and bound",
        )
        self.report.check(
            all(
                distribution.get(key) == expected[key]
                for key in ("population_count", "available_count", "missing_count")
            )
            and all(
                math.isclose(
                    float(distribution[key]),
                    float(expected[key]),
                    abs_tol=FRONTEND_METRIC_ABS_TOLERANCE,
                )
                for key in ("minimum", "median", "maximum")
            ),
            "ranking distribution matches the loaded accepted release",
        )
        for name, expected_name in (
            ("highest_sections", "highest"),
            ("lowest_sections", "lowest"),
        ):
            rows = result.get(name, [])
            expected_rows = expected[expected_name]
            self.report.check(
                len(rows) == len(expected_rows) == 10
                and all(
                    row.get("section_id") == anchor["section_id"]
                    and row.get("metric_rank") == anchor["metric_rank"]
                    and math.isclose(
                        float(row.get("value")),
                        anchor["value"],
                        abs_tol=FRONTEND_METRIC_ABS_TOLERANCE,
                    )
                    for row, anchor in zip(rows, expected_rows, strict=True)
                ),
                f"ranking {name} rows match deterministic release ordering and metric ranks",
            )
        expected_ranks = [
            str(row["metric_rank"])
            for name in ("highest_sections", "lowest_sections")
            for row in result[name]
        ]
        self.report.check(
            "descending" in rendered["direction"].lower()
            and rendered["metricRankHeaders"] == ["Rank", "Rank"]
            and rendered["metricRankCells"] == expected_ranks,
            "ranking visibly renders the explicit direction and actual metric_rank values",
        )

    def assert_alignment_result(
        self,
        payload: dict[str, Any],
        rendered: dict[str, Any],
    ) -> None:
        result = payload.get("structured_result", {})
        self.report.check(
            result.get("classification_status") == "method_definition_required"
            and result.get("statewide_section_count") == 10029
            and result.get("common_support_count") == 3842
            and result.get("valid_pair_count") == 3473
            and result.get("missing_pair_count_within_common_support") == 369
            and result.get("excluded_no_support_count") == 6187
            and result.get("alignment_definition") is None
            and result.get("consistent_count") is None
            and result.get("mismatch_count") is None
            and result.get("category_counts") is None
            and result.get("representative_examples") is None,
            "alignment keeps exact common-support counts and blocks undefined classification",
        )
        self.report.check(
            "3842" in rendered["commonSupport"].replace(",", "")
            and "method definition required" in rendered["classificationStatus"].lower()
            and all(
                "not defined" in rendered[field].lower()
                for field in (
                    "consistentCount",
                    "mismatchCount",
                    "representativeExamples",
                )
            ),
            "alignment visibly states its denominator and unresolved classification fields",
        )
        answer = str(rendered["answer"]).lower()
        self.report.check(
            "planning" in answer and "observed" in answer,
            "alignment distinguishes planning context from observed operational evidence",
        )

    def assert_county_result(
        self,
        payload: dict[str, Any],
        rendered: dict[str, Any],
    ) -> None:
        result = payload.get("structured_result", {})
        counts = result.get("status_counts", {})
        self.report.check(
            result.get("county") == "Dallas"
            and result.get("total_sections") == 58
            and result.get("observed_support_count") == 56
            and math.isclose(
                float(result.get("observed_support_percent")),
                96.55172413793103,
                abs_tol=1e-12,
            )
            and counts
            == {
                "detected": 56,
                "no_sustained_drop": 0,
                "recovery_endpoint_censored": 0,
                "no_observed_support": 2,
            },
            "Dallas structured result matches accepted support and all status denominators",
        )
        summaries = result.get("metric_summaries", [])
        self.report.check(
            len(summaries) == 4
            and [item.get("metric", {}).get("metric") for item in summaries]
            == [
                "tier1_weather",
                "tier2_network",
                "potential_resilience",
                "tier3_observed_resilience",
            ]
            and summaries[-1].get("distribution", {}).get("available_count") == 56
            and summaries[-1].get("distribution", {}).get("missing_count") == 2,
            "Dallas returns all four tier summaries with explicit Tier 3 coverage",
        )
        self.report.check(
            [item.get("section_id") for item in result.get("representative_high_observed", [])]
            == ["CS_8372", "CS_584428", "CS_9166"]
            and [item.get("section_id") for item in result.get("representative_low_observed", [])]
            == ["CS_555009", "CS_584425", "CS_555560"],
            "Dallas representative sections match deterministic release anchors",
        )
        visible_counts = rendered["countyStatus"]
        self.report.check(
            rendered["countyMetricRows"] == 4
            and all(str(counts[key]) in visible_counts[key] for key in counts)
            and "56 of 58" in rendered["coverageCaveat"]
            and "support" in rendered["coverageCaveat"].lower(),
            "Dallas card visibly renders four statuses, four tiers, and coverage caveat",
        )
        answer = str(rendered["answer"]).lower()
        self.report.check(
            "planning" in answer and "observed" in answer,
            "Dallas explanation distinguishes planning and observed evidence",
        )

    def submit_live_case(
        self,
        *,
        case_id: str,
        message: str,
        expected_status: str,
        expected_intent: str,
        expected_tool: str,
        expected_structured: str | None,
        expected_warnings: list[str],
        expected_evidence_count: int,
        suggestion_index: int | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        self.ensure_assistant_open()
        context = self.chat_controller_state()
        before = self.chat_assistant_count()
        mark = self.page.event_mark()
        started = time.perf_counter()
        if suggestion_index is None:
            self.set_chat_input(message)
            self.click("#assistantSend")
        else:
            selector = (
                "#assistantSuggestedQuestions "
                f"[data-assistant-question]:nth-child({suggestion_index + 1})"
            )
            supplied = self.evaluate(
                f"document.querySelector({json.dumps(selector)})"
                ".getAttribute('data-assistant-question')"
            )
            self.report.check(
                supplied == message,
                f"{case_id} demo button contains the reviewed prompt",
            )
            self.click(selector)
        self.wait_js(
            "document.querySelector('#assistantAgent').getAttribute('aria-busy') === 'true' "
            "|| document.querySelectorAll("
            "'#assistantMessages [data-result-kind=ai-assisted]').length > "
            f"{before}",
            f"{case_id} explicit request start",
            5,
        )
        self.wait_js(
            "document.querySelector('#assistantAgent').getAttribute('aria-busy') === 'false' "
            "&& document.querySelectorAll("
            "'#assistantMessages [data-result-kind=ai-assisted]').length > "
            f"{before}",
            f"{case_id} live Qwen response",
            MODEL_RESPONSE_TIMEOUT,
        )
        latency = round(time.perf_counter() - started, 3)
        request = self.assert_one_request(
            mark,
            "POST",
            ASSISTANT_QUERY_URL,
            case_id,
        )
        self.assert_request_context(request, message, context, case_id)
        response = self.response_for(request["requestId"])
        headers = {key.lower(): value for key, value in response.get("headers", {}).items()}
        self.report.check(
            int(response.get("status", 0)) == 200
            and headers.get("access-control-allow-origin") == FRONTEND_ORIGIN,
            f"{case_id} receives reviewed localhost CORS and HTTP status",
        )
        payload = self.response_payload(request["requestId"])
        rendered = self.latest_assistant_render()
        self.assert_common_response(
            payload,
            rendered,
            case_id,
            expected_status=expected_status,
            expected_intent=expected_intent,
            expected_tool=expected_tool,
            expected_structured=expected_structured,
            expected_warnings=expected_warnings,
            expected_evidence_count=expected_evidence_count,
        )
        if expected_structured == "section_ranking":
            self.assert_ranking_result(payload, rendered)
        elif expected_structured == "tier_alignment_summary":
            self.assert_alignment_result(payload, rendered)
        elif expected_structured == "county_resilience_summary":
            self.assert_county_result(payload, rendered)
        if case_id == "concept":
            evidence = payload.get("evidence", [])
            self.report.check(
                evidence[0].get("kind") == "project_concept"
                and evidence[0].get("section_id") is None
                and evidence[0].get("metric_name") is None
                and payload.get("structured_result") is None,
                "project concept uses reviewed deterministic knowledge without a section",
            )
        if case_id == "safety":
            self.report.check(
                payload.get("structured_result") is None
                and payload.get("evidence") == []
                and payload.get("warnings") == [],
                "unsupported investment request is declined without invented evidence",
            )
        tool_name = (
            tools[0].get("tool_name")
            if (isinstance((tools := payload.get("tools_used")), list) and tools)
            else None
        )
        self.prompt_results.append(
            PromptResult(
                case_id=case_id,
                status=str(payload.get("status")),
                intent=payload.get("intent"),
                tool_name=tool_name,
                structured_type=rendered["structuredType"],
                latency_seconds=latency,
            )
        )
        return payload, rendered

    def live_prompt_acceptance(self) -> None:
        cases = (
            {
                "case_id": "safety",
                "layer": "tier1",
                "message": "Which road should TxDOT rebuild first?",
                "expected_status": "unsupported_request",
                "expected_intent": "decline_unsupported_request",
                "expected_tool": "decline_unsupported_request",
                "expected_structured": None,
                "expected_warnings": [],
                "expected_evidence_count": 0,
            },
            {
                "case_id": "concept",
                "layer": "potential",
                "message": "What is Potential Resilience?",
                "expected_status": "completed",
                "expected_intent": "explain_project_concept",
                "expected_tool": "explain_project_concept",
                "expected_structured": None,
                "expected_warnings": [],
                "expected_evidence_count": 1,
            },
            {
                "case_id": "ranking",
                "layer": "tier3",
                "message": "Rank control sections by Tier 3 observed resilience.",
                "expected_status": "completed",
                "expected_intent": "rank_sections",
                "expected_tool": "rank_sections",
                "expected_structured": "section_ranking",
                "expected_warnings": ["PARTIAL_OBSERVED_COVERAGE", "METHOD_SCOPE"],
                "expected_evidence_count": 0,
                "suggestion_index": 0,
            },
            {
                "case_id": "alignment",
                "layer": "potential",
                "message": (
                    "How consistent are Potential Resilience and Tier 3 Observed "
                    "Resilience? Show counts and examples of mismatches."
                ),
                "expected_status": "completed",
                "expected_intent": "summarize_tier_alignment",
                "expected_tool": "summarize_tier_alignment",
                "expected_structured": "tier_alignment_summary",
                "expected_warnings": ["METHOD_DEFINITION_REQUIRED", "METHOD_SCOPE"],
                "expected_evidence_count": 0,
                "suggestion_index": 1,
            },
            {
                "case_id": "dallas",
                "layer": "tier2",
                "message": ("How did roadway sections in Dallas County perform during this event?"),
                "expected_status": "completed",
                "expected_intent": "summarize_county_resilience",
                "expected_tool": "summarize_county_resilience",
                "expected_structured": "county_resilience_summary",
                "expected_warnings": ["PARTIAL_OBSERVED_COVERAGE", "METHOD_SCOPE"],
                "expected_evidence_count": 0,
                "suggestion_index": 2,
            },
        )
        for case in cases:
            layer = str(case.pop("layer"))
            self.set_tier(layer)
            self.submit_live_case(**case)
        self.report.check(
            all(
                result.status in {"completed", "unsupported_request"}
                for result in self.prompt_results
            )
            and all(result.tool_name is not None for result in self.prompt_results),
            "all five live workflows satisfy tool/control selection gates",
        )

    def wait_for_paused_query(self, mark: int) -> dict[str, Any]:
        """Continue a CORS preflight and return only the intercepted POST."""

        deadline = time.monotonic() + 10
        handled_options: set[str] = set()
        while time.monotonic() < deadline:
            for event in self.page.events_since(mark, "Fetch.requestPaused"):
                params = event.get("params", {})
                request = params.get("request", {})
                if request.get("url") != ASSISTANT_QUERY_URL:
                    continue
                request_id = params.get("requestId")
                if request.get("method") == "POST":
                    return params
                if (
                    request.get("method") == "OPTIONS"
                    and isinstance(request_id, str)
                    and request_id not in handled_options
                ):
                    handled_options.add(request_id)
                    self.page.command(
                        "Fetch.continueRequest",
                        {"requestId": request_id},
                    )
            time.sleep(0.05)
        raise BrowserQAError("Timed out waiting for an intercepted Assistant POST")

    def cancellation_and_stale_acceptance(self) -> None:
        self.ensure_assistant_open()
        self.page.command(
            "Fetch.enable",
            {"patterns": [{"urlPattern": ASSISTANT_QUERY_URL, "requestStage": "Request"}]},
        )
        try:
            # Explicit cancellation: the paused request cannot reach the model.
            before = self.chat_assistant_count()
            mark = self.page.event_mark()
            self.set_chat_input("What is Q(t)?")
            self.click("#assistantSend")
            paused = self.wait_for_paused_query(mark)
            loading = self.evaluate(
                "({busy:document.querySelector('#assistantAgent').getAttribute('aria-busy'),"
                "inputDisabled:document.querySelector('#assistantInput').disabled,"
                "sendDisabled:document.querySelector('#assistantSend').disabled,"
                "cancelHidden:document.querySelector('#assistantCancel').hidden,"
                "cancelDisabled:document.querySelector('#assistantCancel').disabled})"
            )
            self.report.check(
                loading
                == {
                    "busy": "true",
                    "inputDisabled": True,
                    "sendDisabled": True,
                    "cancelHidden": False,
                    "cancelDisabled": False,
                },
                "pending Assistant request exposes one bounded cancellable state",
            )
            self.click("#assistantSend")
            time.sleep(0.2)
            self.report.check(
                len(self.query_requests(mark)) == 1,
                "disabled Send prevents duplicate Assistant submission",
            )
            self.click("#assistantCancel")
            self.wait_js(
                "assistantChatController.getState().pending === false "
                "&& document.querySelector('#assistantChatStatus').textContent"
                ".toLowerCase().includes('cancelled')",
                "explicit Assistant cancellation",
            )
            with suppress(BrowserQAError):
                self.page.command(
                    "Fetch.failRequest",
                    {"requestId": paused["requestId"], "errorReason": "Aborted"},
                    timeout=3,
                )
            time.sleep(0.25)
            self.report.check(
                self.chat_assistant_count() == before and len(self.query_requests(mark)) == 1,
                "cancelled request adds no assistant result or second request",
            )

            # Context staleness: a host-owned tier change aborts the paused request.
            self.set_tier("tier3")
            before = self.chat_assistant_count()
            mark = self.page.event_mark()
            self.set_chat_input("What is Tier 3?")
            self.click("#assistantSend")
            paused = self.wait_for_paused_query(mark)
            self.set_tier("tier1")
            with suppress(BrowserQAError):
                self.page.command(
                    "Fetch.failRequest",
                    {"requestId": paused["requestId"], "errorReason": "Aborted"},
                    timeout=3,
                )
            time.sleep(0.25)
            state = self.chat_controller_state()
            self.report.check(
                self.chat_assistant_count() == before
                and state.get("pending") is False
                and state.get("activeAnalysisLayer") == "tier1"
                and state.get("activeMetric") == "weather_rei"
                and len(self.query_requests(mark)) == 1,
                "tier change prevents a stale assistant result from rendering",
            )
        finally:
            with suppress(BrowserQAError):
                self.page.command("Fetch.disable", timeout=3)

    def fixed_actions_acceptance(self) -> None:
        self.ensure_assistant_open()
        self.set_tier("tier3")
        self.select_section("1081")
        self.evaluate("document.querySelector('.assistant-quick-actions').open = true")
        cases = (
            (
                "#assistantExplainSection",
                "GET",
                f"{BACKEND_ORIGIN}/api/v1/sections/1081",
                "fixed section explanation",
            ),
            (
                "#assistantExplainMetric",
                "GET",
                f"{BACKEND_ORIGIN}/api/v1/metrics/observed_curve_resilience_score_v0",
                "fixed metric explanation",
            ),
            (
                "#assistantGenerateReviewNote",
                "POST",
                f"{BACKEND_ORIGIN}/api/v1/reports/review-note",
                "fixed review note",
            ),
        )
        for selector, method, url, case_id in cases:
            before = int(
                self.evaluate(
                    "document.querySelectorAll("
                    "'#assistantMessages [data-result-kind=verified]').length"
                )
                or 0
            )
            mark = self.page.event_mark()
            self.click(selector)
            self.wait_js(
                "document.querySelectorAll("
                "'#assistantMessages [data-result-kind=verified]').length > "
                f"{before} && document.querySelector('#assistantMessages')"
                ".getAttribute('data-action-busy') !== 'true'",
                case_id,
                30,
            )
            self.assert_one_request(mark, method, url, case_id)
            self.report.check(
                not self.query_requests(mark),
                f"{case_id} remains outside the LLM path",
            )
            latest = self.evaluate(
                "Array.from(document.querySelectorAll("
                "'#assistantMessages [data-result-kind=verified]')).at(-1).textContent"
            )
            self.report.check(
                isinstance(latest, str)
                and FORBIDDEN_VISIBLE.search(latest) is None
                and RAW_JSON.search(latest) is None,
                f"{case_id} renders bounded public deterministic text",
            )

    def map_interaction_acceptance(self) -> None:
        mark = self.page.event_mark()
        initial_zoom = self.evaluate("map.getZoom()")
        self.evaluate(
            "map.panBy([24, 0], {animate:false}); "
            "map.setZoom(Math.min(map.getMaxZoom(), map.getZoom() + 1), {animate:false}); "
            "true;"
        )
        self.wait_js(
            f"map.getZoom() >= {int(initial_zoom)}",
            "explicit map pan and zoom",
        )
        time.sleep(0.25)
        self.report.check(
            not self.api_requests(mark),
            "map pan and zoom send no automatic Assistant request",
        )

    def timeline_text_for_public_label_check(self) -> str:
        """Default public-label scope; later reviewed technical UI may specialize it."""
        return self.evaluate(
            "Array.from(document.querySelectorAll('#assistantMessages > *'), "
            "node => node.textContent).join('\\n')"
        )

    def final_console_network_acceptance(self) -> dict[str, int]:
        exceptions = self.page.events_since(self.console_mark, "Runtime.exceptionThrown")
        console_errors = [
            event
            for event in self.page.events_since(self.console_mark, "Runtime.consoleAPICalled")
            if event.get("params", {}).get("type") == "error"
        ]
        log_errors = [
            event
            for event in self.page.events_since(self.console_mark, "Log.entryAdded")
            if event.get("params", {}).get("entry", {}).get("level") == "error"
            and not str(event.get("params", {}).get("entry", {}).get("url", "")).startswith(
                ASSISTANT_QUERY_URL
            )
        ]
        console_detail = {
            "exceptions": [
                {
                    "text": event.get("params", {}).get("exceptionDetails", {}).get("text"),
                    "description": event.get("params", {})
                    .get("exceptionDetails", {})
                    .get("exception", {})
                    .get("description"),
                    "url": event.get("params", {}).get("exceptionDetails", {}).get("url"),
                }
                for event in exceptions
            ],
            "console_errors": [
                {
                    "args": [
                        argument.get("value", argument.get("description"))
                        for argument in event.get("params", {}).get("args", [])
                    ]
                }
                for event in console_errors
            ],
            "log_errors": [
                {
                    "source": event.get("params", {}).get("entry", {}).get("source"),
                    "text": event.get("params", {}).get("entry", {}).get("text"),
                    "url": event.get("params", {}).get("entry", {}).get("url"),
                }
                for event in log_errors
            ],
        }
        self.report.check(
            not exceptions and not console_errors and not log_errors,
            "production V3 records no uncaught or console application errors",
            json.dumps(console_detail, sort_keys=True, allow_nan=False),
        )
        requests = self.all_requests(0)
        urls = [item.get("request", {}).get("url", "") for item in requests]
        websocket_urls = self.websocket_urls(0)
        direct_ollama = [url for url in [*urls, *websocket_urls] if DIRECT_OLLAMA.match(url)]
        self.report.check(
            not direct_ollama,
            "browser never contacts Ollama or port 11434 directly",
        )
        allowed_api = re.compile(
            rf"^{re.escape(BACKEND_ORIGIN)}/api/v1/(?:assistant/query|"
            r"sections/[1-9][0-9]*|metrics/[a-z0-9_]+|reports/review-note"
            + "".join("|" + re.escape(route) for route in self.additional_reviewed_api_routes)
            + r")$"
        )
        api = [
            item
            for item in requests
            if item.get("request", {}).get("url", "").startswith(f"{BACKEND_ORIGIN}/api/v1/")
        ]
        self.report.check(
            all(allowed_api.fullmatch(item.get("request", {}).get("url", "")) for item in api)
            and not any("/health" in url for url in urls),
            "browser contacts only reviewed FastAPI routes and performs no health probe",
        )
        self.report.check(
            all(
                not (
                    {key.lower() for key in item.get("request", {}).get("headers", {})}
                    & {"authorization", "cookie", "x-api-key"}
                )
                for item in api
            ),
            "browser sends no API keys, authorization headers, or cookies",
        )
        output = self.timeline_text_for_public_label_check()
        self.report.check(
            FORBIDDEN_VISIBLE.search(output) is None
            and RAW_JSON.search(output) is None
            and self.evaluate(
                "document.querySelectorAll("
                "'#assistantMessages script,#assistantMessages iframe,' +"
                "'#assistantMessages [onclick],#assistantMessages [onerror]').length"
            )
            == 0,
            "complete Assistant timeline remains safe public DOM text",
        )
        return {
            "assistant_query_requests": len(self.query_requests(0)),
            "page_load_api_requests": self.page_load_api_count,
            "direct_browser_ollama_requests": len(direct_ollama),
            "console_error_count": len(console_errors) + len(log_errors),
            "uncaught_exception_count": len(exceptions),
        }


def verify_frontends_available() -> None:
    """Confirm both production pages are served without exercising Assistant APIs."""

    for url, marker in (
        (f"{FRONTEND_ORIGIN}{V3_PATH}", "analysisTierControl"),
        (f"{FRONTEND_ORIGIN}{V2_PATH}", "layerSelect"),
    ):
        try:
            request = urllib.request.Request(url, headers={"Connection": "close"})
            with urllib.request.urlopen(request, timeout=10) as response:
                body = response.read().decode("utf-8")
                if response.status != 200 or marker not in body:
                    raise BrowserQAError("A required production frontend is not ready")
        except (OSError, UnicodeDecodeError, urllib.error.URLError) as error:
            raise BrowserQAError("A required production frontend is not ready") from error


def verify_live_backend() -> None:
    """Check deterministic release availability before a requested live scenario."""

    try:
        health = read_json(f"{BACKEND_ORIGIN}/health")
    except (OSError, ValueError, urllib.error.URLError) as error:
        raise BrowserQAError("The reviewed FastAPI backend is not ready") from error
    if not (
        isinstance(health, dict)
        and health.get("status") == "ok"
        and health.get("snapshot_loaded") is True
        and health.get("curve_snapshot_loaded") is True
        and health.get("data_release") == EXPECTED_RELEASE
        and health.get("method_version") == EXPECTED_METHOD
    ):
        raise BrowserQAError("The reviewed FastAPI release health contract is not ready")


def create_artifact_directory(base: Path) -> Path:
    """Create a new non-overwriting run folder beneath the explicit destination."""

    root = base.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    run_name = (
        "phase4a-browser-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8]
    )
    destination = root / run_name
    destination.mkdir(exist_ok=False)
    return destination


def latency_summary(results: list[PromptResult]) -> dict[str, float | int | None]:
    values = sorted(result.latency_seconds for result in results)
    if not values:
        return {"count": 0, "median_seconds": None, "p95_seconds": None}
    return {
        "count": len(values),
        "median_seconds": round(statistics.median(values), 3),
        "p95_seconds": round(values[max(0, math.ceil(0.95 * len(values)) - 1)], 3),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        choices=("ui", "live"),
        default="ui",
        help=(
            "ui checks production V2/V3 UI without an Assistant request; live also "
            "requires the reviewed assistant-enabled backend and pre-warmed qwen3:8b"
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="parent directory for a new per-run screenshot artifact folder",
    )
    parser.add_argument(
        "--chrome",
        type=Path,
        help="explicit installed Chrome executable",
    )
    parser.add_argument(
        "--isolated-profile",
        type=Path,
        help=(
            "attach only to an existing sptc-phase4a-cdp-* profile directly under "
            "the OS temporary directory"
        ),
    )
    return parser.parse_args()


def sanitized_error(error: BaseException) -> str:
    message = str(error).replace("\r", " ").replace("\n", " ")[:500]
    message = re.sub(r"[A-Za-z]:\\[^\s]+", "[local-path]", message)
    message = re.sub(r"(?:https?|wss?)://[^\s]+", "[local-url]", message)
    return message


def run_stage(name: str, callback: Callable[[], Any]) -> Any:
    """Attach one bounded acceptance-stage label to browser failures."""

    try:
        return callback()
    except BrowserQAError as error:
        raise BrowserQAError(f"{name}: {error}") from error


def main() -> int:
    args = parse_args()
    verify_frontends_available()
    if args.scenario == "live":
        verify_live_backend()
    artifact_directory = create_artifact_directory(args.output_dir)
    report = QAReport()
    qa: Phase4ABrowserQA | None = None
    artifact_names: list[str] = []
    network_summary: dict[str, int] = {}
    with IsolatedChrome(args.chrome, args.isolated_profile) as chrome:
        qa = Phase4ABrowserQA(chrome, report, artifact_directory)
        run_stage("initial UI", qa.initial_ui_acceptance)
        run_stage("V2/V3 coexistence", qa.simultaneous_v2_v3_acceptance)
        if args.scenario == "live":
            run_stage("live prompts", qa.live_prompt_acceptance)
            artifact_names.extend(
                run_stage(
                    "assistant viewports",
                    lambda: qa.assistant_viewport_acceptance("live-structured"),
                )
            )
            run_stage("cancellation and staleness", qa.cancellation_and_stale_acceptance)
            run_stage("fixed actions", qa.fixed_actions_acceptance)
        else:
            artifact_names.extend(
                run_stage(
                    "assistant viewports",
                    lambda: qa.assistant_viewport_acceptance("ui"),
                )
            )
        run_stage("tier synchronization", qa.tier_synchronization_acceptance)
        run_stage("warning states", qa.warning_state_acceptance)
        run_stage("map interaction", qa.map_interaction_acceptance)
        artifact_names.extend(run_stage("dashboard viewports", qa.dashboard_viewport_acceptance))
        network_summary = run_stage(
            "console and network",
            qa.final_console_network_acceptance,
        )
    if qa is None:  # pragma: no cover - defensive ownership guard
        raise BrowserQAError("Phase 4A browser QA did not initialize")

    for result in qa.prompt_results:
        print(
            "CASE " + json.dumps(asdict(result), sort_keys=True, ensure_ascii=True, allow_nan=False)
        )
    latencies = latency_summary(qa.prompt_results)
    print("LATENCY " + json.dumps(latencies, sort_keys=True, allow_nan=False))
    summary = {
        "scenario": args.scenario,
        "checks": len(report.checks),
        "prompt_cases": len(qa.prompt_results),
        "tool_control_selection_rate": 1.0 if qa.prompt_results else None,
        "warning_consistency_rate": 1.0 if qa.prompt_results else None,
        "evidence_consistency_rate": 1.0 if qa.prompt_results else None,
        "successful_latency_median_seconds": latencies["median_seconds"],
        "successful_latency_p95_seconds": latencies["p95_seconds"],
        "viewport_count": len(VIEWPORTS),
        "screenshots": sorted(artifact_names),
        "artifact_run": artifact_directory.name,
        **network_summary,
        "overall_pass": True,
    }
    print("SUMMARY " + json.dumps(summary, sort_keys=True, allow_nan=False))
    print("Phase 4A isolated production-page browser QA passed.")
    print("Isolated Chrome closed; temporary profile removed.")
    return 0


# V3 has no runtime dependency on V2 or an earlier phase's harness.
if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrowserQAError as error:
        print("ERROR: " + sanitized_error(error))
        raise SystemExit(1) from None
