import { useState } from "react";
import { SupplyDemand } from "../../charts";
import { useAuctionSelection } from "./selection-context";

export function AuctionExplain() {
  const { view } = useAuctionSelection();
  const [pair, setPair] = useState(0);
  const [opportunity, setOpportunity] = useState<{ index: number; correct: boolean }>();
  const info = view.private_information;
  if (!info) return <p>切换到复盘或推进至收盘即可查看完整供需与剩余。</p>;
  const { demand, supply, metrics } = info;
  return <section className="auction-explain">
    <h2>价值、成本与配置</h2>
    {view.settlement?.value !== undefined ? <SettlementExercise key={view.tick}/> :
      <p>在成交图中选一笔成交，就能用该笔结算作练习。</p>}
    <p>收盘实际剩余 {metrics.surplus} 代币 · 可实现上界 {metrics.ceiling} 代币 · 效率 {
      metrics.efficiency === null ? "不适用" : `${(metrics.efficiency * 100).toFixed(1)}%`}</p>
    <p>竞争价格参考区间 {metrics.price_band ? `${metrics.price_band.join("–")} 代币／件` : "不适用"}。</p>
    <SupplyDemand run={{ result: info }}/>
    <form onSubmit={event => {
      event.preventDefault();
      const answer = Number(new FormData(event.currentTarget).get("opportunity"));
      setOpportunity({ index: pair, correct: answer === Math.max(0, demand[pair] - supply[pair]) });
    }}>
      <h3>检查一个边际配对</h3>
      <div className="toolbar">
        <label>配对 <select value={pair} onChange={event => setPair(Number(event.target.value))}>
          {demand.slice(0, supply.length).map((_, index) => <option value={index} key={index}>第 {index + 1} 件</option>)}
        </select></label>
        <label>可增加的剩余 <input name="opportunity" type="number" required key={pair}/></label>
        <button>核对机会收益</button>
      </div>
      <p>价值 {demand[pair]}，成本 {supply[pair]}。若价差为负，选择放弃这次配对。</p>
      {opportunity?.index === pair && <p role="status">{opportunity.correct ?
        "计算正确。这个数进入排序配对的上界；实际运行需另外查这对价值与成本是否成交。" :
        "重新比较边际价值与成本。只有正的价值减成本进入上界。"}</p>}
    </form>
  </section>;
}

function SettlementExercise() {
  const { view } = useAuctionSelection();
  const settlement = view.settlement!;
  const [answer, setAnswer] = useState<boolean>();
  const price = view.frame.last_price;
  const fee = view.intervention.fee;
  return <form onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setAnswer(Number(values.get("buyer")) === settlement.buyer_surplus &&
      Number(values.get("seller")) === settlement.seller_surplus &&
      Number(values.get("platform")) === settlement.platform_fee);
  }}>
    <h3>结算练习 · 事件 {view.tick}</h3>
    <p>买方价值 {settlement.value}，卖方成本 {settlement.cost}，成交价 {price}，每方费用 {fee}，单位为代币。</p>
    <div className="toolbar">
      <label>买方剩余 <input name="buyer" type="number" required/></label>
      <label>卖方剩余 <input name="seller" type="number" required/></label>
      <label>平台费用 <input name="platform" type="number" required/></label>
      <button>核对结算</button>
    </div>
    {answer !== undefined && <p role="status">{answer ? "对账一致。" : "复算时把每方费用分别扣除，再把双边费用计入平台。"}
      {" "}{settlement.buyer_surplus} + {settlement.seller_surplus} + {settlement.platform_fee} = {
        settlement.value! - settlement.cost!} 代币（价值减成本）。</p>}
  </form>;
}
