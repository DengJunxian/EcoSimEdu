"""Explicit mapping from published teaching cases to local rule modules."""
import json
from functools import lru_cache
from importlib import import_module

from .auction import BOUNDARIES, CASE, ROOT

CATALOG = tuple(json.loads((ROOT / "cases/catalog.json").read_text()))
MODULES = {
    "schelling_segregation": "schelling",
    "svb_run": "svb",
    "information_cascade": "cascade",
    "public_goods": "public_goods",
    "commons_governance": "commons",
    "lemons_market": "lemons",
    "school_matching": "matching",
    "beer_game": "beer",
    "carbon_market": "carbon",
    "flash_crash": "flash_crash",
    "gamestop": "gamestop",
}


@lru_cache
def load_case(case_id):
    if case_id not in CATALOG:
        raise KeyError(case_id)
    if case_id == CASE["case_id"]:
        return CASE
    return json.loads((ROOT / "cases" / case_id / "case.json").read_text())


def simulate(case, scenario_id, seed, action, *, decide=None):
    module = import_module(f".{MODULES[case['case_id']]}", __package__)
    if scenario_id == "boundary":
        parameters = BOUNDARIES[case["case_id"]]["parameters"]
        case = {**case, "scenarios": [*case["scenarios"], {"id": scenario_id, "parameters": parameters}]}
    if decide is None:
        return module.simulate(case, scenario_id, seed, action)
    return module.simulate(case, scenario_id, seed, action, decide=decide)


def briefing(case):
    if case["case_id"] != "schelling_segregation":
        return {}
    from .schelling import initial_board

    board = initial_board(case["seed"])
    return {
        "grid": {"size": board["size"], "cells": board["grid"],
                 "marked": [board["grid"].index("A001"), board["student_target"]]},
    }
