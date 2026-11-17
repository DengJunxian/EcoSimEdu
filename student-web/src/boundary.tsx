import { useRef, useState } from "react";
import definitions from "../../cases/boundaries.json";
import { api, ApiError, traceHref } from "./contracts";
import type { Provider } from "./contracts";

type Boundary = { label: string; description: string; bid?: number; action?: string; replay?: boolean };
export const boundaries: Record<string, Boundary | undefined> = definitions;
const boundaryHref = (caseId: string) => `/?${new URLSearchParams({ case: caseId, boundary: "1" })}`;

export function BoundaryLink({ caseId }: { caseId: string }) {
  const spec = boundaries[caseId];
  return spec && <p><a href={boundaryHref(caseId)}>边界实验：{spec.label}</a></p>;
}

export function BoundaryApp({ course }: { course: { case_id: string; title: string; seed: number } }) {
  const spec = boundaries[course.case_id]!;
  const recentKey = `civitas/boundary/${course.case_id}`;
  const [recent] = useState(() => {
    try { return localStorage.getItem(recentKey); } catch { return null; }
  });
  const requestIds = useRef<Partial<Record<Provider, string>>>({});
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  async function start(provider: Provider) {
    const id = requestIds.current[provider] ??= crypto.randomUUID();
    setWaiting(true);
    setError("");
    try {
      const run = await api<{ run_id: string }>("/runs", {
        request_id: id, case_id: course.case_id, scenario_id: "boundary", seed: course.seed,
        provider_kind: provider, bid: spec.bid, action: spec.action,
      });
      await api(`/runs/${run.run_id}/start`, {});
      try { localStorage.setItem(recentKey, run.run_id); } catch { /* The result link still works. */ }
      location.assign(traceHref(course.case_id, run.run_id, 0));
    } catch (problem) {
      if (problem instanceof ApiError && ["RUN_FAILED", "RUN_ALREADY_TERMINAL"].includes(problem.code)) {
        delete requestIds.current[provider];
      }
      setError(problem instanceof Error ? problem.message : "边界实验无法运行。");
      setWaiting(false);
    }
  }

  return <main className="container course-home">
    <a href={`/?${new URLSearchParams({ case: course.case_id })}`}>返回课程</a>
    <h1>{spec.label}</h1>
    <p>{spec.description}</p>
    <div className="toolbar">
      <button className="primary" disabled={waiting} onClick={() => void start("rule")}>运行边界实验</button>
      {spec.replay && <button disabled={waiting} onClick={() => void start("replay")}>载入预计算边界回放</button>}
      {recent && <a href={traceHref(course.case_id, recent, 0)}>回放上次边界实验</a>}
    </div>
    {waiting && <p role="status">正在读取边界实验…</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </main>;
}
