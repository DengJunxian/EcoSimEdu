import type { MarketEvent, Run } from "./contracts";

const W = 720, H = 270, L = 54, R = 695, T = 25, B = 221;

export function SupplyDemand({ run }: { run: { result: Pick<Run["result"], "demand" | "supply"> } }) {
  const { demand, supply } = run.result;
  const low = Math.floor(Math.min(...demand, ...supply) / 10) * 10;
  const high = Math.ceil(Math.max(...demand, ...supply) / 10) * 10;
  const count = Math.max(demand.length, supply.length);
  const x = (i: number) => L + i * (R - L) / count;
  const y = (price: number) => B - (price - low) * (B - T) / (high - low);
  const path = (series: number[]) => series.map((price, i) =>
    `${i ? "V" : `M ${L}`} ${y(price)} H ${x(i + 1)}`).join(" ");
  return <figure>
    <figcaption>阶梯供需 <span>代币 / 件</span></figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="按数量排序的买方边际价值和卖方边际成本">
      {Array.from({ length: 5 }, (_, i) => low + (high - low) * i / 4).map(value =>
        <g key={value}><line className="gridline" x1={L} x2={R} y1={y(value)} y2={y(value)}/>
          <text x={L - 10} y={y(value) + 5} textAnchor="end">{value}</text></g>)}
      <path d={path(demand)} className="demand"/>
      <path d={path(supply)} className="supply"/>
      {[0, 5, 10, 15, 20].filter(v => v <= count).map(value =>
        <text key={value} x={x(value)} y={B + 24} textAnchor="middle">{value}</text>)}
      <text x={R} y={H - 4} textAnchor="end">数量（件）</text>
    </svg>
    <div className="legend"><span>买方边际价值</span><span>卖方边际成本</span></div>
    <details><summary>查看供需数据</summary>
      <div className="table-scroll"><table><thead><tr><th>第几件</th><th>买方价值</th><th>卖方成本</th></tr></thead>
        <tbody>{Array.from({ length: count }, (_, i) => <tr key={i}><td>{i + 1}</td><td>{demand[i] ?? "—"}</td><td>{supply[i] ?? "—"}</td></tr>)}</tbody></table></div>
    </details>
  </figure>;
}

export function PriceChart({ events, tick, choose, revealUntil, closed }: {
  events: MarketEvent[]; tick: number; choose: (tick: number) => void;
  revealUntil?: number; closed?: boolean;
}) {
  const points = events.filter(e => e.event_type === "trade" && e.tick <= (revealUntil ?? tick));
  const end = revealUntil ?? events.at(-1)?.tick ?? 1;
  if (!points.length) return <p className="quiet-content">
    {(closed ?? tick === end) ? "整场无成交。成交价未定义。" : "当前时点尚无成交。"}
  </p>;
  const prices = points.map(e => e.price!);
  const low = Math.min(...prices) - 2;
  const high = Math.max(...prices) + 2;
  const x = (at: number) => L + at * (R - L) / Math.max(1, end);
  const y = (price: number) => B - (price - low) * (B - T) / (high - low);
  return <figure>
    <figcaption>成交价格 <span>代币 / 件</span></figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="已播放成交价格">
      {[low, Math.round((low + high) / 2), high].map(value =>
        <g key={value}><line className="gridline" x1={L} x2={R} y1={y(value)} y2={y(value)}/>
          <text x={L - 10} y={y(value) + 5} textAnchor="end">{value}</text></g>)}
      <polyline className="demand" points={points.map(e => `${x(e.tick)},${y(e.price!)}`).join(" ")}/>
      {points.map(e => <circle key={e.seq} cx={x(e.tick)} cy={y(e.price!)} r={e.tick === tick ? 9 : 6}
        className={e.tick === tick ? "selected-point" : "chart-point"} onClick={() => choose(e.tick)}
        tabIndex={0} role="button" aria-label={`成交事件 ${e.seq}，${e.price} 代币`}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(e.tick); } }}/>)}
      {[...new Set([0, Math.round(end / 2), end])].map(at =>
        <text key={at} x={x(at)} y={B + 24} textAnchor="middle">{at}</text>)}
      <text x={R} y={H - 4} textAnchor="end">事件序号</text>
    </svg>
    <details><summary>查看成交价格表</summary>
      <table><caption>已播放成交价格（代币 / 件）</caption>
        <thead><tr><th scope="col">成交事件</th><th scope="col">价格</th></tr></thead>
        <tbody>{points.map(e => <tr key={e.seq}><th scope="row"><button className="text-button"
          aria-current={e.tick === tick ? "step" : undefined} onClick={() => choose(e.tick)}>事件 {e.seq}</button></th>
          <td>{e.price}</td></tr>)}</tbody>
      </table>
    </details>
  </figure>;
}
