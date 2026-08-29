#!/usr/bin/env python3
"""Prepare dependencies and launch the Tech180 backend and frontend."""

# These are all part of Python's standard library, so they do not need pip.
# Each module handles one job: files, processes, networking, timing, or browsers.
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

from stop_tech180 import stop_pid_file


# This section defines the important folders and port numbers in one place.
# A port is like a numbered door that a local web service listens through.
ROOT = Path(__file__).resolve().parent
# Keep every path relative to this script so it works from Finder or Terminal.
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
PYTHON = VENV / "bin" / "python"
API_PORT = 8050
APP_PORT = 4050
ENV_FILE = ROOT / ".env"


def ensure_local_env() -> None:
    """Create a private development .env the first time Tech180 starts.

    The generated token is random and exists only on this Mac. Git ignores the
    file, so the credential cannot accidentally become part of a commit.
    """
    if ENV_FILE.exists():
        return

    token = secrets.token_urlsafe(48)
    ENV_FILE.write_text(
        "TECH180_ENV=development\n"
        f"TECH180_API_TOKEN={token}\n"
        "TECH180_ALLOWED_ORIGINS=http://127.0.0.1:4050,http://localhost:4050\n",
        encoding="utf-8",
    )
    # Only this macOS account should be able to read or change the secret file.
    ENV_FILE.chmod(0o600)
    print("Created private local settings in Tech180/.env")


def load_local_env() -> dict[str, str]:
    """Read simple KEY=VALUE settings from the project-root .env file."""
    values: dict[str, str] = {}
    for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def run(args, cwd=None) -> None:
    """Run a setup command and stop immediately if that command fails.

    ``args`` is a list such as ["npm", "install"]. ``cwd`` optionally tells
    the command which folder it should treat as its working directory.
    """
    # check=True turns a failed command into an error instead of continuing
    # with a half-installed application.
    subprocess.run(args, cwd=cwd, check=True)


def port_available(port: int) -> bool:
    """Return True when localhost can bind to the requested TCP port."""
    # A socket is one endpoint of a network connection. Here we temporarily
    # ask macOS whether our program may claim this port.
    with socket.socket() as sock:
        # macOS briefly remembers recently closed connections. SO_REUSEADDR lets
        # Tech180 restart during that cooldown while still rejecting a real listener.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            # If bind works, nothing else is currently listening on this port.
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            # OSError usually means another application already owns the port.
            return False


def wait_for(url: str, seconds: int = 30) -> bool:
    """Poll a URL until its service responds or the time limit expires."""
    # Check twice per second. This is better than assuming a server becomes
    # ready immediately after its process starts.
    for _ in range(seconds * 2):
        try:
            # Opening the URL proves the server can receive an HTTP request.
            with urllib.request.urlopen(url, timeout=1):
                return True
        except Exception:
            # Startup errors are normal during these first few attempts, so wait
            # briefly and try again instead of ending the whole launcher.
            time.sleep(0.5)
    # Reaching this line means every attempt failed.
    return False


def spawn(args, cwd: Path, log_path: Path, env=None) -> subprocess.Popen:
    """Start a background process and redirect its output into a log file."""
    # Opening with "w" starts a fresh log each time Tech180 launches.
    log = log_path.open("w")
    # Popen starts the command without waiting for it to finish. That is needed
    # because both web servers must stay running at the same time.
    return subprocess.Popen(
        args,
        cwd=cwd,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        # A separate session lets the service continue after this launcher exits.
        start_new_session=True,
    )


def main() -> None:
    """Install requirements, launch both services, verify them, and open the app."""
    # Python and npm are system-level prerequisites that this project cannot
    # safely install by itself.
    for command in ("python3", "npm"):
        # shutil.which searches the Mac's command path for the program.
        if not shutil.which(command):
            raise SystemExit(f"Missing {command}. Install Python 3 and Node.js, then try again.")

    # Both servers receive the same private development configuration. Existing
    # shell/hosting variables win, which keeps production settings separate.
    ensure_local_env()
    runtime_env = os.environ.copy()
    for key, value in load_local_env().items():
        runtime_env.setdefault(key, value)

    # PID files record the process IDs from the previous launch. Stop those
    # processes first so repeated launches do not create duplicate servers.
    for pid_file in (ROOT / ".tech180.pid", ROOT / ".tech180.api.pid"):
        stop_pid_file(pid_file)

    # A virtual environment isolates Tech180's Python packages from macOS and
    # other Python projects.
    if not PYTHON.exists():
        print("Creating Python environment...")
        # sys.executable is the Python interpreter currently running this file.
        run([sys.executable, "-m", "venv", str(VENV)])

    # pip and npm are incremental: already-installed packages are reused.
    print("Installing Python dependencies...")
    run([str(PYTHON), "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])

    # The importer launches the Mac's installed Google Chrome (`channel="chrome"`).
    # Running `playwright install chromium` here downloaded a second browser and
    # could hang every startup when the network was slow or unavailable.
    print("Using installed Google Chrome for browser rendering.")

    # Install frontend packages only on a dry startup. Existing node_modules is
    # immediately reusable and should not delay every normal launch.
    if not (FRONTEND / "node_modules").exists():
        print("Installing frontend dependencies...")
        run(["npm", "install"], cwd=FRONTEND)
    else:
        print("Frontend dependencies are already installed.")

    # Check before starting so an unrelated app is never silently replaced.
    for port in (API_PORT, APP_PORT):
        if not port_available(port):
            # Do not kill an unknown program; tell the user which port is busy.
            raise SystemExit(f"Port {port} is occupied by another process.")

    # Uvicorn serves the FastAPI backend. Its PID is saved for clean shutdown.
    api = spawn(
        # "app.main:app" means: load the variable named app from app/main.py.
        [str(PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(API_PORT)],
        BACKEND,
        ROOT / ".tech180.api.log",
        runtime_env,
    )
    # Save the process ID so stop_tech180.py knows exactly what to stop later.
    (ROOT / ".tech180.api.pid").write_text(str(api.pid))

    # React reads these environment variables when its development server starts.
    frontend_env = runtime_env.copy()
    # HOST and PORT choose the frontend address. REACT_APP_API_BASE tells React
    # where its Python API lives. BROWSER=none prevents npm from opening a tab.
    frontend_env.update(
        HOST="127.0.0.1",
        PORT=str(APP_PORT),
        REACT_APP_API_BASE=f"http://127.0.0.1:{API_PORT}",
        # This is acceptable only for local development. React variables are
        # bundled into browser code and must never contain production secrets.
        REACT_APP_TECH180_API_TOKEN=runtime_env.get("TECH180_API_TOKEN", ""),
        BROWSER="none",
    )
    app = spawn(["npm", "start"], FRONTEND, ROOT / ".tech180.log", frontend_env)
    (ROOT / ".tech180.pid").write_text(str(app.pid))

    # A running process is not necessarily ready to accept requests, so test the
    # actual HTTP endpoints before reporting success.
    if not wait_for(f"http://127.0.0.1:{API_PORT}/docs") or not wait_for(f"http://127.0.0.1:{APP_PORT}"):
        # If either half fails, stop both halves. Leaving only one server running
        # would make the next startup confusing and could occupy a needed port.
        for pid_file in (ROOT / ".tech180.pid", ROOT / ".tech180.api.pid"):
            stop_pid_file(pid_file)
        raise SystemExit("Tech180 failed to start. Check the .tech180 log files.")

    print(f"Tech180 is running at http://127.0.0.1:{APP_PORT}")
    print(f"Tech180 API is running at http://127.0.0.1:{API_PORT}")
    # This optional setting is useful for automated testing, where opening a real
    # browser window would be unwanted.
    if os.environ.get("TECH180_SKIP_OPEN") != "1":
        webbrowser.open(f"http://127.0.0.1:{APP_PORT}")


# Python sets __name__ to "__main__" only when this file is run directly.
# This prevents main() from starting Tech180 if another file merely imports it.
if __name__ == "__main__":
    main()
