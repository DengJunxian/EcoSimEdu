import { useEffect, useState } from "react";
import lesson from "../../../../cases/double_auction/case.json";
import { eventHref, traceHref } from "../../contracts";
import { auctionView, checkpointLabel, compareAuction, type Alignment, type AuctionStudy,
  type AuctionView, type Branch } from "./auction-study";
import { useAuctionSelection } from "./selection-context";

export function AuctionCompare({ study, branch, choose, forecast, launch, capture, busy }: {
  study: AuctionStudy; branch: Branch; choose: (branch: Branch) => void;
  forecast: (branch: Branch, prediction: string) => void; launch: (branch: Branch) => void;
  capture: (comparison: AuctionStudy["comparison"]) => void; busy: boolean;
}) {
  const { view, comparisonRun, checkpoint, setCheckpoint, pinned } = useAuctionSelection();
  const baseline = study.runs.baseline;
  const [alignment, setAlignment] = useState<{ run: string; data: Alignment }>();
  const [comparisonFrames, setComparisonFrames] = useState<{ key: string; frames: AuctionView[] }>();
  const [error, setError] = useState("");
  const [settlement, setSettlement] = useState<{ key: string; view: AuctionView }>();
  const [loadingSettlement, setLoadingSettlement] = useState(false);
  useEffect(() => {
    if (!baseline || !comparisonRun) return;
    let active = true;
    setError("");
    compareAuction(baseline, comparisonRun).then(data => {
      if (active) setAlignment({ run: comparisonRun, data });
    }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [baseline, comparisonRun]);
  const data = alignment?.run === comparisonRun ? alignment?.data : undefined;
  const row = data?.rows[checkpoint];
  const leftTick = row?.baseline?.tick;
  const rightTick = row?.branch?.tick;
  const key = `${comparisonRun}/${leftTick}/${rightTick}`;
  useEffect(() => {
    if (!baseline || !comparisonRun || leftTick === undefined || rightTick === undefined) return;
    let active = true;
    Promise.all([auctionView(baseline, leftTick), auctionView(comparisonRun, rightTick)]).then(frames => {
      if (active) setComparisonFrames({ key, frames });
    }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [baseline, comparisonRun, key, leftTick, rightTick]);
  const label = lesson.scenarios.find(scenario => scenario.id === branch)!.label;
  const frames = comparisonFrames?.key === key ? comparisonFrames.frames : undefined;
  const latestTrade = frames?.[1].events.filter(event => event.event_type === "trade").at(-1);
  return <section className="auction-compare">
    <h2>制度对照</h2>
    <div className="toolbar">
      <label>选择条件 <select aria-label="选择条件" value={branch} onChange={event => choose(event.target.value as Branch)}>
        <option value="demand">需求上移</option><option value="fee">双边收费</option>
      </select></label>
      <label>预测收盘{branch === "demand" ? "成交量" : "总剩余"} <select aria-label={`预测收盘${branch === "demand" ? "成交量" : "总剩余"}`} value={study.forecasts[branch]}
        disabled={!!comparisonRun} onChange={event => forecast(branch, event.target.value)}>
        <option value="">先作预测</option><option value="increase">上升</option><option value="decrease">下降</option>
        <option value="same">不变</option><option value="unknown">不确定</option>
      </select></label>
      <button className="primary" disabled={busy || !study.forecasts[branch] || !!comparisonRun}
        onClick={() => launch(branch)}>{comparisonRun ? "对照已生成" : "生成对照"}</button>
    </div>
    <p>保持种子 {view.seed}、开局报价 {view.bid} 代币和到达生成机制。{branch === "demand" ?
      "每单位买方估值增加 12 代币。" : "每成交一件，买卖双方各付 6 代币。"}
      交易和到达路径可能随角色剩余库存与市场状态变化。</p>
    {error && <p role="alert" className="error">{error}</p>}
    {comparisonRun && !data && !error && <p role="status">正在读取同轮次观察点…</p>}
    {data && row && <>
      <label className="auction-slider">同步观察点 · {checkpointLabel(row)}
        <input type="range" min={0} max={data.rows.length - 1} value={checkpoint}
          aria-valuetext={checkpointLabel(row)} onChange={event => setCheckpoint(Number(event.target.value))}/>
      </label>
      <div className="table-scroll"><table>
        <caption>同一经济时钟下的运行</caption>
        <thead><tr><th scope="col">情景</th><th scope="col">成交（件）</th><th scope="col">最近成交价</th><th scope="col">总剩余（代币）</th></tr></thead>
        <tbody>{[
          { name: "基准市场", id: baseline!, point: row.baseline },
          { name: label, id: comparisonRun!, point: row.branch },
        ].map(arm => <tr key={arm.id}>
          <th scope="row">{arm.point ? <a href={traceHref(lesson.case_id, arm.id, arm.point.tick)}>{arm.name}</a> : arm.name}</th>
          <td>{arm.point?.metrics.volume ?? "—"}</td><td>{arm.point?.metrics.last_price ?? "—"}</td>
          <td>{arm.point?.metrics.surplus ?? "—"}</td>
        </tr>)}</tbody>
      </table></div>
      {row.phase === "ending" && row.baseline && row.branch && (() => {
        const metric = branch === "demand" ? "volume" : "surplus";
        const difference = row.branch.metrics[metric]! - row.baseline.metrics[metric]!;
        return <p>本次{branch === "demand" ? "成交量" : "总剩余"}{difference === 0 ? "不变" :
          `${difference > 0 ? "增加" : "减少"} ${Math.abs(difference)} ${branch === "demand" ? "件" : "代币"}`}。
          {study.forecasts[branch] === "unknown" ? "可据此修订原先保留的判断。" :
            study.forecasts[branch] === (difference > 0 ? "increase" : difference < 0 ? "decrease" : "same")
              ? "与原预测一致。" : "与原预测不同。看看 B01 和平台在同一观察点的差异。"}
        </p>;
      })()}
      {frames && <div className="auction-compare-accounts">
        {frames.map((frame, index) => <section key={frame.run_id}>
          <h3>{index ? label : "基准市场"}</h3>
          <p>B01 原报价 {frame.bid} · {
            frame.student_order === null ? "尚未报价" : frame.student_order.event_type === "order_rejected"
              ? "报价超过含费上限，模型拒单" : frame.student_trade !== null ? "已成交" :
                frame.student_close !== null ? "收盘未成交" : "已入簿"}</p>
          {pinned && frame.frame.accounts[pinned] && <p>{pinned} 现金 {frame.frame.accounts[pinned].cash} 代币 · 持有 {frame.frame.accounts[pinned].goods} 件</p>}
          {row.phase === "ending" && <p>平台收入 {(frame.intervention.fee * 2) * frame.frame.volume} 代币</p>}
        </section>)}
        <details><summary>核对运行身份与处理差异</summary>
          <p>共同生成根：{frames[0].root_hash}</p>
          <p>基准初态：{frames[0].initial_hash}</p><p>对照初态：{frames[1].initial_hash}</p>
        </details>
      </div>}
      {latestTrade && <section className="auction-branch-settlement">
        <button disabled={loadingSettlement} onClick={() => {
          setLoadingSettlement(true);
          auctionView(comparisonRun!, latestTrade.tick, "review", true)
            .then(result => setSettlement({ key, view: result }))
            .catch(problem => setError(problem.message))
            .finally(() => setLoadingSettlement(false));
        }}>核对该情景最近一笔成交</button>
        {settlement?.key === key && settlement.view.settlement && (() => {
          const trade = settlement.view.settlement;
          return <p>买方 {trade.buyer_surplus} ＋ 卖方 {trade.seller_surplus} ＋ 平台 {trade.platform_fee} ＝ {
            trade.value! - trade.cost!} 代币（价值 {trade.value} − 成本 {trade.cost}）。
            <a href={eventHref(lesson.case_id, settlement.view.run_id, settlement.view.tick)}>查看该笔原始成交</a></p>;
        })()}
      </section>}
      {row.baseline && row.branch && frames && <button onClick={() => capture({
        branch, run_id: comparisonRun!, tick: row.branch!.tick, baselineTick: row.baseline!.tick,
        checkpoint: checkpointLabel(row), resultHash: frames[1].result_hash, baselineHash: frames[0].result_hash,
        engineVersion: frames[1].engine_version, caseVersion: frames[1].case_version,
      })}>{study.comparison?.run_id === comparisonRun && study.comparison?.tick === row.branch.tick ?
        "此对照已记入笔记" : "引用此对照"}</button>}
    </>}
  </section>;
}
