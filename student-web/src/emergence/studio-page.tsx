import { useEffect, useState } from "react";
import { catalog } from "../catalog";
import { api } from "../contracts";
import { coreMetrics } from "./trace-view";
import "./studio.css";

type Entry = {
  caseId: string;
  depth: "基础观察" | "事件追踪" | "配对探究";
  observe: string;
};

const groups: { title: string; entries: Entry[] }[] = [
  { title: "社会互动", entries: [
    { caseId: "schelling_segregation", depth: "配对探究", observe: "居民阈值、搬迁和受影响邻居、满意率与同类邻接率。" },
    { caseId: "information_cascade", depth: "事件追踪", observe: "私人线索、可观察的前序行动、公共后验与信息增量。" },
  ] },
  { title: "分散协调", entries: [
    { caseId: "double_auction", depth: "事件追踪", observe: "私人估值与合法报价、两侧订单撮合、成交价与累计剩余。" },
    { caseId: "lemons_market", depth: "事件追踪", observe: "可见质量、报价与退出、实际交割和剩余。" },
    { caseId: "school_matching", depth: "事件追踪", observe: "学生志愿与学校规则、申请和拒绝链、席位分配。" },
  ] },
  { title: "网络与流动性", entries: [
    { caseId: "svb_run", depth: "事件追踪", observe: "储户现金需求、消息与申请实付、银行资金和待付。" },
    { caseId: "flash_crash", depth: "基础观察", observe: "做市与卖出订单、撤单及撮合、成交价和订单深度。" },
    { caseId: "gamestop", depth: "基础观察", observe: "交易与借券义务、消息和订单、价格与回补压力。" },
  ] },
  { title: "库存反馈", entries: [
    { caseId: "beer_game", depth: "事件追踪", observe: "角色库存、发货与到货批次、积压和周订单放大。" },
  ] },
  { title: "资源与制度", entries: [
    { caseId: "public_goods", depth: "事件追踪", observe: "个人贡献、公共回报与定向制裁、群体净收益和反馈。" },
    { caseId: "commons_governance", depth: "基础观察", observe: "取用量、配额与监督、资源余额和自然再生。" },
    { caseId: "carbon_market", depth: "基础观察", observe: "企业减排成本、集中排序配置、总排放与履约成本。" },
  ] },
];

type MechanismSpec = {
  decision_rules: { file: string; version: string; description: string }[];
  macro_metrics: { id: string; label: string; unit: string; definition: string }[];
  evidence_limits: string[];
  economic_clock: { axis_label: string };
};

function MechanismIndexSpec() {
  const [caseId, setCaseId] = useState("");
  const [response, setResponse] = useState<{ caseId: string; spec?: MechanismSpec }>();
  useEffect(() => {
    if (!caseId) return;
    const controller = new AbortController();
    api<MechanismSpec>(`/emergence/cases/${caseId}/mechanisms`, undefined, controller.signal).then(spec => {
      if (!controller.signal.aborted) setResponse({ caseId, spec });
    }).catch(() => { if (!controller.signal.aborted) setResponse({ caseId }); });
    return () => controller.abort();
  }, [caseId]);
  const current = response?.caseId === caseId ? response : undefined;
  return <details className="studio-routes"><summary>查阅各课规则与指标口径</summary>
    <label>课程 <select value={caseId} onChange={e => setCaseId(e.target.value)}>
      <option value="">选择课程</option>
      {catalog.map(course => <option key={course.case_id} value={course.case_id}>{course.title}</option>)}
    </select></label>
    {current?.spec ? <>
      <p>经济时点 · {current.spec.economic_clock.axis_label}</p>
      <ul>{current.spec.decision_rules.map(rule => <li key={rule.description}>{rule.description}
        {" "}<span>（{rule.file} · {rule.version}）</span></li>)}</ul>
      <dl>{current.spec.macro_metrics.map(metric => <div key={metric.id}>
        <dt>{metric.label}{metric.unit && `（${metric.unit}）`}</dt><dd>{metric.definition}</dd>
      </div>)}</dl>
      {current.spec.evidence_limits.map(limit => <p key={limit}>{limit}</p>)}
    </> : caseId && (current ? <p role="alert">无法读取课内规则。</p> : <p role="status">正在读取课内规则…</p>)}
  </details>;
}

export function StudioPage() {
  return <main id="main" tabIndex={-1} className="container app-page app-inner studio-index">
    <header>
      <h1>从微观到宏观</h1>
      <p>选一门课，从主体条件和真实互动查到系统结果。</p>
    </header>
    <section className="studio-routes" aria-label="推荐的跨课顺序">
      <h2>沿机制继续探究</h2>
      <ul>
        <li><a href="/learn/schelling_segregation">居住隔离</a>后读<a href="/learn/information_cascade">信息级联</a>，比较空间相邻和按序观察。</li>
        <li><a href="/learn/beer_game">啤酒游戏</a>后读<a href="/learn/svb_run">银行挤兑</a>，追查实物积压和金融待付。</li>
        <li><a href="/learn/double_auction">双向拍卖</a>后读<a href="/learn/lemons_market">柠檬市场</a>，追查撮合与质量退出。</li>
      </ul>
      <a href="/practice">核对跨课推理</a>
    </section>
    <section aria-label="核心课涌现探究" className="studio-routes">
      <h2>进入涌现探究</h2>
      <ul>{Object.keys(coreMetrics).map(caseId => <li key={caseId}>
        <a href={`/learn/${caseId}?explore=1`}>{catalog.find(course => course.case_id === caseId)?.title}探究</a>
      </li>)}</ul>
    </section>
    <MechanismIndexSpec/>
    {groups.map(group => <section className="studio-index-group" key={group.title}>
      <h2>{group.title}</h2>
      <ul role="list">
        {group.entries.map(({ caseId, observe, depth }) => <li key={caseId}>
          <a href={`/learn/${caseId}`}>{catalog.find(course => course.case_id === caseId)?.title}</a>
          <span>{depth}</span>
          <p>{observe}</p>
        </li>)}
      </ul>
    </section>)}
  </main>;
}
