import { useState } from "react";
import lesson from "../../../../cases/double_auction/case.json";
import { api, eventHref } from "../../contracts";
import { auctionView, type AuctionView } from "./auction-study";

const bid = 100;

export function AuctionStructureTask() {
  const [pair, setPair] = useState<[AuctionView, AuctionView]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  async function run() {
    setBusy(true); setError(""); setAnswer(""); setPair(undefined);
    try {
      async function start(scenario: "baseline" | "fee", parent?: string) {
        const key = crypto.randomUUID();
        await api("/runs", { request_id: key, case_id: lesson.case_id, scenario_id: scenario, provider_kind: "rule",
          seed: lesson.seed, bid, parent_run_id: parent ?? null });
        await api(`/runs/${key}/start?manifest_only=true`, {});
        return auctionView(key, "close");
      }
      const a = await start("baseline");
      const b = await start("fee", a.run_id);
      if (a.root_hash !== b.root_hash || a.seed !== b.seed || a.bid !== b.bid || a.intervention.fee === b.intervention.fee) {
        throw new Error("两次运行的共同条件无法核对。");
      }
      setPair([a, b]);
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }
  const samePrice = pair && pair[0].frame.last_price !== null && pair[0].frame.last_price === pair[1].frame.last_price;
  return <details className="education-task">
    <summary>相近成交价下的两条市场路径</summary>
    <p>保持种子 {lesson.seed} 和限价 {bid}，改变交易费。核对两组最后的成交价，再比较实际成交件数和交易者。</p>
    <button type="button" disabled={busy} onClick={() => void run()}>运行两条市场路径</button>
    {error && <p role="alert">{error}</p>}
    {pair && <>
      <div className="table-scroll"><table>
        <caption>同种子市场路径</caption>
        <thead><tr><th scope="col">制度</th><th scope="col">每方费</th><th scope="col">最后成交价</th><th scope="col">成交件数</th></tr></thead>
        <tbody>{pair.map((run, i) => <tr key={run.run_id}>
          <th scope="row">{i ? "收费" : "基准"}</th><td>{run.intervention.fee} 代币</td>
          <td>{run.frame.last_price == null ? "无成交" : `${run.frame.last_price} 代币／件`}</td><td>{run.frame.volume}</td>
        </tr>)}</tbody>
      </table></div>
      {pair.map((run, i) => <details key={run.run_id}><summary>{i ? "收费" : "基准"}的逐笔成交</summary>
        <ol>{run.events.filter(event => event.event_type === "trade").map(event => <li key={event.seq}>
          <a href={eventHref(lesson.case_id, run.run_id, event.seq)}>事件 {event.seq} · {event.buyer_id} 与 {event.seller_id}</a>
          {" · "}{event.price} 代币／件
        </li>)}</ol>
      </details>)}
      <fieldset className="education-answer">
        <legend>用这两条记录判断，两组实际成交结构相同吗？</legend>
        {["相同", "不同", "证据不足"].map(label => <label className="education-option" key={label}>
          <input type="radio" name="auction-structure" checked={answer === label} onChange={() => setAnswer(label)}/>{label}
        </label>)}
      </fieldset>
      {answer && <p role="status">{samePrice ? "两组最后成交价相同。" : "本次最后成交价有差异或缺失。"}
        {pair[0].frame.volume !== pair[1].frame.volume ? " 成交件数不同，可以继续对照两组买卖订单。" :
          " 还需逐笔核对成交顺序和参与者。"}
      </p>}
    </>}
  </details>;
}
