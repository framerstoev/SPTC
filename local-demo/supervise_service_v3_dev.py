"""Development namespace; unchanged shared Windows Job Object ownership."""

import subprocess

from supervise_service import main


if __name__ == "__main__":
    try:
        raise SystemExit(main(".runtime-v3-dev"))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        raise SystemExit(1)
