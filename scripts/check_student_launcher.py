"""Start the teaching archive on a fresh loopback port and check both app shells."""
from contextlib import closing
import json
import os
from pathlib import Path
from socket import socket
from subprocess import DEVNULL, Popen, STDOUT, TimeoutExpired, run
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def check():
    with closing(socket()) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = {name: value for name, value in os.environ.items()
           if not name.startswith(("CIVITAS_", "UVICORN_", "OPENAI_", "DEEPSEEK_"))}
    windows = os.name == "nt"
    command = ["cmd.exe", "/d", "/c", "start-student-lab.cmd"] if windows else [
        "sh", str(ROOT / "start-student-lab.command"),
    ]
    with TemporaryDirectory(prefix="ecosimedu-launch-") as directory:
        temporary = Path(directory)
        env.update(UVICORN_PORT=str(port), CIVITAS_EDU_DB=str(temporary / "smoke.sqlite3"))
        with (temporary / "launch.log").open("w+") as log:
            with Popen(command, cwd=ROOT if windows else temporary, env=env,
                       stdin=DEVNULL, stdout=log, stderr=STDOUT, start_new_session=not windows) as launch:
                try:
                    deadline = monotonic() + 90
                    while launch.poll() is None and monotonic() < deadline:
                        try:
                            with urlopen(base + "/api/health", timeout=2) as response:
                                assert json.load(response)["published_cases"] == 12
                            break
                        except URLError:
                            sleep(.2)
                    else:
                        log.seek(0)
                        raise RuntimeError(log.read())
                    for route in ("/explore/", "/", "/learn/svb_run", "/notes", "/teach"):
                        with urlopen(base + route, timeout=5) as response:
                            assert response.headers.get_content_type() == "text/html", route
                    with urlopen(base + "/api/ai/status", timeout=5) as response:
                        assert response.headers["Cache-Control"] == "no-store"
                        assert json.load(response)["active"] is None
                finally:
                    if launch.poll() is None:
                        if windows:
                            run(["taskkill", "/pid", str(launch.pid), "/t", "/f"],
                                stdout=DEVNULL, stderr=DEVNULL, check=False)
                        else:
                            import signal

                            os.killpg(launch.pid, signal.SIGTERM)
                    try:
                        launch.wait(timeout=10)
                    except TimeoutExpired:
                        launch.kill()
                        launch.wait()
    print("Launcher started both classroom shells and exposed an empty local tutor session.")


if __name__ == "__main__":
    check()
