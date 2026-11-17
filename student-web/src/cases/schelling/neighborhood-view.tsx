import { useState } from "react";
import type { Grid } from "../../lesson-types";
import { coordinates, localCells, localCounts, satisfied } from "./neighborhood";

const example: Grid = {
  size: 3, marked: [4],
  cells: ["A002", "B001", null, "B002", "A001", "A003", "B003", null, "B004"],
};

export function Neighborhood({ grid, cell, actor, threshold, excluded, label }: {
  grid: Grid; cell: number; actor: string; threshold: number | null; excluded?: number; label: string;
}) {
  const cells = localCells(grid, cell, excluded);
  const [same, total] = localCounts(cells, actor);
  return <section className="schelling-local">
    <h3>{label}</h3>
    <p>{actor} · {coordinates(cell, grid.size)}</p>
    <ol className="schelling-neighborhood" aria-label={`${label}的九格邻域`}>
      {cells.map((item, index) => <li key={index} className={item.center ? "local-center" : ""}
        data-group={item.center ? actor[0] : item.actor?.[0]} data-outside={item.index === null || undefined}
        aria-label={item.index === null ? "棋盘外" : item.center ? `中心 ${actor}` :
          `${coordinates(item.index, grid.size)}，${item.actor ?? "空位"}`}>
        {item.index === null ? "棋盘外" : item.center ? `${actor} 本人` : item.actor ?? "空位"}
      </li>)}
    </ol>
    {total === 0 ? <p><strong>周围没有已占邻居</strong> · 按本课规则视作满意。</p> :
      <p><strong>同组邻居 {same}/{total}</strong>{threshold === null ? " · 阈值缺失" :
        ` · ${satisfied([same, total], threshold) ? "达到" : "未达到"} ${threshold}% 阈值`}</p>}
  </section>;
}

export function Practice({ prediction = false }: { prediction?: boolean }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const [threshold, setThreshold] = useState(30);
  const [answer, setAnswer] = useState("");
  const [same, total] = localCounts(localCells(example, 4), "A001");
  const actual = satisfied([same, total], threshold) ? "stay" : "unmet";
  const eligible = example.cells.flatMap((actor, index) => index !== 4 && actor ? [index] : []);
  const correct = chosen.length === eligible.length && eligible.every(index => chosen.includes(index));

  return <section className="schelling-practice">
    <h2>规则练习 · 九格社区</h2>
    <p>{prediction ? "看同一个邻域，判断居民是否达到所选阈值。" : "点选所有计入分母的格子，再核对。选中的格子可以再次点击取消。"}</p>
    <div className="schelling-neighborhood" role="group" aria-label="九格练习">
      {example.cells.map((resident, index) => prediction ?
        <span className={index === 4 ? "local-center" : ""} key={index} data-group={resident?.[0]}>{index === 4 ? "A 本人" : resident?.[0] ?? "空位"}</span> :
        <button key={index} type="button" aria-pressed={chosen.includes(index)} data-group={resident?.[0]}
          aria-label={`${coordinates(index, 3)}，${index === 4 ? "A 本人" : resident?.[0] ?? "空位"}`}
          className={index === 4 ? "local-center" : ""} onClick={() => {
            setChosen(chosen.includes(index) ? chosen.filter(value => value !== index) : [...chosen, index]);
            setChecked(false);
          }}>
          {index === 4 ? "A 本人" : resident?.[0] ?? "空位"}
        </button>)}
    </div>
    {prediction ? <>
      <label>最低同组比例 <select aria-label="最低同组比例" value={threshold} onChange={event => {
        setThreshold(Number(event.target.value)); setAnswer("");
      }}><option value={30}>30%</option><option value={50}>50%</option></select></label>
      <fieldset>
        <legend>中央 A 达到这个阈值吗？</legend>
        <div className="options">{[["stay", "达到"], ["unmet", "未达到"], ["unknown", "不确定"]].map(([value, text]) =>
          <label key={value}><input type="radio" name="practice-threshold" value={value}
            checked={answer === value} onChange={() => setAnswer(value)}/>{text}</label>)}</div>
      </fieldset>
      {answer && <p role="status">
        {answer === actual ? "判断正确。" : answer === "unknown" ? "可以先按比例算一遍。" : "重新比较同组比例和最低要求。"}
        {" "}同组 {same}/{total}，约 33.3%，{actual === "stay" ? "达到" : "未达到"} {threshold}%。
      </p>}
    </> : <>
      <button type="button" onClick={() => setChecked(true)}>核对邻居计数</button>
      {checked && <p role="status">{correct ? "你选中了全部已占邻居。" :
        chosen.includes(4) ? "中央是被观察居民，分母只数周边已住人的格子。" :
          chosen.some(index => example.cells[index] === null) ? "空位可以用于迁居，分母只数已经住人的格子。" :
            "再查看周边尚未选中的已占格子。"} 同组 {same}/{total}。</p>}
    </>}
  </section>;
}
