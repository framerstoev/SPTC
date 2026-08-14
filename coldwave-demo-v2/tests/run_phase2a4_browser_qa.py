"""Run isolated Chrome acceptance QA against the real Phase 2A4 application.

The frontend must already be served from ``127.0.0.1:8001``.  The ``live``
and ``full`` scenarios also require the accepted deterministic backend on
``127.0.0.1:8080``.  The ``unavailable`` scenario expects that backend to be
stopped.

This harness deliberately does not use Selenium, Playwright, a test-only HTML
page, or a normal browser profile.  It requires that no Chrome process is
running, starts the installed Chrome binary with a GUID-named temporary
profile, drives the production page through the Chrome DevTools Protocol, and
closes the browser before removing the profile.
"""

from __future__ import annotations

import argparse
import json
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

try:
    import websocket
except ImportError as error:  # pragma: no cover - host capability guard
    raise SystemExit(
        "websocket-client is required for isolated CDP QA; do not install it "
        "without review. The audited base Python environment already provides it."
    ) from error


FRONTEND_ORIGIN = "http://127.0.0.1:8001"
BACKEND_ORIGIN = "http://127.0.0.1:8080"
APP_PATH = "/coldwave-demo-v2/"
LOCAL_URL = f"{FRONTEND_ORIGIN}{APP_PATH}"
BACKEND_TOOLS_URL = f"{LOCAL_URL}?assistantMode=backend-tools"
CHROME_CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
)
PAGE_READY_TIMEOUT = 60.0
ACTION_TIMEOUT = 20.0


class BrowserQAError(RuntimeError):
    """Raised for a failed browser acceptance assertion."""


@dataclass
class QAReport:
    checks: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def check(self, condition: bool, name: str, detail: str = "") -> None:
        if not condition:
            suffix = f": {detail}" if detail else ""
            raise BrowserQAError(f"FAILED {name}{suffix}")
        self.checks.append(name)

    def note(self, message: str) -> None:
        self.notes.append(message)


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
                f"CDP {method} failed: {response['error'].get('message', response['error'])}"
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
                    raise BrowserQAError(
                        f"CDP receiver failed while waiting for {method}: "
                        f"{self._receiver_error}"
                    )
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise BrowserQAError(f"Timed out waiting for CDP event {method}")
                self._event_condition.wait(timeout=min(remaining, 0.25))

    def close(self) -> None:
        self._closed = True
        try:
            self._socket.close()
        except Exception:
            pass
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
    """Own an isolated headless Chrome profile and its CDP connections."""

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
        self._launcher_pid: int | None = None
        self.browser: CDPConnection | None = None
        self.page: CDPConnection | None = None

    def _connect_profile(self, profile: Path) -> None:
        port_file = profile / "DevToolsActivePort"
        deadline = time.monotonic() + 20
        while not port_file.is_file() and time.monotonic() < deadline:
            time.sleep(0.1)
        if not port_file.is_file():
            raise BrowserQAError(
                "Chrome did not create DevToolsActivePort for its isolated profile"
            )
        port_lines = port_file.read_text(encoding="utf-8").splitlines()
        if not port_lines or not port_lines[0].isdigit():
            raise BrowserQAError("Chrome returned an invalid DevToolsActivePort file")
        debugging_port = int(port_lines[0])
        version = read_json(f"http://127.0.0.1:{debugging_port}/json/version")
        self.browser = CDPConnection(version["webSocketDebuggerUrl"])
        targets = read_json(f"http://127.0.0.1:{debugging_port}/json/list")
        target = next((item for item in targets if item.get("type") == "page"), None)
        if target is None:
            raise BrowserQAError("Isolated Chrome did not expose a page target")
        self.page = CDPConnection(target["webSocketDebuggerUrl"])

    def _cleanup_enter_failure(self, profile: Path) -> None:
        """Close only the browser addressed by this exact profile's CDP file."""
        if self.page is not None:
            self.page.close()
            self.page = None
        connection = self.browser
        if connection is None:
            port_file = profile / "DevToolsActivePort"
            if port_file.is_file():
                try:
                    port_lines = port_file.read_text(encoding="utf-8").splitlines()
                    version = read_json(
                        f"http://127.0.0.1:{int(port_lines[0])}/json/version"
                    )
                    connection = CDPConnection(version["webSocketDebuggerUrl"])
                except Exception:
                    connection = None
        if connection is not None:
            try:
                connection.command("Browser.close", timeout=3)
            except Exception:
                pass
            connection.close()
        self.browser = None
        deadline = time.monotonic() + 5
        while chrome_process_count() and time.monotonic() < deadline:
            time.sleep(0.2)
        if chrome_process_count() == 0:
            if self._temporary_profile is not None:
                self._temporary_profile.cleanup()
            elif self._attached_profile is not None and profile.is_dir():
                shutil.rmtree(profile)

    def __enter__(self) -> IsolatedChrome:
        if self._attached_profile is not None:
            profile = self._attached_profile.resolve()
            temp_root = Path(tempfile.gettempdir()).resolve()
            if (
                profile.parent != temp_root
                or not profile.name.startswith("sptc-phase2a4-cdp-")
                or not profile.is_dir()
            ):
                raise BrowserQAError(
                    "--isolated-profile must be an existing GUID-style "
                    "sptc-phase2a4-cdp-* directory directly under the OS temp root"
                )
            if chrome_process_count() == 0:
                raise BrowserQAError(
                    "--isolated-profile was supplied but no Chrome process is running"
                )
        else:
            active = chrome_process_count()
            if active:
                raise BrowserQAError(
                    "Refusing isolated QA because Chrome is already running "
                    f"({active} processes). Close Chrome; the harness never reuses a "
                    "personal profile or process."
                )
            self._temporary_profile = tempfile.TemporaryDirectory(
                prefix="sptc-phase2a4-cdp-",
                ignore_cleanup_errors=False,
            )
            profile = Path(self._temporary_profile.name).resolve()
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
                f"--user-data-dir={profile}",
                "--window-size=1440,900",
                "about:blank",
            ]

            # On the audited Windows host chrome.exe is a short-lived GUI
            # launcher. Start-Process is required to keep its browser child out
            # of the invoking console job; CDP still owns the browser lifetime.
            def powershell_literal(value: str) -> str:
                return "'" + value.replace("'", "''") + "'"

            argument_list = ",".join(
                powershell_literal(argument) for argument in arguments[1:]
            )
            launch_script = (
                "$process = Start-Process "
                f"-FilePath {powershell_literal(arguments[0])} "
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
                raise BrowserQAError(
                    "PowerShell could not start isolated Chrome: "
                    f"{launched.stderr.strip()[-500:]}"
                )
            launcher_text = launched.stdout.strip().splitlines()
            if launcher_text and launcher_text[-1].strip().isdigit():
                self._launcher_pid = int(launcher_text[-1].strip())
        try:
            self._connect_profile(profile)
        except Exception:
            self._cleanup_enter_failure(profile)
            raise
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        del exc_type, exc, traceback
        if self.page is not None:
            self.page.close()
        if self.browser is not None:
            try:
                self.browser.command("Browser.close", timeout=3)
            except Exception:
                pass
            self.browser.close()
        deadline = time.monotonic() + 10
        while chrome_process_count() and time.monotonic() < deadline:
            time.sleep(0.2)
        remaining = chrome_process_count()
        if self._temporary_profile is not None:
            try:
                self._temporary_profile.cleanup()
            except PermissionError as error:
                raise BrowserQAError(
                    "Chrome profile cleanup failed; an isolated process may remain"
                ) from error
        elif self._attached_profile is not None and self._attached_profile.exists():
            resolved_profile = self._attached_profile.resolve()
            temp_root = Path(tempfile.gettempdir()).resolve()
            if (
                resolved_profile.parent == temp_root
                and resolved_profile.name.startswith("sptc-phase2a4-cdp-")
            ):
                shutil.rmtree(resolved_profile)
        if remaining:
            raise BrowserQAError(
                f"Isolated Chrome cleanup left {remaining} Chrome processes; "
                "the harness did not terminate them broadly to protect any new "
                "personal session"
            )


class ProductionPageQA:
    """Acceptance checks for the production v2 page and backend-tools client."""

    def __init__(
        self,
        chrome: IsolatedChrome,
        report: QAReport,
    ) -> None:
        if chrome.page is None or chrome.browser is None:
            raise BrowserQAError("Chrome CDP sessions are unavailable")
        self.page = chrome.page
        self.browser = chrome.browser
        self.report = report
        self.page.command("Page.enable")
        self.page.command("Runtime.enable")
        self.page.command("Log.enable")
        self.page.command(
            "Network.enable",
            {
                "maxTotalBufferSize": 50 * 1024 * 1024,
                "maxResourceBufferSize": 2 * 1024 * 1024,
            },
        )
        self.page.command("Network.setCacheDisabled", {"cacheDisabled": True})
        self.console_mark = self.page.event_mark()

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
            details = result["exceptionDetails"]
            raise BrowserQAError(
                "Page evaluation failed: "
                f"{details.get('text', details.get('exception', details))}"
            )
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
            f"Timed out waiting for {description}; last value={last_value!r}"
        )

    def navigate(self, url: str) -> int:
        mark = self.page.event_mark()
        result = self.page.command("Page.navigate", {"url": url})
        if result.get("errorText"):
            raise BrowserQAError(f"Navigation failed: {result['errorText']}")
        self.page.wait_event(
            "Page.loadEventFired", mark=mark, timeout=PAGE_READY_TIMEOUT
        )
        self.wait_js(
            "document.querySelector('#totalSections')?.textContent.trim() === '10,029' "
            "&& document.querySelector('#map')?.classList.contains('leaflet-container')",
            "the real map application to initialize",
            PAGE_READY_TIMEOUT,
        )
        resources = self.evaluate(
            "performance.getEntriesByType('resource').map(entry => entry.name)"
        )
        self.report.check(
            any(url.endswith("/coldwave-demo-v2/js/app.js") for url in resources),
            "production app.js loaded",
        )
        self.report.check(
            not any("assistant-client-tests.html" in url for url in resources),
            "acceptance page is not the test-only mock page",
        )
        return mark

    def press_key(self, key: str, code: str, virtual_key: int) -> None:
        self.page.command(
            "Input.dispatchKeyEvent",
            {
                "type": "keyDown",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": virtual_key,
            },
        )
        self.page.command(
            "Input.dispatchKeyEvent",
            {
                "type": "keyUp",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": virtual_key,
            },
        )

    def api_requests(self, mark: int) -> list[dict[str, Any]]:
        return [
            event["params"]
            for event in self.page.events_since(mark, "Network.requestWillBeSent")
            if event.get("params", {})
            .get("request", {})
            .get("url", "")
            .startswith(f"{BACKEND_ORIGIN}/api/v1/")
        ]

    def action_requests(self, mark: int) -> list[dict[str, Any]]:
        return [
            params
            for params in self.api_requests(mark)
            if params.get("request", {}).get("method") != "OPTIONS"
        ]

    def assert_one_request(
        self,
        mark: int,
        method: str,
        path: str,
    ) -> dict[str, Any]:
        requests = self.action_requests(mark)
        self.report.check(
            len(requests) == 1,
            f"exactly one {method} {path} action request",
            json.dumps(
                [
                    {
                        "method": item.get("request", {}).get("method"),
                        "url": item.get("request", {}).get("url"),
                    }
                    for item in requests
                ]
            ),
        )
        request = requests[0]
        actual = request["request"]
        self.report.check(actual.get("method") == method, f"{path} method is {method}")
        self.report.check(
            actual.get("url") == f"{BACKEND_ORIGIN}{path}",
            f"{path} uses the fixed backend URL",
            actual.get("url", ""),
        )
        headers = {
            key.lower(): value for key, value in actual.get("headers", {}).items()
        }
        self.report.check("authorization" not in headers, f"{path} omits Authorization")
        self.report.check("cookie" not in headers, f"{path} omits credentials")
        return request

    def response_for(self, request_id: str) -> dict[str, Any]:
        responses = [
            event["params"]["response"]
            for event in self.page.events_since(0, "Network.responseReceived")
            if event.get("params", {}).get("requestId") == request_id
        ]
        if not responses:
            raise BrowserQAError(f"No browser response recorded for {request_id}")
        return responses[-1]

    def assert_cors(self, request: dict[str, Any]) -> None:
        response = self.response_for(request["requestId"])
        headers = {
            key.lower(): value for key, value in response.get("headers", {}).items()
        }
        self.report.check(
            headers.get("access-control-allow-origin") == FRONTEND_ORIGIN,
            "backend CORS header matches the requesting origin",
            str(headers.get("access-control-allow-origin")),
        )

    def select_with_search(self, section_id: str) -> None:
        encoded = json.dumps(f"CS_{section_id}")
        self.evaluate(
            "(() => {"
            "const input = document.querySelector('#csSearch');"
            f"input.value = {encoded};"
            "input.dispatchEvent(new Event('input', {bubbles: true}));"
            "return true;"
            "})()"
        )
        selector = f'.search-result[data-key="{section_id}"]'
        self.wait_js(
            f"Boolean(document.querySelector({json.dumps(selector)}))",
            f"search result for CS_{section_id}",
        )
        self.evaluate(f"document.querySelector({json.dumps(selector)}).click()")
        self.wait_js(
            f"document.querySelector('#selectedTitle').textContent.includes('CS {section_id}')",
            f"selection of CS_{section_id}",
        )

    def select_direct(self, section_id: str) -> None:
        self.evaluate(
            f"(async () => {{ await selectByKey({json.dumps(section_id)}); return true; }})()"
        )
        self.wait_js(
            f"document.querySelector('#selectedTitle').textContent.includes('CS {section_id}')",
            f"selection of CS_{section_id}",
        )

    def set_layer(self, layer: str) -> None:
        self.evaluate(
            "(() => {"
            "const select = document.querySelector('#layerSelect');"
            f"select.value = {json.dumps(layer)};"
            "select.dispatchEvent(new Event('change', {bubbles: true}));"
            "return select.value;"
            "})()"
        )

    def click(self, selector: str) -> None:
        self.evaluate(f"document.querySelector({json.dumps(selector)}).click()")

    def ensure_assistant_open(self) -> None:
        if not self.evaluate("document.querySelector('#assistantPanel').hidden"):
            return
        mark = self.page.event_mark()
        self.click("#assistantLauncher")
        self.wait_js(
            "!document.querySelector('#assistantPanel').hidden "
            "&& document.querySelector('#assistantLauncher').getAttribute('aria-expanded') "
            "=== 'true'",
            "the floating Assistant to open",
        )
        self.report.check(
            not self.api_requests(mark),
            "opening the floating Assistant makes no Assistant API request",
        )

    def floating_assistant_structure_acceptance(self) -> None:
        structure = self.evaluate(
            "(() => {"
            "const panel = document.querySelector('#assistantPanel');"
            "const launcher = document.querySelector('#assistantLauncher');"
            "return {"
            "panelHidden: panel.hidden, panelAriaHidden: panel.getAttribute('aria-hidden'),"
            "launcherExpanded: launcher.getAttribute('aria-expanded'),"
            "outsideSidebar: !document.querySelector('.left-panel').contains(panel),"
            "timelineCount: document.querySelectorAll('#assistantMessages').length,"
            "legacySurfaces: document.querySelectorAll('#assistantChatMessages, "
            "#assistantReviewContainer').length,"
            "curveOpen: document.querySelector('#curveDetails').open,"
            "curvePlaceholder: document.querySelector('#curveNote').textContent.trim(),"
            "contextOpen: document.querySelector('#contextDetails').open,"
            "methodOpen: document.querySelector('.method-details').open"
            "};"
            "})()"
        )
        self.report.check(
            structure["panelHidden"]
            and structure["panelAriaHidden"] == "true"
            and structure["launcherExpanded"] == "false",
            "floating Assistant is collapsed by default",
        )
        self.report.check(
            structure["outsideSidebar"]
            and structure["timelineCount"] == 1
            and structure["legacySurfaces"] == 0,
            "Assistant is outside the analysis sidebar with one unified timeline",
        )
        self.report.check(
            structure["curveOpen"]
            and structure["curvePlaceholder"]
            == "Select a control section to view Q(t).",
            "Q(t) is open by default with the no-selection placeholder",
        )
        self.report.check(
            not structure["contextOpen"] and not structure["methodOpen"],
            "Tier 1/2 context and method details remain collapsed by default",
        )

        toggle_mark = self.page.event_mark()
        self.evaluate("document.querySelector('#assistantLauncher').focus()")
        self.press_key("Enter", "Enter", 13)
        self.wait_js(
            "!document.querySelector('#assistantPanel').hidden "
            "&& document.activeElement === document.querySelector('#assistantClose')",
            "keyboard opening and close-button focus",
        )
        self.click("#assistantClose")
        self.wait_js(
            "document.querySelector('#assistantPanel').hidden "
            "&& document.activeElement === document.querySelector('#assistantLauncher')",
            "Assistant close and launcher focus restoration",
        )
        self.click("#assistantLauncher")
        self.wait_js(
            "!document.querySelector('#assistantPanel').hidden",
            "the floating Assistant to reopen",
        )
        self.report.check(
            not self.api_requests(toggle_mark),
            "opening and closing the Assistant sends no network request",
        )
        self.report.check(
            True, "Assistant launcher, close control, and focus return work"
        )

    def status(self) -> str:
        return self.evaluate("document.querySelector('#assistantStatus').textContent")

    def message_text(self) -> str:
        return self.evaluate("document.querySelector('#assistantMessages').textContent")

    def verified_result_count(self) -> int:
        return self.evaluate(
            "document.querySelectorAll("
            "'#assistantMessages [data-result-kind=verified]').length"
        )

    def wait_verified_result(
        self,
        previous_count: int,
        expected_text: str,
        timeout: float = ACTION_TIMEOUT,
    ) -> int:
        return self.wait_js(
            "(() => {"
            "const results = Array.from(document.querySelectorAll("
            "'#assistantMessages [data-result-kind=verified]'));"
            "const latest = results.at(-1);"
            f"return results.length > {previous_count} "
            "&& latest?.querySelector('.assistant-result-source')?.textContent "
            "=== 'Verified result' "
            f"&& latest.textContent.includes({json.dumps(expected_text)}) "
            "? results.length : 0;"
            "})()",
            f"a new Verified result containing {expected_text!r}",
            timeout,
        )

    def wait_status(self, text: str, timeout: float = ACTION_TIMEOUT) -> str:
        return self.wait_js(
            "(() => {"
            "const value = document.querySelector('#assistantStatus').textContent;"
            f"return value.includes({json.dumps(text)}) ? value : '';"
            "})()",
            f"Assistant status containing {text!r}",
            timeout,
        )

    def local_template_acceptance(self) -> None:
        page_mark = self.navigate(LOCAL_URL)
        mode_metadata = self.evaluate(
            "(() => { const e = document.querySelector('#assistantModeLabel'); "
            "return {text: e.textContent, hidden: e.classList.contains('visually-hidden')}; })()"
        )
        self.report.check(
            mode_metadata == {"text": "Local preview", "hidden": True},
            "local-template mode remains hidden implementation metadata",
        )
        self.report.check(
            not self.api_requests(page_mark),
            "local-template page load makes no Assistant API request",
        )
        self.floating_assistant_structure_acceptance()
        selection_mark = self.page.event_mark()
        self.select_with_search("1081")
        self.report.check(
            not self.api_requests(selection_mark),
            "local-template search selection makes no Assistant API request",
        )
        self.report.check(
            self.evaluate(
                "document.querySelector('#csSearch').value.startsWith('CS_1081')"
            ),
            "search result selects the correct control section",
        )
        for selector, expected in (
            ("#assistantExplainSection", "sustained speed-performance decline"),
            ("#assistantExplainMetric", "reviewed metric"),
            ("#assistantGenerateReviewNote", "required to generate"),
        ):
            action_mark = self.page.event_mark()
            result_count = self.verified_result_count()
            self.click(selector)
            self.wait_verified_result(result_count, expected)
            self.report.check(
                expected in self.message_text(),
                f"{selector} uses its reviewed local-template presentation",
            )
            self.report.check(
                self.status() == "",
                f"{selector} leaves the normal successful status silent",
            )
            self.report.check(
                not self.api_requests(action_mark),
                f"{selector} makes no Assistant API request in local mode",
            )
        self.report.check(
            not self.evaluate(
                "Boolean(document.querySelector('.assistant-review-details'))"
            ),
            "local review action does not claim a backend draft",
        )
        self.report.check(
            self.evaluate(
                "document.querySelector('#map').classList.contains('leaflet-container')"
            ),
            "Leaflet map remains initialized in local mode",
        )
        self.wait_js(
            "!document.querySelector('#curveNote').textContent.startsWith('Select a')",
            "the selected local curve to load",
        )
        self.report.check(
            self.evaluate(
                "document.querySelector('#curveDetails').open "
                "&& document.querySelector('#curveChart').getBoundingClientRect().height > 0"
            ),
            "selected Q(t) curve loads without a second expansion action",
        )
        self.keyboard_and_structure_acceptance()
        self.splitter_acceptance()

    def keyboard_and_structure_acceptance(self) -> None:
        structure = self.evaluate(
            "(() => {"
            "const ids = ['assistantExplainSection','assistantExplainMetric',"
            "'assistantGenerateReviewNote'];"
            "return {"
            "buttons: ids.map(id => { const b = document.getElementById(id); "
            "return {id, tabIndex: b.tabIndex, disabled: b.disabled, type: b.type}; }),"
            "composerHidden: document.getElementById('assistantComposer').hidden,"
            "inputDisabled: document.getElementById('assistantInput').disabled,"
            "sendDisabled: document.getElementById('assistantSend').disabled,"
            "statusLive: document.getElementById('assistantStatus').getAttribute('aria-live'),"
            "messagesLive: document.getElementById('assistantMessages').getAttribute('aria-live')"
            "};"
            "})()"
        )
        self.report.check(
            all(
                item["tabIndex"] >= 0 and item["type"] == "button"
                for item in structure["buttons"]
            ),
            "all three enabled actions are keyboard reachable",
        )
        self.report.check(
            structure["composerHidden"]
            and structure["inputDisabled"]
            and structure["sendDisabled"],
            "hidden free-form composer cannot receive interaction",
        )
        self.report.check(
            structure["statusLive"] == "polite"
            and structure["messagesLive"] == "polite",
            "Assistant status regions expose structural live announcements",
        )
        self.ensure_assistant_open()
        result_count = self.verified_result_count()
        self.evaluate("document.querySelector('#assistantExplainSection').focus()")
        self.press_key("Enter", "Enter", 13)
        self.wait_verified_result(result_count, "Verified result")
        self.report.check(
            self.evaluate(
                "getComputedStyle(document.querySelector('#assistantExplainSection')).outlineStyle"
                " !== 'none'"
            ),
            "keyboard focus remains visibly styled",
        )
        result_count = self.verified_result_count()
        self.evaluate("document.querySelector('#assistantExplainMetric').focus()")
        self.press_key(" ", "Space", 32)
        self.wait_verified_result(result_count, "reviewed metric")
        before = self.evaluate("document.querySelector('#curveDetails').open")
        self.evaluate("document.querySelector('#curveDetails > summary').focus()")
        self.press_key(" ", "Space", 32)
        self.wait_js(
            f"document.querySelector('#curveDetails').open === {str(not before).lower()}",
            "native details keyboard activation",
        )
        self.report.check(True, "Enter and Space activate native controls")

    def splitter_acceptance(self) -> None:
        self.page.command(
            "Emulation.setDeviceMetricsOverride",
            {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False},
        )
        self.evaluate(
            "(() => {"
            "window.__phase2a4InvalidateCount = 0;"
            "if (!map.__phase2a4InvalidateWrapped) {"
            "const original = map.invalidateSize.bind(map);"
            "map.invalidateSize = (...args) => {"
            "window.__phase2a4InvalidateCount += 1; return original(...args); };"
            "map.__phase2a4InvalidateWrapped = true;"
            "}"
            "return true;"
            "})()"
        )
        splitter = self.evaluate(
            "(() => {"
            "const s = document.querySelector('#analysisSplitter');"
            "const panel = document.querySelector('.left-panel').getBoundingClientRect();"
            "const mapBox = document.querySelector('.map-shell').getBoundingClientRect();"
            "const box = s.getBoundingClientRect();"
            "return {role: s.getAttribute('role'), orientation: s.getAttribute('aria-orientation'),"
            "label: s.getAttribute('aria-label'), tabIndex: s.tabIndex, display: getComputedStyle(s).display,"
            "panelRight: panel.right, splitterLeft: box.left, splitterRight: box.right,"
            "mapLeft: mapBox.left};"
            "})()"
        )
        self.report.check(
            splitter["role"] == "separator"
            and splitter["orientation"] == "vertical"
            and splitter["label"] == "Resize analysis panel"
            and splitter["tabIndex"] >= 0
            and splitter["display"] != "none",
            "desktop splitter exposes keyboard-focusable separator semantics",
        )
        self.report.check(
            splitter["panelRight"] <= splitter["splitterRight"] + 1
            and splitter["mapLeft"] >= splitter["splitterLeft"] - 1,
            "desktop workspace order is analysis panel, separator, then map",
        )

        self.evaluate("document.querySelector('#analysisSplitter').focus()")
        self.press_key("Home", "Home", 36)
        self.wait_js(
            "document.querySelector('#analysisSplitter').getAttribute('aria-valuenow') === '320'",
            "splitter keyboard minimum",
        )
        self.press_key("ArrowRight", "ArrowRight", 39)
        self.wait_js(
            "document.querySelector('#analysisSplitter').getAttribute('aria-valuenow') === '336'",
            "splitter keyboard increment",
        )
        self.press_key("End", "End", 35)
        self.wait_js(
            "document.querySelector('#analysisSplitter').getAttribute('aria-valuenow') === '650'",
            "splitter keyboard maximum",
        )

        def drag_splitter(target_x: float) -> None:
            point = self.evaluate(
                "(() => { const r = document.querySelector('#analysisSplitter')"
                ".getBoundingClientRect(); return {x: r.left + r.width / 2, "
                "y: r.top + Math.min(120, r.height / 2)}; })()"
            )
            self.page.command(
                "Input.dispatchMouseEvent",
                {
                    "type": "mouseMoved",
                    "x": point["x"],
                    "y": point["y"],
                    "button": "none",
                    "buttons": 0,
                    "pointerType": "mouse",
                },
            )
            self.page.command(
                "Input.dispatchMouseEvent",
                {
                    "type": "mousePressed",
                    "x": point["x"],
                    "y": point["y"],
                    "button": "left",
                    "buttons": 1,
                    "clickCount": 1,
                    "pointerType": "mouse",
                },
            )
            self.wait_js(
                "document.body.classList.contains('is-analysis-resizing')",
                "splitter pointer-down capture",
            )
            for step in range(1, 9):
                x = point["x"] + (target_x - point["x"]) * step / 8
                self.page.command(
                    "Input.dispatchMouseEvent",
                    {
                        "type": "mouseMoved",
                        "x": x,
                        "y": point["y"],
                        "button": "none",
                        "buttons": 1,
                        "pointerType": "mouse",
                    },
                )
            self.page.command(
                "Input.dispatchMouseEvent",
                {
                    "type": "mouseReleased",
                    "x": target_x,
                    "y": point["y"],
                    "button": "left",
                    "buttons": 0,
                    "clickCount": 1,
                    "pointerType": "mouse",
                },
            )
            self.wait_js(
                "!document.body.classList.contains('is-analysis-resizing')",
                "splitter pointer-up release",
            )

        drag_splitter(48)
        self.wait_js(
            "document.querySelector('#analysisSplitter').getAttribute('aria-valuenow') === '320'",
            "pointer resize minimum clamp",
        )
        drag_splitter(1392)
        self.wait_js(
            "document.querySelector('#analysisSplitter').getAttribute('aria-valuenow') === '650'",
            "pointer resize maximum clamp",
        )
        self.wait_js(
            "window.__phase2a4InvalidateCount > 0",
            "Leaflet invalidateSize after analysis-panel resizing",
        )
        self.wait_js(
            "Math.abs(map.getSize().x - document.querySelector('.map-shell')"
            ".getBoundingClientRect().width) <= 2",
            "Leaflet size to match the resized map container",
        )
        final_state = self.evaluate(
            "(() => {"
            "const mapBox = document.querySelector('.map-shell').getBoundingClientRect();"
            "return {mapWidth: mapBox.width, leafletWidth: map.getSize().x,"
            "scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth,"
            "resizing: document.body.classList.contains('is-analysis-resizing'),"
            "invalidations: window.__phase2a4InvalidateCount};"
            "})()"
        )
        self.report.check(
            final_state["mapWidth"] >= 480
            and abs(final_state["mapWidth"] - final_state["leafletWidth"]) <= 2
            and final_state["scrollWidth"] <= final_state["innerWidth"] + 1,
            "splitter bounds preserve map usability without horizontal overflow",
        )
        self.report.check(
            not final_state["resizing"] and final_state["invalidations"] > 0,
            "pointer resize releases active state and notifies Leaflet",
        )
        self.evaluate("applyAnalysisPanelWidth(420)")
        time.sleep(0.2)
        self.page.command("Emulation.clearDeviceMetricsOverride")

    def backend_live_acceptance(self) -> str:
        page_mark = self.navigate(BACKEND_TOOLS_URL)
        runtime = self.evaluate("window.SPTCAssistant.runtime")
        self.report.check(
            runtime["effective_mode"] == "backend-tools"
            and runtime["backend_base_url"] == BACKEND_ORIGIN,
            "backend-tools mode uses the fixed reviewed backend",
        )
        mode_metadata = self.evaluate(
            "(() => { const e = document.querySelector('#assistantModeLabel'); "
            "return {text: e.textContent, hidden: e.classList.contains('visually-hidden')}; })()"
        )
        self.report.check(
            mode_metadata == {"text": "Review tools", "hidden": True},
            "backend-tools mode remains hidden implementation metadata",
        )
        self.report.check(
            not self.api_requests(page_mark),
            "backend-tools page load makes no Assistant API request",
        )
        self.floating_assistant_structure_acceptance()
        selection_mark = self.page.event_mark()
        self.select_with_search("1081")
        self.report.check(
            not self.api_requests(selection_mark),
            "backend-tools selection makes no Assistant API request",
        )

        summary_mark = self.page.event_mark()
        result_count = self.verified_result_count()
        self.click("#assistantExplainSection")
        self.wait_verified_result(result_count, "Detection status")
        self.report.check(
            self.status() == "",
            "successful section result has no developer status prose",
        )
        summary_request = self.assert_one_request(
            summary_mark,
            "GET",
            "/api/v1/sections/1081",
        )
        self.assert_cors(summary_request)
        summary_text = self.message_text()
        self.report.check(
            "Observed support" in summary_text
            and "Detection status" in summary_text
            and "Planning context" in summary_text,
            "section result presents reviewed observed/planning distinctions",
        )

        layer_mark = self.page.event_mark()
        self.set_layer("q_min")
        self.report.check(
            not self.api_requests(layer_mark),
            "metric-layer change makes no Assistant API request",
        )
        metric_mark = self.page.event_mark()
        result_count = self.verified_result_count()
        self.click("#assistantExplainMetric")
        self.wait_verified_result(result_count, "relative standing")
        self.report.check(
            self.status() == "",
            "successful metric result has no developer status prose",
        )
        metric_request = self.assert_one_request(
            metric_mark,
            "GET",
            "/api/v1/metrics/q_min",
        )
        self.assert_cors(metric_request)
        self.report.check(
            "not an interpretation of the selected section's relative standing"
            in self.message_text(),
            "metric result remains definition-only",
        )

        review_mark = self.page.event_mark()
        result_count = self.verified_result_count()
        self.click("#assistantGenerateReviewNote")
        self.wait_verified_result(result_count, "Draft for human review")
        self.report.check(
            self.status() == "", "successful review note has no developer status prose"
        )
        review_request = self.assert_one_request(
            review_mark,
            "POST",
            "/api/v1/reports/review-note",
        )
        self.assert_cors(review_request)
        post_data = json.loads(review_request["request"].get("postData", "{}"))
        self.report.check(
            post_data == {"scope": "section", "section_ids": ["1081"]},
            "review-note POST body is the bounded accepted request",
            json.dumps(post_data),
        )
        review_state = self.evaluate(
            "(() => {"
            "const d = document.querySelector('.assistant-review-details');"
            "return {open: d.open, sections: d.dataset.reportSectionCount, "
            "inTimeline: document.querySelector('#assistantMessages').contains(d), "
            "verified: d.closest('[data-result-kind=verified]') !== null, "
            "warnings: Boolean(d.querySelector('[data-review-list=warnings]')), "
            "limitations: Boolean(d.querySelector('[data-review-list=limitations]')), "
            "checklist: Boolean(d.querySelector('[data-review-list=human-review-checklist]')), "
            "scripts: d.querySelectorAll('script,img,[onerror],[onclick]').length};"
            "})()"
        )
        self.report.check(
            not review_state["open"]
            and review_state["sections"] == "6"
            and review_state["inTimeline"]
            and review_state["verified"],
            "verified review note is collapsed inside the unified timeline",
        )
        map_width_before = self.evaluate(
            "document.querySelector('.map-shell').getBoundingClientRect().width"
        )
        self.evaluate(
            "(() => { const d = document.querySelector('.assistant-review-details'); "
            "d.open = true; d.dispatchEvent(new Event('toggle')); return true; })()"
        )
        map_width_after = self.evaluate(
            "document.querySelector('.map-shell').getBoundingClientRect().width"
        )
        self.report.check(
            review_state["warnings"]
            and review_state["limitations"]
            and review_state["checklist"],
            "expanded review exposes warnings, limitations, and checklist",
        )
        self.report.check(
            review_state["scripts"] == 0,
            "review Markdown is not interpreted as dynamic HTML",
        )
        self.report.check(
            abs(map_width_before - map_width_after) <= 2,
            "expanded review does not reduce desktop map width",
        )
        response_body = self.page.command(
            "Network.getResponseBody",
            {"requestId": review_request["requestId"]},
        ).get("body", "")
        review_payload = json.loads(response_body)
        markdown = review_payload["rendered_markdown"]
        self.clipboard_acceptance(markdown)
        self.unsupported_metric_acceptance()
        self.representative_status_acceptance()
        self.viewport_acceptance()
        return markdown

    def clipboard_acceptance(self, markdown: str) -> None:
        try:
            self.browser.command(
                "Browser.grantPermissions",
                {
                    "origin": FRONTEND_ORIGIN,
                    "permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"],
                },
            )
            available = self.evaluate("Boolean(navigator.clipboard?.writeText)")
            if not available:
                self.report.note(
                    "Clipboard API unavailable in isolated headless Chrome"
                )
                return
            self.evaluate("document.querySelector('.assistant-copy-markdown').focus()")
            self.press_key("Enter", "Enter", 13)
            self.wait_js(
                "document.querySelector('.assistant-copy-status').textContent "
                "=== 'Copied Markdown.'",
                "clipboard success announcement",
            )
            copied = self.evaluate("navigator.clipboard.readText()")
            self.report.check(
                copied == markdown, "Copy Markdown copies the exact validated text"
            )
            self.report.check(
                self.evaluate(
                    "document.querySelector('.assistant-copy-status').getAttribute('aria-live')"
                )
                == "polite",
                "copy success is structurally announced",
            )
        except BrowserQAError as error:
            self.report.note(f"Clipboard permission/API check unavailable: {error}")

    def unsupported_metric_acceptance(self) -> None:
        for layer in ("detection_status", "total_detected_phase_delay_proxy"):
            mark = self.page.event_mark()
            self.set_layer(layer)
            state = self.evaluate(
                "(() => { const b = document.querySelector('#assistantExplainMetric'); "
                "return {disabled: b.disabled, ariaDisabled: b.matches(':disabled')}; })()"
            )
            self.report.check(
                state["disabled"] and state["ariaDisabled"],
                f"{layer} keeps metric explanation disabled",
            )
            self.click("#assistantExplainMetric")
            time.sleep(0.2)
            self.report.check(
                not self.api_requests(mark),
                f"{layer} cannot call metric explanation",
            )
        self.set_layer("q_min")

    def representative_status_acceptance(self) -> None:
        cases = (
            ("1081", "detected", "METHOD_SCOPE"),
            ("257", "no sustained drop", "NO_SUSTAINED_DROP"),
            ("3597", "recovery endpoint censored", "RECOVERY_CENSORED"),
            ("1", "no observed support", "NO_OBSERVED_SUPPORT"),
            ("583693", "detected", "METHOD_SCOPE"),
        )
        observed: dict[str, str] = {}
        for section_id, status, warning in cases:
            self.select_direct(section_id)
            mark = self.page.event_mark()
            result_count = self.verified_result_count()
            self.click("#assistantExplainSection")
            self.wait_verified_result(result_count, "Detection status")
            request = self.assert_one_request(
                mark,
                "GET",
                f"/api/v1/sections/{section_id}",
            )
            self.assert_cors(request)
            text = self.message_text()
            observed[section_id] = text
            self.report.check(
                status in text.lower() and warning in text,
                f"CS_{section_id} shows {status} and its warning contract",
            )
        self.report.check(
            "confirmed recovery" not in observed["3597"].lower()
            and "fully recovered" not in observed["3597"].lower(),
            "censored case does not claim confirmed recovery",
        )
        self.report.check(
            "no impact occurred" not in observed["257"].lower()
            and "was not impacted" not in observed["257"].lower(),
            "no-sustained-drop case does not claim no impact",
        )
        self.report.check(
            "does not indicate that no disruption occurred" in observed["1"].lower(),
            "no-support case explicitly avoids a no-disruption claim",
        )
        combined = "\n".join(observed.values()).lower()
        prohibited = (
            "should invest",
            "investment recommendation",
            "will fail",
            "will recover",
            "high resilience",
            "low resilience",
            "very high resilience",
            "very low resilience",
        )
        self.report.check(
            not any(phrase in combined for phrase in prohibited),
            "representative results add no predictive, investment, or class claims",
        )

    def viewport_acceptance(self) -> None:
        viewports = ((1440, 900), (1024, 768), (768, 900), (390, 844))
        for width, height in viewports:
            self.page.command(
                "Emulation.setDeviceMetricsOverride",
                {
                    "width": width,
                    "height": height,
                    "deviceScaleFactor": 1,
                    "mobile": width <= 520,
                },
            )
            time.sleep(0.2)
            self.ensure_assistant_open()
            layout = self.evaluate(
                "(() => {"
                "const app = document.querySelector('.app-shell');"
                "const panel = document.querySelector('.left-panel').getBoundingClientRect();"
                "const splitterElement = document.querySelector('#analysisSplitter');"
                "const splitter = splitterElement.getBoundingClientRect();"
                "const map = document.querySelector('.map-shell').getBoundingClientRect();"
                "const assistantElement = document.querySelector('#assistantPanel');"
                "const assistant = assistantElement.getBoundingClientRect();"
                "const timeline = document.querySelector('#assistantMessages');"
                "const composerElement = document.querySelector('#assistantComposer');"
                "const composer = composerElement.getBoundingClientRect();"
                "const attribution = document.querySelector('.leaflet-control-attribution')"
                "?.getBoundingClientRect();"
                "const assistantOverlapsAttribution = attribution ? !("
                "assistant.right <= attribution.left || assistant.left >= attribution.right || "
                "assistant.bottom <= attribution.top || assistant.top >= attribution.bottom) : false;"
                "return {"
                "innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth,"
                "media768: window.matchMedia('(max-width: 768px)').matches,"
                "scrollWidth: document.documentElement.scrollWidth,"
                "columns: getComputedStyle(app).gridTemplateColumns.split(' ').filter(Boolean).length,"
                "panel: {left: panel.left, right: panel.right, top: panel.top, "
                "bottom: panel.bottom, width: panel.width},"
                "splitter: {left: splitter.left, right: splitter.right, width: splitter.width, "
                "display: getComputedStyle(splitterElement).display, "
                "ariaMax: Number(splitterElement.getAttribute('aria-valuemax'))},"
                "map: {left: map.left, right: map.right, top: map.top, width: map.width, height: map.height},"
                "assistant: {left: assistant.left, right: assistant.right, top: assistant.top, "
                "bottom: assistant.bottom, width: assistant.width, height: assistant.height, "
                "position: getComputedStyle(assistantElement).position, hidden: assistantElement.hidden},"
                "composer: {top: composer.top, bottom: composer.bottom, height: composer.height, "
                "hidden: composerElement.hidden},"
                "assistantOutsideSidebar: !document.querySelector('.left-panel').contains(assistantElement),"
                "assistantOverlapsAttribution,"
                "mapReady: document.querySelector('#map').classList.contains('leaflet-container'),"
                "buttonsUsable: Array.from(document.querySelectorAll('[data-assistant-action]'))"
                ".every(b => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height > 0),"
                "timelineScrollable: ['auto','scroll'].includes(getComputedStyle(timeline).overflowY),"
                "curveOpen: document.querySelector('#curveDetails').open,"
                "curveHeight: document.querySelector('#curveChart').getBoundingClientRect().height"
                "};"
                "})()"
            )
            self.report.check(
                layout["scrollWidth"] <= layout["innerWidth"] + 1,
                f"{width}x{height} has no unexpected horizontal overflow",
            )
            self.report.check(
                layout["mapReady"]
                and layout["map"]["width"] > 0
                and layout["map"]["height"] > 0,
                f"{width}x{height} keeps the Leaflet map usable",
            )
            self.report.check(
                layout["buttonsUsable"]
                and layout["timelineScrollable"]
                and layout["curveOpen"]
                and layout["curveHeight"] > 0,
                f"{width}x{height} keeps Assistant controls, timeline, and Q(t) usable",
            )
            self.report.check(
                not layout["assistant"]["hidden"]
                and layout["assistant"]["position"] == "fixed"
                and layout["assistantOutsideSidebar"]
                and layout["assistant"]["left"] >= 0
                and layout["assistant"]["top"] >= 0
                and layout["assistant"]["right"] <= layout["innerWidth"] + 1
                and layout["assistant"]["bottom"] <= height + 1
                and (
                    layout["composer"]["hidden"]
                    or (
                        layout["composer"]["top"] >= layout["assistant"]["top"] - 1
                        and layout["composer"]["bottom"]
                        <= layout["assistant"]["bottom"] + 1
                    )
                )
                and not layout["assistantOverlapsAttribution"],
                f"{width}x{height} keeps the floating Assistant within the viewport and clear of attribution",
            )
            if width > 980:
                self.report.check(
                    layout["columns"] == 3
                    and layout["splitter"]["display"] != "none"
                    and layout["splitter"]["width"] > 0
                    and layout["splitter"]["left"] >= layout["panel"]["right"] - 1
                    and layout["map"]["left"] >= layout["splitter"]["right"] - 1
                    and 320 <= layout["panel"]["width"] <= layout["splitter"]["ariaMax"]
                    and layout["splitter"]["ariaMax"] <= 650
                    and layout["map"]["width"] >= 480
                    and layout["assistant"]["width"] <= 440,
                    f"{width}x{height} uses analysis | separator | map with a desktop Assistant",
                )
            else:
                self.report.check(
                    layout["columns"] == 1
                    and layout["splitter"]["display"] == "none"
                    and layout["panel"]["left"] >= 0
                    and layout["panel"]["right"] <= layout["clientWidth"] + 1
                    and layout["map"]["top"] >= layout["panel"]["bottom"] - 1,
                    f"{width}x{height} disables the splitter in the one-column layout",
                )
                if width <= 768:
                    self.report.check(
                        layout["assistant"]["width"] >= layout["clientWidth"] - 26,
                        f"{width}x{height} uses a near-full-width Assistant bottom sheet",
                        json.dumps(layout, sort_keys=True),
                    )
            screenshot = self.page.command(
                "Page.captureScreenshot",
                {"format": "png", "fromSurface": True},
            ).get("data", "")
            self.report.check(
                len(screenshot) > 1000,
                f"{width}x{height} produced an internal QA screenshot",
            )
        self.page.command("Emulation.clearDeviceMetricsOverride")

    def blocked_backend_fallback_acceptance(self) -> None:
        self.select_direct("1081")
        self.ensure_assistant_open()
        self.page.command(
            "Network.setBlockedURLs",
            {"urls": [f"{BACKEND_ORIGIN}/api/v1/*"]},
        )
        try:
            result_count = self.verified_result_count()
            self.click("#assistantExplainSection")
            self.wait_status("Review service unavailable")
            self.wait_verified_result(
                result_count, "sustained speed-performance decline"
            )
            self.report.check(
                "local result" in self.status().lower()
                and "sustained speed-performance decline" in self.message_text(),
                "browser-blocked backend renders the explicit local fallback",
            )
            result_count = self.verified_result_count()
            self.click("#assistantGenerateReviewNote")
            self.wait_status("Review service unavailable")
            self.wait_verified_result(result_count, "no draft was generated")
            self.report.check(
                "no draft was generated" in self.message_text().lower()
                and not self.evaluate(
                    "Boolean(document.querySelector('.assistant-review-details, "
                    ".assistant-copy-markdown'))"
                ),
                "unavailable review-note action does not claim a draft",
            )
        finally:
            self.page.command("Network.setBlockedURLs", {"urls": []})

    def actual_unavailable_acceptance(self) -> None:
        mark = self.navigate(BACKEND_TOOLS_URL)
        self.report.check(
            not self.api_requests(mark),
            "unavailable-backend page load makes no Assistant API request",
        )
        self.floating_assistant_structure_acceptance()
        self.select_with_search("1081")
        action_mark = self.page.event_mark()
        result_count = self.verified_result_count()
        self.click("#assistantExplainSection")
        self.wait_status("Review service unavailable", timeout=12)
        self.wait_verified_result(
            result_count, "sustained speed-performance decline", timeout=12
        )
        requests = self.action_requests(action_mark)
        self.report.check(
            len(requests) == 1,
            "stopped backend receives only the explicit section attempt",
        )
        self.report.check(
            "local result" in self.status().lower()
            and "sustained speed-performance decline" in self.message_text(),
            "stopped backend produces a visible local fallback",
        )
        result_count = self.verified_result_count()
        self.click("#assistantGenerateReviewNote")
        self.wait_status("Review service unavailable", timeout=12)
        self.wait_verified_result(result_count, "no draft was generated", timeout=12)
        self.report.check(
            "no draft was generated" in self.message_text().lower(),
            "stopped-backend review failure does not claim a draft",
        )

    def delayed_request_acceptance(self) -> None:
        self.navigate(BACKEND_TOOLS_URL)
        self.ensure_assistant_open()
        self.select_with_search("1081")
        self.set_layer("q_min")

        self.page.command(
            "Fetch.enable",
            {
                "patterns": [
                    {
                        "urlPattern": f"{BACKEND_ORIGIN}/api/v1/*",
                        "requestStage": "Request",
                    }
                ]
            },
        )
        paused: list[str] = []
        try:
            timeout_mark = self.page.event_mark()
            result_count = self.verified_result_count()
            self.click("#assistantExplainSection")
            timeout_request = self.page.wait_event(
                "Fetch.requestPaused",
                mark=timeout_mark,
                predicate=lambda params: "/sections/1081" in params["request"]["url"],
                timeout=5,
            )
            paused.append(timeout_request["requestId"])
            self.wait_status("Review request timed out", timeout=12)
            self.wait_verified_result(
                result_count, "sustained speed-performance decline", timeout=12
            )
            self.report.check(
                "local result" in self.status().lower(),
                "a genuinely delayed browser fetch reaches timeout fallback",
            )

            section_mark = self.page.event_mark()
            self.click("#assistantExplainSection")
            old_section = self.page.wait_event(
                "Fetch.requestPaused",
                mark=section_mark,
                predicate=lambda params: "/sections/1081" in params["request"]["url"],
                timeout=5,
            )
            paused.append(old_section["requestId"])
            self.select_direct("257")
            try:
                self.page.command(
                    "Fetch.continueRequest",
                    {"requestId": old_section["requestId"]},
                )
                paused.remove(old_section["requestId"])
            except BrowserQAError:
                pass
            time.sleep(0.5)
            self.report.check(
                "CS 257"
                in self.evaluate("document.querySelector('#selectedTitle').textContent")
                and self.status() == ""
                and not self.evaluate(
                    "Boolean(document.querySelector('#assistantMessages "
                    "[data-result-kind=verified]'))"
                ),
                "switching section prevents stale result and fallback rendering",
            )

            self.select_direct("1081")
            self.set_layer("q_min")
            metric_mark = self.page.event_mark()
            self.click("#assistantExplainMetric")
            old_metric = self.page.wait_event(
                "Fetch.requestPaused",
                mark=metric_mark,
                predicate=lambda params: "/metrics/q_min" in params["request"]["url"],
                timeout=5,
            )
            paused.append(old_metric["requestId"])
            self.set_layer("EVENT_REI")
            try:
                self.page.command(
                    "Fetch.continueRequest",
                    {"requestId": old_metric["requestId"]},
                )
                paused.remove(old_metric["requestId"])
            except BrowserQAError:
                pass
            time.sleep(0.5)
            self.report.check(
                self.status() == ""
                and not self.evaluate(
                    "Boolean(document.querySelector('#assistantMessages "
                    "[data-result-kind=verified]'))"
                ),
                "switching metric prevents stale metric rendering",
            )

            self.set_layer("q_min")
            replacement_mark = self.page.event_mark()
            result_count = self.verified_result_count()
            self.click("#assistantExplainSection")
            first = self.page.wait_event(
                "Fetch.requestPaused",
                mark=replacement_mark,
                predicate=lambda params: "/sections/1081" in params["request"]["url"],
                timeout=5,
            )
            paused.append(first["requestId"])
            second_mark = self.page.event_mark()
            self.click("#assistantExplainMetric")
            second = self.page.wait_event(
                "Fetch.requestPaused",
                mark=second_mark,
                predicate=lambda params: "/metrics/q_min" in params["request"]["url"],
                timeout=5,
            )
            paused.append(second["requestId"])
            self.page.command(
                "Fetch.continueRequest",
                {"requestId": second["requestId"]},
            )
            paused.remove(second["requestId"])
            self.wait_verified_result(result_count, "relative standing")
            self.report.check(
                self.evaluate(
                    "document.querySelectorAll('#assistantMessages "
                    "[data-result-kind=verified]').length"
                )
                == 1
                and not self.evaluate(
                    "Boolean(document.querySelector('#assistantMessages .assistant-pending'))"
                )
                and "relative standing" in self.message_text(),
                "a new action cancels the prior request without duplicate current responses",
            )
        finally:
            for request_id in paused:
                try:
                    self.page.command(
                        "Fetch.failRequest",
                        {"requestId": request_id, "errorReason": "Aborted"},
                        timeout=2,
                    )
                except BrowserQAError:
                    pass
            try:
                self.page.command("Fetch.disable")
            except BrowserQAError:
                pass

    def final_console_and_network_acceptance(self) -> None:
        exceptions = self.page.events_since(
            self.console_mark, "Runtime.exceptionThrown"
        )
        console_errors = [
            event
            for event in self.page.events_since(
                self.console_mark, "Runtime.consoleAPICalled"
            )
            if event.get("params", {}).get("type") == "error"
        ]
        self.report.check(
            not exceptions,
            "browser recorded no uncaught JavaScript exceptions",
            json.dumps(exceptions[-3:], default=str),
        )
        self.report.check(
            not console_errors,
            "browser console recorded no application errors",
            json.dumps(console_errors[-3:], default=str),
        )
        api = self.api_requests(0)
        allowed = re.compile(
            rf"^{re.escape(BACKEND_ORIGIN)}/api/v1/(?:sections/[1-9][0-9]*|"
            r"metrics/[a-z0-9_]+|reports/review-note)$"
        )
        self.report.check(
            all(allowed.fullmatch(item["request"]["url"]) for item in api),
            "browser used only accepted Assistant endpoint paths",
        )
        self.report.check(
            not any("/health" in item["request"]["url"] for item in api),
            "browser made no /health prerequisite request",
        )
        all_request_urls = [
            event.get("params", {}).get("request", {}).get("url", "")
            for event in self.page.events_since(0, "Network.requestWillBeSent")
        ]
        self.report.check(
            not any(
                re.match(r"^https?://(?:127\.0\.0\.1|localhost):11434(?:/|$)", url)
                for url in all_request_urls
            ),
            "browser never contacts the model runtime port directly",
        )
        visible_text = self.evaluate("document.body.innerText")
        restricted = re.compile(
            r"(?:[A-Za-z]:\\|file://|Traceback|services/resilience-agent|data/tier3|"
            r"\bQwen(?:3)?\b|\bOllama\b|\bFastAPI\b|qwen3:8b)",
            re.IGNORECASE,
        )
        self.report.check(
            restricted.search(visible_text) is None,
            "visible UI exposes no internal path, traceback, or implementation branding",
        )


def verify_frontend_available() -> None:
    try:
        request = urllib.request.Request(LOCAL_URL, headers={"Connection": "close"})
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read().decode("utf-8")
    except (OSError, urllib.error.URLError) as error:
        raise BrowserQAError(
            f"Frontend is not available at {LOCAL_URL}; start the reviewed static server"
        ) from error
    if "./js/app.js" not in body or 'id="map"' not in body:
        raise BrowserQAError(
            "Frontend URL did not return the production v2 application"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        choices=("live", "full", "unavailable"),
        default="full",
        help=(
            "live: real backend success cases; full: live plus browser-blocked, "
            "timeout, cancellation, and stale-response cases; unavailable: require "
            "the backend to be stopped and verify the real network fallback"
        ),
    )
    parser.add_argument(
        "--chrome",
        type=Path,
        help="explicit installed Chrome executable (never a profile path)",
    )
    parser.add_argument(
        "--isolated-profile",
        type=Path,
        help=(
            "attach to an already launched, outer-owned sptc-phase2a4-cdp-* "
            "temp profile; intended only for job-constrained automation hosts"
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    verify_frontend_available()
    report = QAReport()
    with IsolatedChrome(args.chrome, args.isolated_profile) as chrome:
        qa = ProductionPageQA(chrome, report)
        if args.scenario == "unavailable":
            qa.actual_unavailable_acceptance()
        else:
            qa.local_template_acceptance()
            qa.backend_live_acceptance()
            if args.scenario == "full":
                qa.blocked_backend_fallback_acceptance()
                qa.delayed_request_acceptance()
        qa.final_console_and_network_acceptance()
    print(
        f"Phase 2A4 isolated production-page browser QA passed: "
        f"{len(report.checks)} checks ({args.scenario} scenario)."
    )
    for note in report.notes:
        print(f"NOTE: {note}")
    print("Isolated Chrome closed; temporary profile removed.")


if __name__ == "__main__":
    main()
