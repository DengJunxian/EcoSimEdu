"""The observer replay can export a run. Guided students receive its visible prefix."""
import pytest

from test_auction_classroom import launch as launch_auction
from test_education_api import call
from test_flagship_projection import launch


@pytest.mark.parametrize("case_id", ["schelling_segregation", "svb_run", "information_cascade",
                                     "public_goods", "beer_game"])
def test_guided_prefix_stays_on_the_same_run(local_app, case_id):
    key = launch(local_app, case_id)
    run = call(local_app, f"/api/runs/{key}/export")
    result = run["result"]
    assert len(result["events"]) == len(result["snapshots"])
    for tick in (0, 2):
        view = call(local_app, f"/api/runs/{key}/classroom-view?tick={tick}")
        assert (view["run_id"], view["result_hash"]) == (key, run["result_hash"])
        assert view["end"] is None
        assert [event["seq"] for event in view["events"]] == list(range(tick + 1))
        assert [point["metrics"] for point in view["series"]] == [
            frame["metrics"] for frame in result["snapshots"][:tick + 1]
        ]
        assert view["frame"]["tick"] == tick
        if view["previous"]:
            assert view["previous"]["tick"] == tick - 1
        if case_id == "svb_run":
            assert [row["tick"] for row in view["details"]["series"]] == list(range(tick + 1))
            assert view["details"]["checkpoint"] is None
        if case_id == "information_cascade":
            for event in view["events"]:
                assert not {"signal", "signal_id", "private_a_after_pct", "state"} & event.keys()
            for entity in view["frame"]["entities"].values():
                assert "私人抽样" not in entity


def test_reveal_bounded_tutor_respects_auction_private_settlement(local_app):
    key = launch_auction(local_app)
    result = call(local_app, f"/api/runs/{key}/export")["result"]
    trade = next(event for event in result["events"] if event["event_type"] == "trade")
    tick = trade["tick"]
    projected = call(local_app, f"/api/runs/{key}/auction-view?tick={tick}&explain=true")
    assert [event["seq"] for event in projected["events"]] == list(range(tick + 1))
    assert not {"value", "cost", "buyer_surplus", "seller_surplus"} & projected["settlement"].keys()
    assert projected["private_information"] is None and "surplus" not in projected["frame"]

    payload = {"case_id": "double_auction", "question": "当前累计总剩余是多少",
               "run_id": key, "tick": tick}
    guided = call(local_app, "/api/tutor", {**payload, "reveal_until": tick})
    assert "累计总剩余在当前课堂视图未揭示" in guided["answer"]
    observable = call(local_app, "/api/tutor", {
        **payload, "question": "当前最近成交价是多少", "reveal_until": tick,
    })
    assert f'最近成交价为 {trade["price"]} 代币/件' in observable["answer"]
    review = call(local_app, "/api/tutor", payload)
    assert f'累计总剩余为 {result["snapshots"][tick]["surplus"]} 代币' in review["answer"]
