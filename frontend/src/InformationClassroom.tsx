import { useState } from "react";
import { QualityBreakdown, SchoolSeats, SignalChain } from "../../content/information-ui";
import { EvidenceCard } from "../../content/student-ui";
import { Studio } from "./Studio";
import { actionsAt, informationFrame, marketAt, schoolsAt, sourceQuestion,
  type CascadeRun, type InformationRun, type MarketRun, type SchoolRun, type SourceQuestion } from "./information-evidence.ts";
import { displayNumber, type Command, type Session } from "./lesson.ts";
import type { MigratedLesson } from "./models/course-lesson.ts";
import { readTeaching, saveTeaching } from "./teaching-records.ts";
import "./information.css";

type BoardProps = { run: InformationRun; session: Session; select: (id: string) => void };
type DetailsProps = { run: InformationRun; session: Session; seek: (tick: number, metric: string, actorId?: string) => void };

function FactRows({ rows }: { rows: readonly [string, string | number][] }) {
  return <dl className="fact-list info-facts">{rows.map(([term, value]) =>
    <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>;
}

function ActorButtons({ ids, selected, select, state }: {
  ids: readonly string[]; selected?: string; select: (id: string) => void; state?: string;
}) {
  return <div className="info-actors">{ids.map(id => <button type="button" key={id} aria-pressed={id === selected}
    aria-label={state ? `${id} · ${state}` : id} onClick={() => select(id)}>{id}</button>)}</div>;
}

function SchoolBoard({ run, session, select }: BoardProps & { run: SchoolRun }) {
  const { schools, current, latestApplications, refusals } = schoolsAt(run, session.cursor);
  const id = session.selected;
  const [schoolId, setSchoolId] = useState("A");
  const school = schools.find(entry => entry.id === schoolId)!;
  const spotlight = current.event_type === "round_proposals" ? latestApplications : undefined;
  const rejected = refusals.filter(row => row.tick === current.seq && row.school === school.id);
  const applicants = Object.entries(spotlight?.data.proposals ?? {}).filter(([, target]) => target === school.id).map(([student]) => student);
  return <>
    <SchoolSeats active={school.id} select={setSchoolId} schools={schools.map(entry => ({ ...entry, used: entry.held.length }))}/>
    <h3>{school.id} 校的{school.status}席位</h3>
    <ol className="info-seat-slots" aria-label={`${school.id} 校的 ${school.capacity} 个席位`}>
      {Array.from({ length: school.capacity }, (_, index) => {
        const student = school.held[index];
        return <li key={index}>{student ? <button type="button" aria-pressed={student === id}
          onClick={() => select(student)}>{student}</button> : "空位"}</li>;
      })}
    </ol>
    <details><summary>{school.id} 校优先顺序</summary><p>{school.ranks.join(" → ")}</p></details>
    {spotlight && <p>{school.id} 校本轮收到 {applicants.length} 份申请{applicants.length ? ` · ${applicants.join("、")}` : ""}。</p>}
    {!!rejected.length && <p>{school.id} 校本轮拒绝 {rejected.map(row => row.student).join("、")}。</p>}
    <div role="group" aria-label="选择任一位个体查看决策">
      <h3>申请人</h3><ActorButtons ids={Object.keys(run.matchingInput.submitted)} selected={id} select={select}/>
    </div>
  </>;
}

function SchoolDetails({ run, session, seek }: DetailsProps & { run: SchoolRun }) {
  const id = session.selected!;
  const { schools, applications, refusals, final } = schoolsAt(run, session.cursor);
  const school = schools.find(entry => entry.held.includes(id));
  const ownSchool = schools.find(entry => entry.id === id);
  const ownApplications = applications.filter(row => row.data.proposals[id]);
  const ownRefusals = refusals.filter(row => row.student === id);
  return <EvidenceCard label="匹配主体详情" className="information-details">
    <h3>{id}{ownSchool ? " 校" : " 的志愿与记录"}</h3>
    {ownSchool ? <FactRows rows={[["容量", ownSchool.capacity], ["优先顺序", ownSchool.ranks.join(" → ")],
      [ownSchool.status, ownSchool.held.join("、") || "当前无占位"]]}/> : <>
      <FactRows rows={[["真实偏好", id === "S01" || final ? run.matchingInput.truePreferences[id].join(" → ") : "复盘时展示"],
        ["申报顺序", id === "S01" || final ? run.matchingInput.submitted[id].join(" → ") : "复盘时展示"],
        [school?.status ?? "当前席位", school ? `${school.id} 校` : "尚未匹配"]]}/>
      {session.stage === 3 && <ul className="info-trace">
        {ownApplications.map(row => <li key={row.seq}><button className="text-button" onClick={() => seek(row.seq, "applications", id)}>
          回查第 {row.period} 轮申请 {row.data.proposals[id]} 校 · 事件 {row.seq}</button></li>)}
        {ownRefusals.map(row => <li key={row.tick}><button className="text-button" onClick={() => seek(row.tick, "rejections", id)}>
          回查 {row.school} 校拒绝 · 事件 {row.tick}</button></li>)}
      </ul>}
    </>}
    {final && <p>最终按申报志愿检查有 {final.submitted_blocking.length} 对阻挡，按真实偏好有 {final.true_blocking.length} 对。</p>}
  </EvidenceCard>;
}

function MarketBoard({ run, session, select }: BoardProps & { run: MarketRun }) {
  const { sellers, distribution } = marketAt(run, session.cursor);
  const metrics = run.frames[session.cursor].metrics;
  const lanes = [...new Set(sellers.map(seller => seller.state))];
  return <>
    <h3>开盘挂牌分布</h3>
    <QualityBreakdown distribution={distribution}/>
    <FactRows rows={[["混合池暂定价（代币）", displayNumber(metrics.quoted_pool_price)],
      ["此时愿售（件）", metrics.willing_supply!], ["实际交割（件）", metrics.traded!]]}/>
    <div role="group" aria-label="选择任一位个体查看决策">
      <ActorButtons ids={["S01", "B01"]} selected={session.selected} select={select}/>
      {lanes.map(state => <div className="info-market-lane" key={state}><h3>{state}</h3>
        <ActorButtons ids={sellers.filter(seller => seller.state === state && seller.id !== "S01").map(seller => seller.id)}
          selected={session.selected} select={select} state={state}/></div>)}
    </div>
  </>;
}

function MarketDetails({ run, session, seek }: DetailsProps & { run: MarketRun }) {
  const id = session.selected;
  const { offers, sellers, settlement } = marketAt(run, session.cursor);
  const seller = sellers.find(entry => entry.id === id);
  const latest = offers.at(-1);
  const trade = seller?.transaction;
  return <EvidenceCard label="买卖方信息" className="information-details">
    {seller ? <>
      <h3>{seller.id} · {seller.state}</h3>
      <FactRows rows={[["商品质量／卖家保留价", seller.quality ?? "未公开"],
        ["公开混合报价（代币）", displayNumber(latest?.data.quote)],
        ...(trade ? [["实付价（代币）", displayNumber(trade.price)],
          ["净卖方剩余（代币）", displayNumber(trade.seller_gain)], ["核验耗用（代币）", trade.certification_cost]] as [string, string | number][] : [])]}/>
      {seller.exit && <p>该卖家在暂定价 {displayNumber(seller.exit.data.quote)} 代币时退出。下一次报价将读取退出后的愿售集合。</p>}
      {seller.exit && session.stage === 3 && <button className="text-button"
        onClick={() => seek(seller.exit!.seq, "willing_supply", seller.id)}>回查退出 · 事件 {seller.exit.seq}</button>}
    </> : <>
      <h3>B01 · 买方</h3>
      {latest?.data.quote == null ? <p>当前没有混合池报价。</p> : <p>情境规定暂定价为可报价池平均质量的 1.2 倍。本次暂定价 {displayNumber(latest.data.quote)} 代币。</p>}
      <p>{settlement ? `本场实际交割 ${settlement.data.transactions.length} 件。` : "暂定报价进入下一轮筛选，交割还没有发生。"}</p>
      {latest && session.stage === 3 && <button className="text-button" onClick={() => seek(latest.seq, "quoted_pool_price", "B01")}>
        回查最近报价 · 事件 {latest.seq}</button>}
    </>}
  </EvidenceCard>;
}

function CascadeBoard({ run, session, select }: BoardProps & { run: CascadeRun }) {
  const { decisions, published, reveal } = actionsAt(run, session.cursor);
  const selected = decisions.find(row => row.actors[0] === session.selected);
  return <>
    <FactRows rows={[["前序行动", published ? "公开" : "隐藏"],
      ["A 箱公共后验", `${displayNumber(run.frames[session.cursor].metrics.public_a_pct)}%`]]}/>
    <div role="group" aria-label="选择任一位个体查看决策">
      <SignalChain actions={run.frames[0].actors.map(actor => {
        const row = decisions.find(item => item.actors[0] === actor.id);
        return { id: actor.id, actor: actor.id, choice: row && (published || reveal || actor.id === "D03") ? row.data.choice : undefined,
          status: row ? "选择未公开" : "待行动",
          signal: reveal || actor.id === "D03" ? row?.data.signal : undefined, active: actor.id === session.selected,
          observed: !!(published && row && selected && row.seq < selected.seq) };
      })} choose={action => select(action.actor)}/>
    </div>
    {reveal && <p>终场揭晓 · 真箱为 {reveal.state}，{reveal.correct_count} 人猜对。</p>}
  </>;
}

function CascadeDetails({ run, session, seek }: DetailsProps & { run: CascadeRun }) {
  const id = session.selected;
  const { decisions, published, reveal } = actionsAt(run, session.cursor);
  const selected = decisions.find(row => row.actors[0] === id);
  const prior = selected && published ? decisions.filter(row => row.seq < selected.seq) : [];
  const own = id === "D03";
  const data = selected?.data;
  return <EvidenceCard label="行动与公共信念" className="information-details">
    <h3>{id} 能看到什么</h3>
    {!data ? <p>该参与者尚未行动和接收抽样。</p> : <>
      <FactRows rows={[
        ["本次私信号", own || reveal ? data.signal : "终场揭晓"],
        ["行动前 A 箱公共后验", `${displayNumber(data.public_a_before_pct)}%`],
        ["行动后 A 箱公共后验", `${displayNumber(data.public_a_after_pct)}%`],
      ]}/>
      {(published || own || reveal) && <p>抽到 A 会选 {data.choice_if_private_a}，抽到 B 会选 {data.choice_if_private_b}。本次选择 {data.choice}。</p>}
      {published && <p>{data.information_added ? "这一行动能区分两种私信号，进入公共信念的更新。" :
        "两种私信号给出相同选择，公开行动没有新增抽样信息。"}
        {data.cascade && "本次按模型规则计为级联。"} </p>}
      {!!prior.length && <details><summary>可见的前序行动 · {prior.length} 条</summary><ul className="info-trace">
        {prior.map(row => <li key={row.seq}>{session.stage === 3 ?
          <button className="text-button" onClick={() => seek(row.seq, "public_a_pct", row.actors[0])}>
            回查 {row.actors[0]} 选择 {row.data.choice} · 事件 {row.seq}</button> :
          `${row.actors[0]} 选择 ${row.data.choice}`}</li>)}
      </ul></details>}
    </>}
  </EvidenceCard>;
}

function EvidenceQuestion({ caseId, reference, question, locate }: {
  caseId: string; reference: string; question: SourceQuestion; locate: () => void;
}) {
  const [checked, setChecked] = useState(() => {
    const saved = readTeaching(localStorage, caseId, reference, "mechanism_evidence");
    return saved?.eventTick === question.tick && question.options.some(row => row.tick === saved.choiceTick)
      ? saved.choiceTick : undefined;
  });
  const [choice, setChoice] = useState<number | undefined>(checked);
  const [error, setError] = useState(false);
  return <EvidenceCard label="从宏观回到个体的证据题" className="information-question">
    <h2>用原事件解释转折</h2>
    <p>{question.summary}</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (choice === undefined) return;
      setChecked(choice);
      try {
        saveTeaching(localStorage, { caseId, reference, savedAt: new Date().toISOString(),
          kind: "mechanism_evidence", eventTick: question.tick, choiceTick: choice });
        setError(false);
      } catch { setError(true); }
    }}>
      <fieldset><legend>{question.prompt}</legend>
        {question.options.map(option => <label key={option.tick} className="choice">
          <input type="radio" name="information-evidence" checked={choice === option.tick} onChange={() => setChoice(option.tick)}/>
          {option.label}
        </label>)}
      </fieldset>
      <button className="primary" type="submit" disabled={choice === undefined}>核对证据</button>
    </form>
    {checked !== undefined && <p role="status">{checked === question.tick ? question.reason : question.hint}</p>}
    {checked === question.tick && <button type="button" className="text-button" onClick={locate}>打开对应个体与原事件</button>}
    {error && <p role="alert">本次核对暂未保存，仍可查看证据。</p>}
  </EvidenceCard>;
}

export function InformationClassroom({ lesson }: { lesson: MigratedLesson }) {
  return <Studio lesson={lesson} observationFrame={informationFrame}
    world={(session, select) => {
      const run = session.run as InformationRun;
      const props = { session, select };
      return <section className="information-board" aria-label="微观个体画布">
        <div className="canvas-heading"><h2>{lesson.populationTitle}</h2><span>事件 {session.cursor}</span></div>
        {"matchingInput" in run ? <SchoolBoard run={run} {...props}/> : "marketInput" in run ? <MarketBoard run={run} {...props}/> :
          <CascadeBoard run={run} {...props}/>}
      </section>;
    }}
    actorDetail={(session, _select, seek) => {
      const run = session.run as InformationRun;
      return "matchingInput" in run ? <SchoolDetails run={run} session={session} seek={seek}/> : "marketInput" in run ?
        <MarketDetails run={run} session={session} seek={seek}/> : <CascadeDetails run={run} session={session} seek={seek}/>;
    }}
    review={(session, send: (command: Command) => void, _next, openActor) => {
      if (session.stage !== 3 || !session.run) return null;
      const question = sourceQuestion(session.run as InformationRun, session.revealed);
      if (!question) return null;
      const reference = JSON.stringify([session.run.id, session.choices, question.tick]);
      return <EvidenceQuestion key={reference} caseId={lesson.id} reference={reference} question={question} locate={() => {
        send({ type: "locate", tick: question.tick, metricId: question.metric, actorId: question.actor });
        openActor?.(question.actor);
      }}/>;
    }}/>
}
