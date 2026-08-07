"""Run one local-demo service with bounded logs and kill-on-close ownership."""

from __future__ import annotations

import argparse
import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from typing import BinaryIO
from uuid import UUID


MAXIMUM_LOG_BYTES = 1_048_576
COMPACTION_SLACK_BYTES = 65_536
ALLOWED_LOG_NAMES = {
    "ollama.stdout.log",
    "ollama.stderr.log",
    "warmup.stdout.log",
    "warmup.stderr.log",
    "backend.stdout.log",
    "backend.stderr.log",
    "frontend.stdout.log",
    "frontend.stderr.log",
}
ALLOWED_GATE_NAMES = {
    "ollama.start.gate",
    "warmup.start.gate",
    "backend.start.gate",
    "frontend.start.gate",
}
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
CREATE_SUSPENDED = 0x00000004
START_GATE_TIMEOUT_SECONDS = 15.0


class IoCounters(ctypes.Structure):
    _fields_ = [
        ("read_operation_count", ctypes.c_ulonglong),
        ("write_operation_count", ctypes.c_ulonglong),
        ("other_operation_count", ctypes.c_ulonglong),
        ("read_transfer_count", ctypes.c_ulonglong),
        ("write_transfer_count", ctypes.c_ulonglong),
        ("other_transfer_count", ctypes.c_ulonglong),
    ]


class BasicLimitInformation(ctypes.Structure):
    _fields_ = [
        ("per_process_user_time_limit", ctypes.c_longlong),
        ("per_job_user_time_limit", ctypes.c_longlong),
        ("limit_flags", wintypes.DWORD),
        ("minimum_working_set_size", ctypes.c_size_t),
        ("maximum_working_set_size", ctypes.c_size_t),
        ("active_process_limit", wintypes.DWORD),
        ("affinity", ctypes.c_size_t),
        ("priority_class", wintypes.DWORD),
        ("scheduling_class", wintypes.DWORD),
    ]


class ExtendedLimitInformation(ctypes.Structure):
    _fields_ = [
        ("basic_limit_information", BasicLimitInformation),
        ("io_info", IoCounters),
        ("process_memory_limit", ctypes.c_size_t),
        ("job_memory_limit", ctypes.c_size_t),
        ("peak_process_memory_used", ctypes.c_size_t),
        ("peak_job_memory_used", ctypes.c_size_t),
    ]


def _is_reparse(path: Path) -> bool:
    return path.is_symlink() or (
        hasattr(os.path, "isjunction") and os.path.isjunction(path)
    )


def _validate_session_path(
    path: Path, logs_root: Path, allowed_names: set[str]
) -> Path:
    demo_root = logs_root.parent.parent
    for original in (demo_root, logs_root.parent, logs_root, path.parent):
        if not original.exists() or _is_reparse(original):
            raise ValueError(
                "Launcher runtime paths must exist without reparse points."
            )
    resolved_root = logs_root.resolve(strict=True)
    resolved_session = path.parent.resolve(strict=True)
    if resolved_session.parent != resolved_root:
        raise ValueError("Log path is outside the launcher logs root.")
    session_id = UUID(resolved_session.name)
    if resolved_session.name != str(session_id):
        raise ValueError("Log session directory is not a canonical GUID.")
    if path.name not in allowed_names:
        raise ValueError("Runtime filename is not allowlisted.")
    if path.exists() and _is_reparse(path):
        raise ValueError("Reparse-point runtime files are not allowed.")
    return resolved_session / path.name


def _validate_log_path(path: Path, logs_root: Path) -> Path:
    return _validate_session_path(path, logs_root, ALLOWED_LOG_NAMES)


def _validate_gate_path(path: Path, logs_root: Path) -> Path:
    return _validate_session_path(path, logs_root, ALLOWED_GATE_NAMES)


def _wait_for_start_gate(path: Path, token: str) -> None:
    deadline = time.monotonic() + START_GATE_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if path.exists():
            if _is_reparse(path) or path.stat().st_size > 128:
                raise ValueError("The supervisor start gate is invalid.")
            supplied = path.read_text(encoding="ascii").strip()
            if supplied != token:
                raise ValueError("The supervisor start gate token does not match.")
            path.unlink()
            return
        time.sleep(0.05)
    raise TimeoutError("The parent did not authorize supervised service startup.")


def _create_kill_on_close_job() -> int:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    information = ExtendedLimitInformation()
    information.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    configured = kernel32.SetInformationJobObject(
        job,
        JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
        ctypes.byref(information),
        ctypes.sizeof(information),
    )
    if not configured:
        error = ctypes.get_last_error()
        kernel32.CloseHandle(wintypes.HANDLE(job))
        raise ctypes.WinError(error)
    return job


def _assign_current_process_to_job(job: int) -> None:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    current_process = kernel32.GetCurrentProcess()
    if not kernel32.AssignProcessToJobObject(job, current_process):
        raise ctypes.WinError(ctypes.get_last_error())


def _resume_process(process: subprocess.Popen[bytes]) -> None:
    ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
    ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]
    ntdll.NtResumeProcess.restype = wintypes.LONG
    status = ntdll.NtResumeProcess(wintypes.HANDLE(process._handle))
    if status != 0:
        raise OSError(
            f"NtResumeProcess failed with NTSTATUS 0x{status & 0xFFFFFFFF:08x}."
        )


def _close_handle(handle: int) -> None:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.CloseHandle(wintypes.HANDLE(handle))


def _pump_bounded(
    source: BinaryIO,
    destination: Path,
    errors: list[BaseException],
) -> None:
    try:
        with destination.open("w+b", buffering=0) as log_file:
            while True:
                chunk = source.read(8192)
                if not chunk:
                    break
                hard_limit = MAXIMUM_LOG_BYTES + COMPACTION_SLACK_BYTES
                if log_file.tell() + len(chunk) > hard_limit:
                    retained_size = max(0, MAXIMUM_LOG_BYTES - len(chunk))
                    log_file.seek(-retained_size, os.SEEK_END)
                    retained = log_file.read(retained_size)
                    log_file.seek(0)
                    log_file.write(retained)
                    log_file.truncate()
                    log_file.seek(0, os.SEEK_END)
                log_file.write(chunk)
    except BaseException as exc:  # surfaced to the supervising thread
        errors.append(exc)


def _decode_arguments(encoded: str) -> list[str]:
    payload = base64.b64decode(encoded, validate=True).decode("utf-8")
    value = json.loads(payload)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("Service arguments must be a JSON string array.")
    return value


def supervise(
    executable: Path,
    working_directory: Path,
    arguments: list[str],
    stdout_log: Path,
    stderr_log: Path,
    start_gate: Path,
    start_token: str,
) -> int:
    job = _create_kill_on_close_job()
    try:
        _assign_current_process_to_job(job)
    except BaseException:
        _close_handle(job)
        raise
    process: subprocess.Popen[bytes] | None = None
    try:
        _wait_for_start_gate(start_gate, start_token)
        process = subprocess.Popen(
            [str(executable), *arguments],
            cwd=str(working_directory),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW | CREATE_SUSPENDED,
        )
        try:
            _resume_process(process)
        except BaseException:
            process.kill()
            process.wait(timeout=3)
            raise
        assert process.stdout is not None
        assert process.stderr is not None
        errors: list[BaseException] = []
        stdout_thread = threading.Thread(
            target=_pump_bounded,
            args=(process.stdout, stdout_log, errors),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=_pump_bounded,
            args=(process.stderr, stderr_log, errors),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()
        while process.poll() is None:
            if errors:
                process.kill()
                break
            time.sleep(0.1)
        return_code = process.wait(timeout=3)
        stdout_thread.join(timeout=3)
        stderr_thread.join(timeout=3)
        if errors or stdout_thread.is_alive() or stderr_thread.is_alive():
            raise RuntimeError("Bounded service log capture failed.")
        return return_code
    finally:
        # The supervisor is itself a member of the kill-on-close job. The OS
        # closes this process-owned handle at supervisor exit and terminates any
        # descendant still alive; explicitly closing it here would kill the
        # supervisor before it can return the service exit code.
        pass


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--executable", required=True)
    parser.add_argument("--working-directory", required=True)
    parser.add_argument("--arguments-base64", required=True)
    parser.add_argument("--stdout-log", required=True)
    parser.add_argument("--stderr-log", required=True)
    parser.add_argument("--start-gate", required=True)
    parser.add_argument("--start-token", required=True)
    options = parser.parse_args()

    script_path = Path(os.path.abspath(__file__))
    if _is_reparse(script_path):
        raise ValueError("The supervisor script must not be a reparse point.")
    demo_root = script_path.parent
    logs_root = demo_root / ".runtime" / "logs"
    executable = Path(options.executable).resolve(strict=True)
    working_directory = Path(options.working_directory).resolve(strict=True)
    if not executable.is_file() or not working_directory.is_dir():
        raise ValueError("The supervised command path is invalid.")
    stdout_log = _validate_log_path(Path(options.stdout_log), logs_root)
    stderr_log = _validate_log_path(Path(options.stderr_log), logs_root)
    start_gate = _validate_gate_path(Path(options.start_gate), logs_root)
    start_token = str(UUID(options.start_token))
    if start_token != options.start_token:
        raise ValueError("The supervisor start token is not a canonical GUID.")
    if stdout_log.parent != stderr_log.parent or stdout_log == stderr_log:
        raise ValueError("Supervised log destinations are invalid.")
    return supervise(
        executable,
        working_directory,
        _decode_arguments(options.arguments_base64),
        stdout_log,
        stderr_log,
        start_gate,
        start_token,
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        raise SystemExit(1)
