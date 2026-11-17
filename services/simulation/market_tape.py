"""Deterministic, fully funded teaching settlement over the repository LOB."""
from copy import deepcopy

from core.exchange.market_rules import MarketRuleSchema
from core.exchange.order_book import OrderBook
from core.types import Order, OrderSide, OrderStatus, OrderType

from .auction import digest


class MarketTape:
    def __init__(self, root, initial, parameters, engine_version, extra_metrics):
        self.root = root
        self.initial = initial
        self.parameters = parameters
        self.engine_version = engine_version
        self.accounts = deepcopy(initial["accounts"])
        self.extra_metrics = extra_metrics
        self.steps = []
        self.snapshots = []
        self.resting = {}
        self.clock = 0
        self.last = None
        self.low = None
        self.high = None
        self.volume = 0
        self.rules = MarketRuleSchema(
            symbol="EDU", prev_close=10_000, price_limit_pct=.99, min_price_tick=1,
            min_trade_unit=1, board_lot=1, commission_rate=0, stamp_duty_rate=0,
            supported_order_types=("limit", "ioc"), feature_flags={"strict_queue_timestamps": True},
            metadata={"price_unit": "USD cents", "quantity_unit": "shares", "time_unit": "model step",
                      "short_limit": "owned_or_delivered_borrow", "settlement": "immediate"},
        )
        self.book = OrderBook("EDU", market_rules=self.rules)

    def available(self, actor, side):
        account = self.accounts[actor]
        if side == "buy":
            reserved = sum(o["price"] * o["quantity"] for o in self.resting.values()
                           if o["actor"] == actor and o["side"] == "buy")
            return account["cash"] - reserved
        reserved = sum(o["quantity"] for o in self.resting.values()
                       if o["actor"] == actor and o["side"] == "sell")
        return account["shares"] - reserved

    def emit(self, event_type, summary, actors=(), relations=(), **fields):
        sequence = len(self.steps)
        self.steps.append({"seq": sequence, "tick": sequence, "time": self.clock,
                           "event_type": event_type, "summary": summary, "actors": list(actors), **fields})
        bids, asks = {}, {}
        for order in self.resting.values():
            levels = bids if order["side"] == "buy" else asks
            price = order["price"]
            levels[price] = levels.get(price, 0) + order["quantity"]
        spread = (min(asks) - max(bids)) / 100 if bids and asks else None
        metrics = dict(last_price=self.last, low_price=self.low, high_price=self.high,
                       volume=self.volume, bid_depth=sum(bids.values()), ask_depth=sum(asks.values()),
                       spread=spread, **self.extra_metrics())
        market = {f"买价 {price / 100:.2f} 的挂单股数": bids[price] for price in sorted(bids, reverse=True)[:4]}
        market.update({f"卖价 {price / 100:.2f} 的挂单股数": asks[price] for price in sorted(asks)[:4]})
        entities = {actor: {"现金（美元）": self.accounts[actor]["cash"] / 100,
                            "现有股票（股）": self.accounts[actor]["shares"],
                            "占用买单现金（美元）": (self.accounts[actor]["cash"] - self.available(actor, "buy")) / 100,
                            "占用卖单股票（股）": self.accounts[actor]["shares"] - self.available(actor, "sell"),
                            **({"股票交还义务（股）": self.accounts[actor]["debt"]}
                               if "debt" in self.accounts[actor] else {})}
                    for actor in dict.fromkeys(actors) if actor in self.accounts}
        self.snapshots.append({"tick": sequence, "metrics": metrics, "entities": {"订单簿": market, **entities},
                               "relations": list(relations)})
        return sequence

    def cancel(self, order_id, reason):
        order = self.resting.pop(order_id, None)
        if order is None:
            return
        if not self.book.cancel_order(order_id):
            raise RuntimeError("an active teaching order was not cancellable")
        self.emit("cancel", f"{order['actor']} 撤回 {order['quantity']} 股未成交挂单。",
                  [order["actor"]], [{"from": order["actor"], "to": "订单簿", "label": reason,
                                       "origin_seq": order["seq"]}], order_id=order_id,
                  quantity=order["quantity"], reason=reason)

    def submit(self, actor, side, price, quantity, purpose, *, immediate=False, after_fill=None):
        """Return executed shares. Both the input limit and resources constrain acceptance."""
        if side not in ("buy", "sell") or type(price) is not int or price < 100 or price > 19_900:
            raise ValueError("invalid order limit")
        if type(quantity) is not int or quantity <= 0:
            raise ValueError("quantity must be a positive integer")
        budget = self.available(actor, side)
        if (quantity * price if side == "buy" else quantity) > budget:
            self.emit("reject", f"{actor} 的订单超过可用资金或股票。", [actor], quantity=quantity,
                      side=side, price_cents=price, purpose=purpose)
            return 0
        opposing = [o for o in self.resting.values() if o["actor"] == actor and o["side"] != side]
        if any((side == "buy" and price >= o["price"]) or (side == "sell" and price <= o["price"])
               for o in opposing):
            self.emit("reject", f"{actor} 的订单会触及自己的对手挂单。", [actor], quantity=quantity,
                      side=side, price_cents=price, purpose=purpose)
            return 0
        order_seq = len(self.steps)
        order_id = f"O{order_seq}"
        self.emit("order_submitted", f"{actor} 提交{('买' if side == 'buy' else '卖')}单 {quantity} 股，上限或底价 {price / 100:.2f} 美元。",
                  [actor], [{"from": actor, "to": "订单簿", "label": purpose}],
                  order_id=order_id, side=side, price_cents=price, quantity=quantity, purpose=purpose)
        order = Order("EDU", price, quantity, OrderSide(side), OrderType.IOC if immediate else OrderType.LIMIT,
                      actor, order_seq + 1, order_id=order_id)
        fills = self.book.add_order(order)
        if order.status is OrderStatus.REJECTED:
            raise RuntimeError("native order book rejected a validated order")
        for trade in fills:
            buy, sell = trade.buyer_agent_id, trade.seller_agent_id
            price_filled, amount = int(trade.price), trade.quantity
            value = price_filled * amount
            self.accounts[buy]["cash"] -= value
            self.accounts[sell]["cash"] += value
            self.accounts[buy]["shares"] += amount
            self.accounts[sell]["shares"] -= amount
            maker = self.resting[trade.maker_id]
            maker["quantity"] -= amount
            if maker["quantity"] == 0:
                del self.resting[trade.maker_id]
            self.last = price_filled / 100
            self.low = min(self.last, self.low) if self.low is not None else self.last
            self.high = max(self.last, self.high) if self.high is not None else self.last
            self.volume += amount
            if after_fill is not None:
                after_fill(amount)
            buy_order = order_id if side == "buy" else trade.maker_id
            sell_order = order_id if side == "sell" else trade.maker_id
            self.emit("trade", f"{buy} 向 {sell} 买入 {amount} 股，成交价 {self.last:.2f} 美元。",
                      [buy, sell], [{"from": sell, "to": buy, "label": f"交割 {amount} 股",
                                     "origin_seq": maker["seq"]}], price_cents=price_filled, quantity=amount,
                      buyer=buy, seller=sell, buy_order_id=buy_order, sell_order_id=sell_order,
                      maker_id=trade.maker_id, purpose=purpose)
        remainder = quantity - order.filled_qty
        if remainder:
            if immediate:
                self.book.cancel_order(order_id)
                self.emit("unfilled", f"{actor} 有 {remainder} 股未成交，立即撤销余量。",
                          [actor], order_id=order_id, quantity=remainder, purpose=purpose)
            else:
                self.resting[order_id] = dict(actor=actor, side=side, price=price, quantity=remainder, seq=order_seq)
                self.emit("rest", f"{actor} 的 {remainder} 股挂在订单簿上。",
                          [actor], order_id=order_id, quantity=remainder)
        return order.filled_qty

    def result(self):
        metrics = self.snapshots[-1]["metrics"]
        return {"engine_version": self.engine_version, "market_rules": self.rules.to_dict(),
                "initial": self.initial, "root_hash": digest(self.root), "initial_hash": digest(self.initial),
                "intervention": self.parameters, "events": self.steps, "snapshots": self.snapshots, "metrics": metrics}
