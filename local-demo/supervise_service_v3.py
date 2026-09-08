"""V3 namespace for the shared, reviewed Windows Job Object supervisor."""

import subprocess

from supervise_service import main


if __name__ == "__main__":
    try:
        raise SystemExit(main(".runtime-v3"))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        raise SystemExit(1)
