"""Single-asset liquidity model with a paired sale schedule."""
from random import Random

from .market_tape import MarketTape

MAKERS = ("做市者 0（学生）", *(f"做市者 {i}" for i in range(1, 5)))
BUYERS = tuple(f"被动买家 {i:02}" for i in range(17))
SELLERS = tuple(f"被动卖家 {i:02}" for i in range(17))
PROGRAM = "卖出程序"


def simulate(case, scenario_id, seed, action):
    parameters = next(item["parameters"] for item in case["scenarios"] if item["id"] == scenario_id)
    options = {"tight": 12, "patient": 30}
    if action not in options:
        raise ValueError("unknown student inventory limit")
    cash, shares = 250_000, 55
    accounts = {actor: {"cash": cash, "shares": shares} for actor in (*MAKERS, *BUYERS, *SELLERS)}
    rng = Random(seed)
    releases = [{"time": 55 + 4 * i, "quantity": rng.randint(20, 26)} for i in range(12)]
    accounts[PROGRAM] = {"cash": 0, "shares": sum(release["quantity"] for release in releases)}
    root = {"accounts": accounts, "exogenous_events": releases, "action": action}
    executed = queued = 0
    tape = MarketTape(root, root, parameters, "flash-crash/1", lambda: {
        "program_filled": executed, "program_queued": queued,
    })

    def fill_program(amount):
        nonlocal executed
        executed += amount

    tape.emit("opening", f"卖出程序本场计划释放 {accounts[PROGRAM]['shares']} 股，初始库存已到账。",
              [PROGRAM, MAKERS[0]], plan_shares=accounts[PROGRAM]["shares"])
    for i, actor in enumerate(MAKERS):
        for price in (998 - i * 2, 978 - i * 2):
            tape.submit(actor, "buy", price, 18 * parameters["depth_multiplier"], "做市买量")
    for i, (buyer, seller) in enumerate(zip(BUYERS, SELLERS)):
        tape.submit(buyer, "buy", 959 - 5 * i, 6, "被动买量")
        tape.submit(seller, "sell", 1002 + i * 2, 4, "被动卖量")
    tape.submit(BUYERS[0], "buy", 1002, 1, "冲击前成交", immediate=True)

    limits = {actor: options[action] if i == 0 else 16 for i, actor in enumerate(MAKERS)}
    withdrawn = set()
    releases_by_time = {release["time"]: release["quantity"] for release in releases}
    for time in range(1, 201):
        tape.clock = time
        amount = releases_by_time.get(time)
        paused = parameters["pause_steps"] and 55 <= time < 55 + parameters["pause_steps"]
        reopening = parameters["pause_steps"] and time == 55 + parameters["pause_steps"]
        if paused and time == 55:
            message = ("卖出程序暂停至本次实验结束。计划继续累积，其他交易仍可撮合。"
                       if scenario_id == "boundary" else "开始固定暂停。卖出程序继续释放计划，订单簿等待重新开启。")
            tape.emit("pause", message,
                      [PROGRAM], pause_steps=parameters["pause_steps"])
        if amount:
            queued += amount
            tape.emit("release", f"卖出程序释放计划 {amount} 股。", [PROGRAM], quantity=amount)
        if reopening:
            tape.emit("resume", f"恢复撮合，{queued} 股计划将在本步尝试执行。", [PROGRAM])
        if queued and not paused:
            executable = queued
            queued = 0
            tape.submit(PROGRAM, "sell", 100, executable, "固定卖出程序",
                        immediate=True, after_fill=fill_program)
            if parameters["withdraw_on_inventory"]:
                for actor, limit in limits.items():
                    excess = tape.accounts[actor]["shares"] - shares
                    if excess < limit or actor in withdrawn:
                        continue
                    withdrawn.add(actor)
                    orders = [oid for oid, resting in tape.resting.items() if resting["actor"] == actor]
                    tape.emit("inventory_limit", f"{actor} 的净增库存 {excess} 股已达到 {limit} 股阈值，撤回剩余买量。",
                              [actor], excess=excess, limit=limit, active_orders=orders)
                    for order_id in orders:
                        tape.cancel(order_id, "库存达到撤单阈值")
        if time == 160:
            for actor in BUYERS[-4:]:
                tape.submit(actor, "buy", 982, 5, "恢复阶段被动买量")
            tape.submit(SELLERS[-1], "sell", 970, 2, "恢复阶段试成交", immediate=True)
        tape.emit("period_end", f"模型步 {time} 结束。", [PROGRAM, MAKERS[0]])
    return tape.result()
