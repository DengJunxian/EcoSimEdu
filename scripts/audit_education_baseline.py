"""Local replay and mechanism audit. Run with python -m scripts.audit_education_baseline."""
import ast
import json
import subprocess
from collections import Counter
from pathlib import Path
from unittest.mock import patch

from core.competition_demo import advance_competition_demo, bootstrap_competition_demo, list_competition_scenarios
from core.exchange.order_book import OrderBook
from core.macro.state import MacroState
from core.reproducibility import config_hash
from core.social.contagion import SocialContagionEngine
from core.social.graph_state import SocialGraphState
from core.types import Order, OrderSide, OrderStatus, OrderType


def mechanism_checks():
    book = OrderBook("EDU", 100)
    book.add_order(Order("EDU", 101, 3, OrderSide.SELL, OrderType.LIMIT, "s1", 1))
    book.add_order(Order("EDU", 101, 5, OrderSide.SELL, OrderType.LIMIT, "s2", 2))
    fills = book.add_order(Order("EDU", 103, 6, OrderSide.BUY, OrderType.LIMIT, "b1", 3))
    assert [(t.seller_agent_id, t.quantity, t.price) for t in fills] == [("s1", 3, 101), ("s2", 3, 101)]
    fok = Order("EDU", 103, 3, OrderSide.BUY, OrderType.FOK, "b2", 4)
    assert not book.add_order(fok) and fok.status == OrderStatus.REJECTED
    assert book.cancel_order(fills[-1].maker_id)
    ioc = Order("EDU", 100, 2, OrderSide.BUY, OrderType.IOC, "b3", 5)
    assert not book.add_order(ioc) and book.get_best_bid() is None

    def spread():
        graph = SocialGraphState()
        graph.add_edge("a", "b")
        graph.add_edge("b", "c")
        engine = SocialContagionEngine(feature_flag=True, seed=42)
        return [engine.step(graph, MacroState(), rumor_shock=-0.3).node_sentiment for _ in range(5)]

    trajectory = spread()
    assert trajectory == spread()
    assert all(-1 <= value <= 1 for row in trajectory for value in row.values())
    return {"fills": [t.quantity for t in fills], "fok": fok.status.value,
            "ioc": ioc.status.value, "ioc_resting": False,
            "max_tokens_collision": config_hash({"max_tokens": 10}) == config_hash({"max_tokens": 100}),
            "social_fixed_seed_sentiment": trajectory[-1]}


def audit():
    paths = subprocess.check_output(["git", "ls-files", "-z"]).decode().strip("\0").split("\0")
    python_paths = [Path(p) for p in paths if p.endswith(".py")]
    for path in python_paths:
        ast.parse(path.read_bytes(), filename=str(path))
    news = [json.loads(line) for line in Path("data/seed_events.jsonl").read_text().splitlines()]
    duplicates = {
        key: len({str(row.get(key)).strip().casefold() for row in news})
        for key in ("event_id", "title", "raw_text", "source_url")
    }
    url_counts = Counter(str(row.get("source_url")) for row in news)
    demos = {}
    for name in list_competition_scenarios():
        state = {}
        scenario = bootstrap_competition_demo(state, name)
        frame = scenario.metrics
        assert frame.step.is_unique and frame.step.is_monotonic_increasing
        assert not frame.isna().any().any()
        assert (frame.high >= frame[["open", "close"]].max(axis=1)).all()
        assert (frame.low <= frame[["open", "close"]].min(axis=1)).all()
        assert (frame.volume >= 0).all() and frame.panic_level.between(0, 1).all()
        assert all(row["step"] in set(frame.step) for row in scenario.narration)
        result = advance_competition_demo(state, steps=len(frame))
        assert result["done"] and result["advanced"] == len(frame)
        demos[name] = {"steps": len(frame), "narration": len(result["narration"]),
                       "source_fields": sorted(set(frame) & {"origin", "source_url", "source_id", "seed"}),
                       "agent_fields": [field for field in frame if "agent" in field or "edge" in field]}
    assert len(demos) == 3
    return {"head": subprocess.check_output(["git", "rev-parse", "HEAD"]).decode().strip(),
            "tracked_files": len(paths), "python_files_parsed": len(python_paths),
            "news_rows": len(news), "distinct_normalized": duplicates,
            "source_counts": dict(url_counts), "demos": demos, **mechanism_checks()}


if __name__ == "__main__":
    with patch("socket.socket.connect", side_effect=AssertionError("external connection")):
        print(json.dumps(audit(), indent=2, ensure_ascii=False))
