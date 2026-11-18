"""Validate the published learning catalog and activity graphs."""
from collections import Counter
import json
import re

from services.simulation.learning_content import (
    ROOT, Outcome, check_outcomes, index, load_concepts, load_learning_package,
)
from services.simulation.lessons import CATALOG


def check():
    concepts = load_concepts()
    matrix = json.loads((ROOT / "cases/learning-outcomes.json").read_text())
    if matrix["schema_version"] != 1 or set(matrix["cases"]) != set(CATALOG):
        raise ValueError("learning outcomes catalog coverage")
    packages = 0
    prompts = set()
    for case_id, rows in matrix["cases"].items():
        outcomes = index([Outcome.model_validate(row) for row in rows], case_id)
        check_outcomes(outcomes, concepts)
        if len(outcomes) != 3 or not all(key.startswith(case_id + ".") for key in outcomes):
            raise ValueError(f"{case_id}: expected three course-scoped outcomes")
        try:
            package = load_learning_package(case_id)
            if package:
                packages += 1
                if package["outcomes"] != rows:
                    raise ValueError("package outcome definitions differ from catalog")
                for item in package["items"]:
                    normalized = re.sub(r"\s+", "", item["prompt"])
                    if normalized in prompts:
                        raise ValueError(f'{item["id"]}: duplicate teaching prompt')
                    prompts.add(normalized)
        except ValueError as exc:
            raise ValueError(f"{case_id}: {exc}") from exc

    if packages != len(CATALOG):
        raise ValueError(f"published learning packages incomplete: {packages}/{len(CATALOG)}")
    return len(matrix["cases"]), sum(map(len, matrix["cases"].values())), packages


if __name__ == "__main__":
    cases, outcomes, packages = check()
    print(f"{cases} courses, {outcomes} learning outcomes, {packages} validated v3 packages")
    slots = Counter()
    for case_id in CATALOG:
        package = load_learning_package(case_id)
        for item in package["items"] if package else ():
            if item["kind"] == "single_choice":
                answer = item["evaluator"]["answer"]
                options = item["response_schema"]["options"]
                slots.update([next(index for index, option in enumerate(options, 1) if option["id"] == answer)])
    print(f"Authored answer positions (runtime shuffles by variant): {dict(sorted(slots.items()))}")
    if slots and max(slots.values()) / slots.total() > .6:
        print("Review authored option position concentration.")
