import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import pytest


@pytest.fixture(scope="session")
def local_app(tmp_path_factory):
    root = Path(__file__).resolve().parents[1]
    test_dir = tmp_path_factory.mktemp("education-server")
    env = {key: value for key, value in os.environ.items()
           if key not in {"CIVITAS_LIVE_ENABLED", "OPENAI_API_KEY", "DEEPSEEK_API_KEY"}}
    env["CIVITAS_EDU_DB"] = str(test_dir / "test.sqlite")
    with (test_dir / "server.log").open("w+") as log:
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "services.simulation.api:app",
             "--host", "127.0.0.1", "--port", "0"],
            cwd=root, env=env, stdout=log, stderr=log,
        )
        try:
            for _ in range(100):
                log.seek(0)
                for line in log:
                    if "Uvicorn running on" in line:
                        url = line.split("Uvicorn running on ", 1)[1].split()[0]
                        try:
                            with urlopen(url + "/api/capabilities", timeout=1) as response:
                                assert response.status == 200
                        except URLError:
                            break
                        yield url
                        return
                if server.poll() is not None:
                    break
                time.sleep(.05)
            log.seek(0)
            pytest.fail(f"Local server startup failed: {log.read()}")
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
