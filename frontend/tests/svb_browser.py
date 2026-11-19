"""Exercise the student-facing SVB lesson using only built static assets."""
import sys

from chart_probe import click_turning_point
from playwright.sync_api import expect, sync_playwright


base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8776/explore").rstrip("/")
engine = sys.argv[2] if len(sys.argv) > 2 else "chromium"


def walk(page):
    page.goto(base + "/?lesson=svb_run")
    heading = page.get_by_role("heading", level=1)
    expect(heading).to_have_text("银行有资产，工资款为什么还没到账？")
    expect(page.get_by_text("本次工资款", exact=True)).to_be_visible()
    expect(page.get_by_text("19 资金单位", exact=True)).to_be_visible()
    expect(page.get_by_text("储户、金额和轮次来自教学模型", exact=False)).to_be_visible()
    expect(page.get_by_role("region", name="微观个体画布")).to_have_count(0)
    expect(page.get_by_role("slider")).to_have_count(0)
    page.get_by_text("查看历史来源", exact=True).press("Enter")
    expect(page.get_by_role("link", name="美联储《硅谷银行监管复盘》", exact=False)).to_be_visible()
    page.get_by_text("查看历史来源", exact=True).press("Enter")

    page.get_by_role("button", name="第一轮提交", exact=True).press("Enter")
    page.get_by_role("button", name="提交申请时", exact=True).press("Enter")
    page.get_by_role("button", name="观察个体决策").press("Enter")
    expect(heading).to_have_text("微观机制透视")
    expect(heading).to_be_focused()
    board = page.get_by_role("region", name="微观个体画布")
    nodes = board.locator("svg").get_by_role("button")
    expect(nodes).to_have_count(30)
    expect(page.get_by_role("region", name="宏观指标曲线")).to_have_count(0)
    expect(page.get_by_role("slider")).to_have_count(0)
    board.get_by_role("button", name="你 · D01 企业", exact=False).press("Enter")
    inspector = page.get_by_role("complementary", name="个体决策透视")
    expect(inspector).to_contain_text("存款 45")
    clock = page.get_by_role("group", name="时间轴")
    expect(clock.get_by_role("button")).to_have_count(4)
    clock.get_by_role("button", name="单步前进").press("Enter")
    prediction = page.get_by_role("region", name="核对入场预测")
    expect(prediction).to_contain_text("D01 在第 1 轮提出申请")
    expect(prediction).to_contain_text("实际支付时，这笔款项才使银行现金和存款负债同减")
    expect(inspector).to_contain_text("D01 到账 19")
    page.get_by_role("button", name="后退一步").press("Enter")
    expect(inspector).to_contain_text("存款 45")
    expect(prediction).to_have_count(0)
    clock.get_by_role("button", name="单步前进").press("Enter")
    board.get_by_role("button", name="第 31–60 位", exact=True).press("Enter")
    expect(nodes).to_have_count(30)
    board.get_by_role("button", name="储户 D60", exact=False).press("Enter")
    expect(inspector.get_by_role("heading", name="储户 D60")).to_be_visible()
    page.get_by_role("button", name="观察群体变化").press("Enter")

    expect(heading).to_have_text("宏微观双屏联动")
    macro = page.get_by_role("region", name="宏观指标曲线")
    expect(macro.locator("canvas")).to_be_visible()
    clock.get_by_role("button", name="播放").click()
    expect(page.locator(".turning-point")).to_contain_text("待付 107")
    expect(clock.get_by_role("button", name="暂停")).to_be_disabled()
    expect(page.locator('[data-financial-move="down"]')).to_have_text("-1")
    expect(page.locator('[data-financial-move="down"]')).to_have_css("color", "rgb(20, 98, 71)")
    expect(macro.locator(".bank-readout div").filter(has_text="银行权益")).to_contain_text("155")
    expect(board.locator(".actor-contributor").first).to_be_visible()
    expect(page.get_by_role("slider")).to_have_count(0)
    page.get_by_text("核对本轮银行账表", exact=True).press("Enter")
    expect(page.get_by_text("待付 = 累计申请", exact=False)).to_be_visible()

    board.get_by_role("button", name="储户 D02", exact=False).press("Enter")
    expect(inspector).to_contain_text("去掉已见邻居项便低于阈值")
    inspector.get_by_role("button", name="查看 D01 的第 1 轮申请").press("Enter")
    expect(board.get_by_text("第 1 轮", exact=True)).to_be_visible()
    expect(inspector).to_contain_text("D01 到账 19")
    click_turning_point(macro.locator("canvas"))
    expect(board.get_by_text("第 2 轮", exact=True)).to_be_visible()

    clock.get_by_role("button", name="单步前进").press("Enter")
    expect(board.get_by_text("第 3 轮", exact=True)).to_be_visible()
    board.get_by_role("button", name="你 · D01 企业", exact=False).press("Enter")
    expect(inspector).to_contain_text("上轮待付 107")
    expect(inspector).to_contain_text("其他信号已足以达到阈值")
    inspector.get_by_role("button", name="查看影响决策的第 2 轮指标").press("Enter")
    expect(page.locator(".turning-point")).to_contain_text("权益为 155")
    page.get_by_text("从指标数值反查事件", exact=True).press("Enter")
    expect(page.get_by_role("button", name="定位第 4 轮")).to_have_count(0)
    page.get_by_role("button", name="试一项政策").press("Enter")

    expect(heading).to_have_text("反事实与制度实验")
    run = page.get_by_role("button", name="运行并验证")
    expect(run).to_be_disabled()
    page.get_by_role("slider").fill("400")
    expect(run).to_be_disabled()
    page.get_by_role("radio", name="增加").check()
    run.press("Enter")
    result = page.get_by_role("region", name="反事实对照结果")
    expect(result.get_by_text("原预测：增加。实际：减少。", exact=False)).to_be_visible()
    expect(result.get_by_text("期末待付金额 257 资金单位")).to_be_visible()
    expect(result.get_by_text("期末待付金额 97 资金单位")).to_be_visible()
    expect(result.get_by_text("期末银行权益 -120 资金单位")).to_be_visible()
    expect(result.locator("canvas")).to_have_count(2)
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")

    form = page.get_by_role("region", name="用两次运行解释机制")
    payment_ids = []
    for label in ("无干预证据", "政策组证据"):
        select = form.get_by_label(label)
        payment = select.locator("option").filter(has_text="D01 到账 19").first
        value = payment.get_attribute("value")
        assert value.startswith("1/")
        payment_ids.append(value)
        select.select_option(value)
    for name, text in {
        "rule": "实际支付才会扣减现金。",
        "calculation": "D01 的实付令现金减少 19。",
        "difference": "现金再配置改变了期末待付。",
        "hypothesis": "现实提款顺序须独立核对。",
    }.items():
        form.locator(f"[name={name}]").fill(text)
    form.get_by_role("button", name="保存解释").press("Enter")
    expect(form.get_by_role("status")).to_contain_text(f"已引用基线事件 {payment_ids[0]}")
    form.get_by_role("link", name="在实验笔记打开已保存的解释").press("Enter")
    for name, value in zip(("基线", "政策组"), payment_ids, strict=True):
        page.get_by_role("link", name=f"查看{name}原事件 {value}").press("Enter")
        expect(heading).to_have_text(f"{name}原事件 · 第 1 轮 · {value}")
        expect(page.get_by_text("涉及主体 D01", exact=True)).to_be_visible()
        expect(page.get_by_text("本事件变化 · 银行现金 -19", exact=True)).to_be_visible()
        expect(page.get_by_role("table", name="该轮开始与结束的数值")).to_be_visible()
        page.get_by_role("link", name="返回已保存的解释").press("Enter")


with sync_playwright() as playwright:
    browser = getattr(playwright, engine).launch(**({"channel": "chrome"} if engine == "chromium" else {}))
    for width in (1180, 390):
        page = browser.new_page(viewport={"width": width, "height": 920}, reduced_motion="reduce")
        errors, unexpected = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def local_only(route):
            url = route.request.url
            if url.startswith(base + "/") and "/api/" not in url and route.request.method == "GET":
                route.continue_()
            else:
                unexpected.append(url)
                route.abort()

        page.route("**/*", local_only)
        walk(page)
        assert not errors and not unexpected, (errors, unexpected)
        print(f"{engine} {width}px: inputs, queue, both directions of trace, and fixed-seed policy verified")
        page.close()
    browser.close()
