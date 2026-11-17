export type ScenarioId = "baseline" | "demand" | "fee" | "boundary";
export type Provider = "rule" | "replay";

export type MarketEvent = {
  seq: number;
  tick: number;
  event_type: string;
  actor_id?: string;
  order_id?: string;
  price?: number;
  side?: "buy" | "sell";
  buyer_id?: string;
  seller_id?: string;
  buy_order_id?: string;
  sell_order_id?: string;
  buyer_surplus?: number;
  seller_surplus?: number;
  platform_fee?: number;
  source?: string;
  reference_price?: number | null;
  maker_order_id?: string;
};
export type Account = { cash: number; goods: number; filled: number };
export type Snapshot = {
  tick: number;
  best_bid: number | null;
  best_ask: number | null;
  last_price: number | null;
  volume: number;
  surplus: number;
  accounts: Record<string, Account>;
  orders: { order_id: string; actor_id: string; side: string; price: number }[];
};
export type Run = {
  run_id: string;
  case_id: "double_auction";
  case_version: string;
  scenario_id: ScenarioId;
  provider_kind: Provider;
  parent_run_id: string | null;
  seed: number;
  bid: number;
  result_hash: string;
  execution_status: "completed";
  origin: "precomputed_simulation" | "offline_simulation";
  result: {
    root_hash: string;
    intervention: { demand_shift: number; fee: number };
    initial: Record<string, Account & { side: string; marginals: number[] }>;
    events: MarketEvent[];
    snapshots: Snapshot[];
    supply: number[];
    demand: number[];
    metrics: {
      volume: number;
      price_min: number | null;
      price_max: number | null;
      surplus: number;
      ceiling: number;
      efficiency: number | null;
      platform_cash: number;
      participant_surplus: number;
      price_band: [number, number] | null;
    };
  };
};

const messages: Record<string, string> = {
  BOUNDARY_PARAMETERS_MISMATCH: "边界实验使用课程指定的种子和行动，请从课程入口启动。",
  V2_PROVIDER_NOT_SUPPORTED: "该运行方式不支持自定义参数或行动序列。",
  INVALID_ROUND_CONTRIBUTIONS: "逐轮贡献只适用于公共品博弈。每轮贡献须为 0–20 的整数代币。",
  INVALID_WEEKLY_ORDERS: "逐周订单只适用于啤酒游戏。每周订单须为 0–40 的整数件数。",
  PRESET_NOT_AVAILABLE: "没有匹配的固定回放。可使用本地规则计算。",
  CASE_NOT_AVAILABLE: "此课程尚未发布。",
  ALIGNMENT_NOT_AVAILABLE: "这门课尚未定义共同观察点。",
  RUNS_NOT_PAIRED: "运行的配对条件不一致，无法同步比较。",
  RUN_VERSION_MISMATCH: "运行版本与当前课程不一致。",
  INVALID_COMPARISON_PARENT: "对照需使用同一课程的基准运行、行动和种子。",
  PRESET_INTEGRITY_ERROR: "预计算文件校验失败。可改用规则计算。",
  RUN_INTEGRITY_ERROR: "运行记录校验失败。请重新开始实验。",
  RUN_NOT_FOUND: "本地运行记录已缺失。请重新开始实验。",
  LIVE_NOT_CONFIGURED: "本机尚未启用模型服务。",
  LIVE_REFERENCE_NOT_AVAILABLE: "高级实验完成后可以查看规则对照。",
  LIVE_BUSY: "另一组高级实验正在运行，请稍后重试。",
  LIVE_LOCAL_ONLY: "高级实验只能从本地学生实验室启动。",
  EVIDENCE_RUN_MISMATCH: "证据运行与当前课程不一致。",
  EVIDENCE_TICK_NOT_AVAILABLE: "该运行没有这一事件。",
  SNAPSHOT_NOT_AVAILABLE: "该运行没有这一观察时刻。",
  EVENT_NOT_AVAILABLE: "该运行没有这一事件序号。",
  RUN_FAILED: "实验计算失败。可用原参数重新运行。",
  RUN_ALREADY_TERMINAL: "这次运行已结束。可用原参数重新运行。",
};
export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
export async function api<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined ? { signal } : {
    signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const code = typeof problem.detail === "string" ? problem.detail : "";
    throw new ApiError(code, messages[code] ?? (/[\u4e00-\u9fff]/.test(code) ? code : "本地服务未能处理请求，请检查参数后重试。"));
  }
  return response.json();
}

export async function launch(scenario: ScenarioId, provider: Provider, seed: number, bid: number, requestId: string, parent?: string) {
  const created = await api<{ run_id: string; execution_status: string }>("/runs", {
    case_id: "double_auction", request_id: requestId, scenario_id: scenario,
    provider_kind: provider, seed, bid, parent_run_id: parent ?? null,
  });
  return created.execution_status === "cancelled" ? null : api<Run>(`/runs/${created.run_id}/start`, {});
}

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function traceHref(caseId: string, runId: string, tick: number) {
  return `/?${new URLSearchParams({ case: caseId, run: runId, tick: String(tick) })}`;
}

export function eventHref(caseId: string, runId: string, seq: number) {
  return `/?${new URLSearchParams({ case: caseId, run: runId, event: String(seq) })}`;
}
