from test_education_api import call
from test_flagship_projection import launch


def test_cascade_evidence_respects_observed_actions_and_masks_private_draws(local_app):
    case = "information_cascade"
    base = launch(local_app, case)
    branch = launch(local_app, case, "private", base)
    trace = lambda key, perspective, seq=3: call(
        local_app, f"/api/emergence/runs/{key}/trace?seq={seq}&as_of_seq={seq}&perspective={perspective}"
    )
    public = trace(base, "system")
    private = trace(branch, "system")
    assert public["focus"]["economic_time"] == private["focus"]["economic_time"] == 3
    assert [node["label"] for node in public["nodes"] if node["kind"] == "relation"] == [
        "D01 可见行动 B", "D02 可见行动 B",
    ]
    assert not any(node["kind"] == "relation" for node in private["nodes"])
    assert [node["value"] for node in public["nodes"] if node["kind"] == "system_metric"] == [20.0, 20.0]
    assert public["edges"][0]["label"] == "这次行动没有更新公共后验。"
    assert all("抽样" not in node["label"] for node in public["nodes"])
    assert trace(base, "role", seq=1)["nodes"] == []
    role = trace(base, "role")
    assert any(node["label"] == "本人抽样 A，选择 B。" for node in role["nodes"])
    for run_id, expected in ((base, 0), (branch, None)):
        share = call(local_app, f"/api/emergence/runs/{run_id}/trace"
                     "?seq=3&as_of_seq=3&metric_id=public_choice_a_pct")
        assert [node["value"] for node in share["nodes"] if node["kind"] == "system_metric"] == [expected]
