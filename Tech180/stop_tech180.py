#!/usr/bin/env python3
"""Stop the Tech180 processes recorded by the startup script."""

# os communicates with running processes, signal supplies standard stop signals,
# time creates a short waiting period, and Path handles filesystem paths.
import os
import signal
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
# The frontend and backend each have their own saved process ID (PID).
PID_FILES = (ROOT / ".tech180.pid", ROOT / ".tech180.api.pid")


def stop_pid_file(path: Path) -> None:
    """Stop one recorded process, escalating only if graceful shutdown stalls.

    A PID file is a tiny text file containing the unique number macOS assigned
    to a running process. It lets us stop Tech180 without guessing.
    """
    # No PID file usually means this service is already stopped.
    if not path.exists():
        return

    try:
        # SIGTERM asks the process to clean up and exit normally.
        pid = int(path.read_text().strip())
        # The frontend starts child processes (npm -> React -> Node). Because the
        # launcher created a separate process group, one signal can stop the
        # parent and every child instead of leaving a server behind on its port.
        os.killpg(pid, signal.SIGTERM)

        # Check for up to five seconds. Sending signal 0 does not stop anything;
        # it only asks macOS whether that process still exists.
        for _ in range(20):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                # macOS cannot find the PID, so shutdown succeeded.
                break
            time.sleep(0.25)
        else:
            # A for-loop's else block runs only when the loop never used break.
            # SIGKILL is the last resort when a process ignores SIGTERM.
            os.killpg(pid, signal.SIGKILL)
    except (ValueError, ProcessLookupError, PermissionError):
        # The file may be damaged, the process may already be gone, or macOS may
        # reject access. None of those should prevent cleanup of the PID file.
        pass
    finally:
        # A stale PID file could point at an unrelated future process, so remove it.
        path.unlink(missing_ok=True)


# Only perform shutdown when this file is run directly, not when its helper
# function is imported by start_tech180.py.
if __name__ == "__main__":
    # Stop the frontend and backend one at a time.
    for pid_file in PID_FILES:
        stop_pid_file(pid_file)
    print("Tech180 services stopped.")
