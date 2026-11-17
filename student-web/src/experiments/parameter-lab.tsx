import { useEffect, useState } from "react";
import { caseHref, catalog } from "../catalog";
import { api, downloadJson, eventHref } from "../contracts";
import type { Scalar } from "../lesson-types";
import { showValue } from "../lesson-view";
import { alignmentLabel, getFieldView, type Alignment } from "../learning/flagship-study";
import { isFieldFlagship, type FlagshipView } from "../learning/flagship-types";
import { auctionView, type AuctionView } from "../cases/auction/auction-study";
import "../learning/flagship.css";
import "./parameter-lab.css";

type Parameter = {
  id: string; label: string; unit: string; values: Scalar[]; value_labels: Record<string, string>;
  default: Scalar; constraint: string; mechanism: string; provider_kinds: string[];
};
type Specification = {
  default_seed: number;
  parameters: Parameter[];
  presets: { id: string; label: string; values: Record<string, Scalar> }[];
  student_actions: { default: string; label: string; options: { id: string; label: string }[] } | null;
  auction_limits: { maximum: number; default_bid: number } | null;
  weekly_order_plan: { min: number; max: number; weeks: number } | null;
  round_contribution_plan: { min: number; max: number; rounds: number } | null;
};
type Metrics = Record<string, number | null>;
type Comparison = Omit<Alignment, "rows"> & {
  metrics: { id: string; label: string; unit: string }[];
  rows: (Alignment["rows"][number] & {
    baseline: { tick: number; metrics: Metrics } | null;
    branch: { tick: number; metrics: Metrics } | null;
  })[];
  conditions: {
    common_root: string; seed: number; baseline_initial_hash: string; branch_initial_hash: string;
    treatments: Record<string, { baseline: Scalar; branch: Scalar }>;
  };
};
type PairRun = { baseline: string; branch: string; data: Comparison };
type Result = PairRun & { sample: PairRun[] };
type SynchronizedFrame = FlagshipView | AuctionView;

function parameterValue(spec: Parameter, value: Scalar) {
  if (value === null) return "关闭";
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  return spec.value_labels[String(value)] ?? String(value);
}

function thumbnail(run: FlagshipView | undefined, label: string) {
  const grid = run?.frame.grid;
  if (!grid) return null;
  return <figure className="parameter-grid">
    <figcaption>{label} · 开局地图</figcaption>
    <svg viewBox={`0 0 ${grid.size} ${grid.size}`} role="img" aria-label={`${label}，170 名 A 组、170 名 B 组、60 个空位`}>
      {grid.cells.map((actor, index) => actor && <rect key={index} x={index % grid.size + .04} y={Math.floor(index / grid.size) + .04}
        width=".92" height=".92" rx={actor[0] === "A" ? 0 : .45} className={actor[0] === "A" ? "parameter-group-a" : "parameter-group-b"}/>)}
    </svg>
  </figure>;
}

export function ParameterLab({ initialCase }: { initialCase?: string | null }) {
  const [caseId, setCaseId] = useState(initialCase && catalog.some(course => course.case_id === initialCase) ?
    initialCase : catalog[0].case_id);
  const [spec, setSpec] = useState<Specification>();
  const [patch, setPatch] = useState<Record<string, Scalar>>({});
  const [baselinePatch, setBaselinePatch] = useState<Record<string, Scalar>>({});
  const [action, setAction] = useState("");
  const [seed, setSeed] = useState("");
  const [multiSeed, setMultiSeed] = useState(false);
  const [bid, setBid] = useState("");
  const [plan, setPlan] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Result>();
  const [frames, setFrames] = useState<{ key: string; baseline?: SynchronizedFrame; branch?: SynchronizedFrame }>();
  const [actor, setActor] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [point, setPoint] = useState(0);
  const [saved, setSaved] = useState(false);
  const knownCase = catalog.find(course => course.case_id === caseId)!;

  useEffect(() => {
    const controller = new AbortController();
    setSpec(undefined); setPatch({}); setBaselinePatch({}); setPlan({}); setMultiSeed(false);
    setResult(undefined); setFrames(undefined); setActor(""); setError(""); setSaved(false);
    api<Specification>(`/cases/${caseId}/parameters`, undefined, controller.signal).then(data => {
      setSpec(data);
      setAction(data.student_actions?.default ?? "");
      setBid(data.auction_limits ? String(data.auction_limits.default_bid) : "");
      setSeed(String(data.default_seed));
    }).catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [caseId]);

  async function runPair() {
    if (!spec || busy) return;
    setError(""); setBusy(true); setSaved(false); setResult(undefined); setFrames(undefined); setActor("");
    const seedValue = Number(seed);
    const count = multiSeed ? 5 : 1;
    if (!seed || !Number.isSafeInteger(seedValue) || seedValue < 0 || seedValue + count - 1 > 2 ** 32 - 1) {
      setError("每组种子都必须是 0 至 4294967295 的整数。");
      setBusy(false);
      return;
    }
    const input = spec.auction_limits ? { bid: Number(bid) } : { action };
    async function run(parameters: Record<string, Scalar>, currentSeed: number, parent?: string) {
      const id = crypto.randomUUID();
      await api("/runs", { schema_version: 2, case_id: caseId, scenario_id: "baseline", provider_kind: "rule",
        request_id: id, seed: currentSeed, ...input, parameter_patch: parameters,
        ...(spec?.weekly_order_plan ? { weekly_orders: plan } : spec?.round_contribution_plan ? { round_contributions: plan } : {}),
        parent_run_id: parent ?? null });
      await api(`/runs/${id}/start?manifest_only=true`, {});
      return id;
    }
    try {
      const sample: PairRun[] = [];
      for (let offset = 0; offset < count; offset++) {
        const currentSeed = seedValue + offset;
        const baseline = await run(baselinePatch, currentSeed);
        const branch = await run(patch, currentSeed, baseline);
        const data = await api<Comparison>(`/runs/${baseline}/compare/${branch}`);
        sample.push({ baseline, branch, data });
      }
      setResult({ ...sample[0], sample });
      setPoint(sample[0].data.rows.length - 1);
    } catch (problem) {
      setError((problem as Error).message);
    } finally { setBusy(false); }
  }

  const data = result?.data;
  const row = data?.rows[point];
  const selectedKey = result && row ? `${result.baseline}/${result.branch}/${point}` : "";
  const observed = frames?.key === selectedKey ? frames : undefined;
  const baseTick = row?.baseline?.tick;
  const branchTick = row?.branch?.tick;
  useEffect(() => {
    if (!result || !selectedKey) return;
    const controller = new AbortController();
    const open = (run: string, tick: number | undefined) => tick === undefined ? undefined :
      isFieldFlagship(caseId) ? getFieldView(run, tick, false, controller.signal) : auctionView(run, tick);
    Promise.all([open(result.baseline, baseTick), open(result.branch, branchTick)])
      .then(([baseline, branch]) => { if (!controller.signal.aborted) setFrames({ key: selectedKey, baseline, branch }); })
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [caseId, result, selectedKey, baseTick, branchTick]);

  function actors(frame?: SynchronizedFrame) {
    const current = frame?.frame;
    if (!current) return [];
    if ("accounts" in current) return Object.keys(current.accounts);
    return current.grid ? current.grid.cells.filter((cell): cell is string => cell !== null) : Object.keys(current.entities);
  }
  function actorDetails(frame?: SynchronizedFrame) {
    const current = frame?.frame;
    if (!current || !actor) return [];
    if ("accounts" in current) {
      const account = current.accounts[actor];
      return account ? Object.entries({ "现金（代币）": account.cash, "持有（件）": account.goods, "已成交（件）": account.filled }) : [];
    }
    if (current.grid) {
      const { cells, size } = current.grid;
      const i = cells.indexOf(actor);
      if (i < 0) return [];
      const [x, y] = [i % size, Math.floor(i / size)];
      const neighbors = cells.filter((value, index) => value !== null && index !== i &&
        Math.abs(index % size - x) <= 1 && Math.abs(Math.floor(index / size) - y) <= 1);
      return Object.entries({ 位置: `第 ${y + 1} 行，第 ${x + 1} 列`,
        "同组／已占邻居": `${neighbors.filter(value => value?.[0] === actor[0]).length}/${neighbors.length}` });
    }
    return Object.entries(current.entities[actor] ?? {});
  }
  const identities = [...new Set([...actors(observed?.baseline), ...actors(observed?.branch), ...(actor ? [actor] : [])])].sort();
  const selection = data && row ? alignmentLabel(data, row) : "";
  const differences = data?.rows.find(item => item.baseline && item.branch && data.metrics.some(metric =>
    item.baseline!.metrics[metric.id] != null && item.branch!.metrics[metric.id] != null &&
    item.baseline!.metrics[metric.id] !== item.branch!.metrics[metric.id]));
  const tape = spec?.weekly_order_plan ?? spec?.round_contribution_plan;
  const weekly = spec?.weekly_order_plan;
  const updateParameter = (parameter: Parameter, value: Scalar) => {
    setPatch(previous => ({ ...previous, [parameter.id]: value }));
    if (parameter.id === "threshold" && baselinePatch.initial_layout === "mixed" && patch.initial_layout === "segregated") {
      setBaselinePatch(previous => ({ ...previous, threshold: value }));
    }
  };

  return <main id="main" tabIndex={-1} className="container field-lesson parameter-lab">
    <header className="field-title"><div><h1>参数对照</h1><p>保持种子和学生行动，改变可核对的模型条件。</p></div>
      <a href={caseHref(caseId)}>返回{knownCase.title}</a></header>
    <label className="field-input">课程 <select aria-label="课程" value={caseId} disabled={busy}
      onChange={event => {
        const next = event.target.value;
        history.replaceState({}, "", `?case=${encodeURIComponent(next)}`);
        setCaseId(next);
      }}>
      {catalog.map(course => <option value={course.case_id} key={course.case_id}>{course.title}</option>)}
    </select></label>
    {initialCase && !catalog.some(course => course.case_id === initialCase) && <p role="alert">链接中的课程不存在，当前显示双向拍卖。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!spec && !error && <p role="status">正在读取模型条件…</p>}
    {spec && <div className="parameter-layout">
      <form onSubmit={event => { event.preventDefault(); void runPair(); }}>
        <fieldset disabled={busy}>
          <legend>共同输入</legend>
          <div className="toolbar">
            <label className="field-input">随机种子 <input type="number" min={0} max={2 ** 32 - 1} step={1} required value={seed}
              onChange={event => setSeed(event.target.value)}/></label>
            {spec.student_actions && <label className="field-input">{spec.student_actions.label}
              <select aria-label={spec.student_actions.label} value={action} onChange={event => setAction(event.target.value)}>
                {spec.student_actions.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select></label>}
            {spec.auction_limits && <label className="field-input">学生限价 <input type="number" min={1} max={spec.auction_limits.maximum}
              step={1} required value={bid} onChange={event => setBid(event.target.value)}/></label>}
          </div>
        </fieldset>
        <details><summary>跨种子核对</summary>
          <label><input type="checkbox" checked={multiSeed} disabled={busy}
            onChange={event => setMultiSeed(event.target.checked)}/>同时运行其后 4 个连续种子</label>
          <p>两组使用同一组种子。首个种子用于同步观察，五组的期末指标差异可展开核对。</p>
        </details>
        {tape && <details className="parameter-weekly">
          <summary>{weekly ? "设定零售逐周订单" : "设定 P1 逐轮贡献"}</summary>
          <p>{weekly ? "提交时从开局重演 40 周。空白周沿用规则，第 5 周空白时沿用上方指定订单。" :
            "提交时从开局重演 10 轮。每轮四人贡献同时公布。第一轮留空时使用上方选定贡献，随后留空轮由规则决定。"}</p>
          <div className="parameter-weeks">{Array.from({ length: weekly?.weeks ?? spec.round_contribution_plan!.rounds },
            (_, index) => index + 1).map(period => <label key={period} className="field-input">第 {period} {weekly ? "周" : "轮"}
              <input type="number" min={tape.min} max={tape.max}
                step={1} value={plan[period] ?? ""} disabled={busy} onChange={event => {
                  if (event.target.value === "") {
                    const copy = { ...plan };
                    delete copy[period];
                    setPlan(copy);
                  } else setPlan({ ...plan, [period]: Number(event.target.value) });
                }}/>
            </label>)}</div>
        </details>}
        <fieldset disabled={busy}>
          <legend>对照条件</legend>
          {caseId === "schelling_segregation" && <button type="button" onClick={() => {
            setBaselinePatch({ initial_layout: "mixed" });
            setPatch({ initial_layout: "segregated" });
          }}>比较混合与分化初态</button>}
          <label className="field-input">从预设取值 <select aria-label="从预设取值" value="" onChange={event => {
            const preset = spec.presets.find(item => item.id === event.target.value);
            if (preset) { setPatch(preset.values); setBaselinePatch({}); }
          }}>
            <option value="">选择预设</option>
            {spec.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select></label>
          {spec.parameters.map(parameter => {
            const current = Object.hasOwn(patch, parameter.id) ? patch[parameter.id] : parameter.default;
            const base = Object.hasOwn(baselinePatch, parameter.id) ? baselinePatch[parameter.id] : parameter.default;
            return <div className="parameter-field" key={parameter.id}>
              <label className="field-input">{parameter.label}{parameter.unit && `（${parameter.unit}）`}
                <select aria-label={parameter.label} value={parameter.values.findIndex(value => value === current)}
                  onChange={event => updateParameter(parameter, parameter.values[Number(event.target.value)])}>
                  {parameter.values.map((value, index) => <option key={index} value={index}>{parameterValue(parameter, value)}</option>)}
                </select>
              </label>
              <p>基准取值 {parameterValue(parameter, base)}。{parameter.constraint}</p>
            </div>;
          })}
        </fieldset>
        <button className="primary" disabled={busy}>{busy ? "正在计算两个新运行…" : "运行参数对照"}</button>
      </form>
      <section className="parameter-result" aria-label="同步对照结果">
        <h2>同步对照结果</h2>
        {!data || !result || !row ? <p>运行后可在同一经济时点核对两组指标与原事件。</p> : <>
          <p>种子 {data.conditions.seed}。{Object.keys(data.conditions.treatments).length ?
            "两组实际执行的参数差异如下。" : "两个运行采用相同的有效参数，可逐点检查复现。"}
          </p>
          <ul>{Object.entries(data.conditions.treatments).map(([key, values]) => {
            const parameter = spec.parameters.find(item => item.id === key);
            return <li key={key}>{parameter?.label ?? key}：{
              parameter ? parameterValue(parameter, values.baseline ?? parameter.default) : showValue(values.baseline)
            } → {parameter ? parameterValue(parameter, values.branch ?? parameter.default) : showValue(values.branch)}</li>;
          })}</ul>
          <p>{differences ? `首个有可比指标差异的观察点：${alignmentLabel(data, differences)}。` :
            "共同观察点的已记录指标相同。可打开原事件查看个体或时序。"}
          </p>
          <label className="field-input">{selection}<input type="range" aria-label="同步观察点" aria-valuetext={selection}
            min={0} max={data.rows.length - 1} value={point} onChange={event => setPoint(Number(event.target.value))}/></label>
          <div className="table-scroll"><table className="parameter-table">
            <thead><tr><th scope="col">指标</th><th scope="col">基准</th><th scope="col">对照</th></tr></thead>
            <tbody>{data.metrics.map(metric => <tr key={metric.id}>
              <th scope="row">{metric.label}（{metric.unit}）</th>
              <td>{showValue(row.baseline?.metrics[metric.id])}</td><td>{showValue(row.branch?.metrics[metric.id])}</td>
            </tr>)}</tbody>
          </table></div>
          {(!row.baseline || !row.branch) && <p>该经济时点至少一组没有对应事件，指标保留缺失。</p>}
          <div className="toolbar">
            {row.baseline && <a href={eventHref(caseId, result.baseline, row.baseline.tick)}>打开基准原事件</a>}
            {row.branch && <a href={eventHref(caseId, result.branch, row.branch.tick)}>打开对照原事件</a>}
          </div>
          {caseId === "schelling_segregation" && observed && <div className="parameter-grids">
            {thumbnail(observed.baseline as FlagshipView, "基准")}{thumbnail(observed.branch as FlagshipView, "对照")}
          </div>}
          {observed && identities.length > 0 && <section className="parameter-actors">
            <label className="field-input">同步观察主体 <select aria-label="同步观察主体" value={actor}
              onChange={event => setActor(event.target.value)}>
              <option value="">选择主体</option>{identities.map(id => <option key={id} value={id}>{id}</option>)}
            </select></label>
            {actor && <div className="parameter-grids">
              {(["baseline", "branch"] as const).map((arm, index) => {
                const fields = actorDetails(observed[arm]);
                return <section key={arm}>
                  <h3>{index === 0 ? "基准" : "对照"} · {actor}</h3>
                  {fields.length ? <dl>{fields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{showValue(value)}</dd></div>)}</dl> :
                    <p>该组当前帧没有此主体状态。</p>}
                </section>;
              })}
            </div>}
          </section>}
          {result.sample.length > 1 && <details><summary>五组模拟样本的期末差异</summary>
            <p>数值为对照减基准。缺少任一侧数值时保留缺失。</p>
            <div className="table-scroll"><table className="parameter-table">
              <thead><tr><th scope="col">种子</th>{data.metrics.map(metric => <th scope="col" key={metric.id}>{metric.label}</th>)}</tr></thead>
              <tbody>{result.sample.map(({ data: replicate }) => {
                const final = replicate.rows.at(-1);
                return <tr key={replicate.conditions.seed}><th scope="row">{replicate.conditions.seed}</th>
                  {replicate.metrics.map(metric => {
                    const left = final?.baseline?.metrics[metric.id];
                    const right = final?.branch?.metrics[metric.id];
                    return <td key={metric.id}>{left == null || right == null ? "缺失" : showValue(right - left)}</td>;
                  })}
                </tr>;
              })}</tbody>
            </table></div>
          </details>}
          <details><summary>运行身份与初态</summary>
            <dl><dt>共同生成根</dt><dd>{data.conditions.common_root}</dd>
              <dt>基准初态哈希</dt><dd>{data.conditions.baseline_initial_hash}</dd>
              <dt>对照初态哈希</dt><dd>{data.conditions.branch_initial_hash}</dd></dl>
          </details>
          <div className="toolbar"><button disabled={saved} onClick={() => {
            const exportRun = (runId: string) => api(`/runs/${runId}/export`);
            const packageArm = async (item: PairRun) => {
              const [baseline, branch] = await Promise.all([exportRun(item.baseline), exportRun(item.branch)]);
              return { ...item.data, baseline, branch };
            };
            Promise.all(result.sample.map(packageArm)).then(([first, ...rest]) => {
              downloadJson(`${caseId}-参数对照.json`, rest.length ? { ...first, replicates: rest } : first);
              setSaved(true);
            }).catch(problem => setError(problem.message));
          }}>{saved ? "已导出这组对照" : "导出对照与两组运行"}</button></div>
        </>}
      </section>
    </div>}
  </main>;
}
