import os

import pytest


@pytest.fixture
def chromium_options():
    options = {"headless": os.environ.get("CIVITAS_TEST_HEADED") != "1"}
    if executable := os.environ.get("CIVITAS_TEST_CHROMIUM"):
        return {**options, "executable_path": executable}
    return {**options, "channel": "chrome"}
