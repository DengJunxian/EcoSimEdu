import { useState } from "react";
import { catalog } from "../catalog";
import { LiquidityTransfer } from "./liquidity-transfer";
import "./education.css";

const bridges = [
  {
    title: "同一成交价背后的不同机制", cases: ["double_auction", "lemons_market"],
    question: "双向拍卖与柠檬市场的成交价相近。为辨认是否发生质量选择性退出，优先核对什么？",
    answers: ["只比较两组收盘价格", "核对挂牌报价与退出事件，并查退出前各方可见的质量信息",
      "只看两组最后各成交多少件"],
    correct: 1, detail: "用真实订单查撮合来源，用真实报价和退出事件查参与结构。价格相近仍可能对应不同的交易主体与机制。",
  },
  {
    title: "申请、到账与库存", cases: ["svb_run", "beer_game"],
    question: "银行收到 18 的提款申请，实付 8。门店下单 18 件，到货 8 件。两处的 10 各是什么？",
    answers: ["两处都已经交付", "银行的待付请求与门店的未到货订单", "银行的净资产与门店的实物库存"],
    correct: 1, detail: "10 在两个账里都是未兑现的数量。银行的 10 仍属待付请求，门店的 10 属于未到货订单。仍需各自核对原存款或库存余额。",
  },
  {
    title: "他人行动怎样改变我的判断", cases: ["schelling_segregation", "information_cascade", "svb_run"],
    question: "邻居搬走后，本地同类比例恰好超过阈值。另一情境中，同事多次转发同一条消息。两者怎样迁移？",
    answers: ["每次转发都应当像一次实际迁居那样改变阈值计数", "两种情境都可由单次动作证明全局机制",
      "迁居直接改变邻居集合。转发需先按原始信息源去重"],
    correct: 2, detail: "两者都涉及可见环境变化。空间模型计已占邻居，信念模型要核对信息来源与策略再更新。",
  },
  {
    title: "制度影响分配和资源成本", cases: ["double_auction", "public_goods", "carbon_market"],
    question: "制度 A 收 6 元转给平台，制度 B 收 6 元并花 2 元买耗材。交易数量、价值和原成本相同，B 的社会资源成本多多少？",
    answers: ["2 元", "6 元", "0 元"],
    correct: 0, detail: "账户之间转移可相抵，两元耗材需要计入。当制度也改变成交数量或减排配置时，还要另算可用机会或减排资源成本。",
  },
];

export function BridgePractice() {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const teacher = new URLSearchParams(location.search).get("review") === "svb-flash";
  if (teacher) return <main id="main" tabIndex={-1} className="container app-page app-inner">
    <h1>跨课作答复核</h1><a href="/practice#liquidity-transfer">返回跨课练习</a>
    <LiquidityTransfer teacher/>
  </main>;
  return <main id="main" tabIndex={-1} className="container app-page app-inner">
    <h1>跨课练习</h1><p>用独立教学情境做自查。这里的选择不计入课程独立应用记录。</p>
    <LiquidityTransfer/>
    {bridges.map((bridge, index) => <section key={bridge.title} className="education-task">
      <h2>{bridge.title}</h2>
      <fieldset className="education-answer"><legend>{bridge.question}</legend>
        {bridge.answers.map((answer, position) => <label className="education-option" key={answer}>
          <input type="radio" checked={answers[index] === position} name={bridge.title}
            onChange={() => setAnswers(previous => ({ ...previous, [index]: position }))}/>{answer}
        </label>)}
      </fieldset>
      {answers[index] !== undefined && <p role="status">{answers[index] === bridge.correct ? "核对一致。" : "请再核对口径。"}{bridge.detail}</p>}
      <div className="toolbar">{bridge.cases.map(caseId => <a key={caseId} href={`/cases/${caseId}`}>{
        catalog.find(course => course.case_id === caseId)?.title
      }</a>)}</div>
    </section>)}
  </main>;
}
