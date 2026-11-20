import { useState } from "react";
import { browserEvents } from "./run-evidence.ts";
import { chartMetric, type Lesson, type Session } from "./lesson.ts";
import { readTeaching, saveTeaching } from "./teaching-records.ts";

const prompts: Record<string, string> = {
  school_matching: "把本轮暂留与最终录取分开，检查被拒的学生是否还有下一选择。",
  lemons_market: "把公开报价和卖家的最低可接受价放在一起比较。",
  information_cascade: "分别假定这一人收到两种私信号，看看他会不会改选。",
  schelling_segregation: "以迁出格和迁入格为中心，各数一遍相邻且有人居住的格子。",
  public_goods: "区分多投的一枚代币和自己从公共池取回的份额，其他人保持原贡献。",
  commons_governance: "在期初库存、实际取用、取用后库存和再生后库存中找出发生次序。",
  carbon_market: "逐一记下转让双方的增减，再把市场账户加总。",
  beer_game: "按订单、在途、实际到货三个时点找库存变动。",
  gamestop: "检查消息到达时是否也有实际成交。",
  flash_crash: "观察被撤订单在买方还是卖方，将它的剩余量与买方深度比较。",
};

function readForecast(lesson: Lesson, session: Session) {
  const run = session.run;
  const pack = lesson.casePackage;
  if (!run || !pack || session.stage !== 3 || session.cursor < 1) return;
  const prediction = session.choices[1];
  const choice = lesson.decisions[1];
  if (!choice || !("options" in choice)) return;
  const original = choice.options.find(option => option.id === prediction)?.label;
  if (!original) return;
  if (pack.caseId === "double_auction") {
    const events = browserEvents(run, pack, session.cursor);
    const trade = events.find(record => record.kind === "trade" && record.actorIds.includes("B01"));
    const close = events.find(record => record.kind === "market_close");
    const evidence = trade ?? close;
    if (!evidence) return;
    return { original, wrong: prediction !== "unknown" && prediction !== (trade ? "yes" : "no"),
      hint: "找出 B01 的委托，然后核对实际成交双方。提交限价表示愿意交易，还要等可撮合的对手方。",
      compare: "先比当时的买卖限价。交叉后，用成交事件和在簿订单核对结算价。",
      result: trade ? "已观察到 B01 成交。" : "检查到收盘，B01 的订单未成交。", evidence };
  }
  if (pack.caseId === "svb_run") {
    const evidence = browserEvents(run, pack, session.cursor).find(record => record.kind === "request" && record.actorIds.includes("D01"));
    if (!evidence) return;
    return { original, wrong: prediction === "at-request", result: "D01 的原申请增加待付额。只有实际兑付才减少银行现金。",
      hint: "把申请、等待和到账分开。先找 D01 的申请，再核对哪一个事件有现金变化。",
      compare: "对照事件前后的待付和现金。分别找实际到账的记录。", evidence };
  }
  const hint = prompts[pack.caseId];
  const correct = choice.options.find(option => option.id === "prediction-0");
  if (!hint || !correct) return;
  return { original, wrong: prediction !== correct.id, hint,
    compare: "保持题目给出的其他条件，从两次可见状态中分辨哪一项会直接变化。",
    result: `该判断使用题目给定的条件。规则支持「${correct.label}」。` };
}

export function ForecastReview({ lesson, session, locate }: {
  lesson: Lesson; session: Session;
  locate: (tick: number, metric: string, actorId?: string, eventId?: string) => void;
}) {
  const result = readForecast(lesson, session);
  if (!result) return null;
  const reference = JSON.stringify([session.run!.id, session.choices]);
  return <ForecastCard key={reference} lesson={lesson} reference={reference} result={result} locate={locate}/>;
}

function ForecastCard({ lesson, reference, result, locate }: {
  lesson: Lesson; reference: string; result: NonNullable<ReturnType<typeof readForecast>>;
  locate: (tick: number, metric: string, actorId?: string, eventId?: string) => void;
}) {
  const caseId = lesson.casePackage!.caseId;
  const [level, setLevel] = useState(() => {
    try { return readTeaching(localStorage, caseId, reference, "forecast_exposure")?.level ?? 0; }
    catch { return 0; }
  });
  const [error, setError] = useState(false);
  function show(value: 1 | 2 | 3) {
    try {
      saveTeaching(localStorage, { kind: "forecast_exposure", caseId, reference, level: value, original: result.original,
        savedAt: new Date().toISOString() });
      setLevel(value);
      setError(false);
    } catch { setError(true); }
  }
  const evidence = result.evidence;
  return <section className="edu-panel teaching-card" aria-label="原预测反馈">
    <h2>{result.wrong ? "你的预测需要核对" : "核对你的原预测"}</h2>
    <p>原预测「{result.original}」。{result.wrong ? "可以继续实验，也可以先沿一条线索查证。" : result.result}</p>
    {result.wrong && <div className="decision-actions">
      <button type="button" onClick={() => show(1)}>看预测提示</button>
      {!!level && <button type="button" onClick={() => show(2)}>看比较方法</button>}
      {level >= 2 && <button type="button" onClick={() => show(3)}>核对预测依据</button>}
    </div>}
    {result.wrong && !!level && <p role="status">{level === 1 ? result.hint : level === 2 ? result.compare : result.result}</p>}
    {error && <p role="alert">提示曝光无法保存，请重试。实验仍可继续。</p>}
    {evidence?.frameTick != null && <button type="button" className="text-button" onClick={() =>
      locate(evidence.frameTick!, chartMetric(lesson).id, evidence.actorIds[0], evidence.eventId)}>
      定位预测相关的实际事件 {evidence.eventId}
    </button>}
  </section>;
}
