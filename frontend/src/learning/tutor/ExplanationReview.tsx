import { useId, useState } from "react";
import type { AuctionRun } from "../../auction.ts";
import { sourceLink, sourceRun, type StudentNote } from "../../learning-store.ts";
import type { ModelRun } from "../../models/record.ts";
import type { SvbRun } from "../../svb.ts";
import { auctionExplanationSource, svbExplanationSource } from "./financial-review-evidence.ts";
import { explanationSource } from "./schelling-evidence.ts";

type Review = { mode: "author" | "ai"; question: string; reason: string | null };

const excerpt = (value: string) => Array.from(value.trim()).slice(0, 160).join("");

const lessons = {
  schelling_segregation: () => import("../../models/schelling-lesson.ts").then(module => module.schellingLesson),
  svb_run: () => import("../../svb.ts").then(module => module.svbLesson),
  double_auction: (note: StudentNote) => import("../../auction.ts").then(module =>
    module.auctionLesson(note.course.market === "no-overlap")),
};

export function supportsExplanationReview(caseId: string): caseId is keyof typeof lessons {
  return Object.hasOwn(lessons, caseId);
}

export function ExplanationReview({ note }: { note: StudentNote }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Review>();
  const [message, setMessage] = useState("");
  const consentId = useId();

  async function review() {
    setBusy(true);
    setResult(undefined);
    setMessage("正在核对两条原事件并请求追问。");
    try {
      const caseId = note.course.caseId;
      if (!supportsExplanationReview(caseId)) return;
      const lesson = await lessons[caseId](note);
      const [first, second] = await Promise.all([
        sourceRun(lesson, note, "baseline"),
        sourceRun(lesson, note, "comparison"),
      ]);
      if (first?.verification !== "saved" || second?.verification !== "saved") {
        setMessage("这张卡的原事件无法核对。请从课堂重新选择两条事件并保存解释。");
        return;
      }
      const course = lesson.casePackage!;
      const [baseline, comparison] = await Promise.all([first, second].map(({ run, tick, event }) => {
        if (caseId === "svb_run") return svbExplanationSource(run as SvbRun, tick, event.eventId, course);
        if (caseId === "double_auction") return auctionExplanationSource(run as AuctionRun, tick, course);
        return explanationSource(run as ModelRun, tick, course);
      }));
      const answer = await fetch("/api/ai/review/explanation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true, case_id: caseId, case_version: course.caseVersion, content_version: course.browserContentVersion,
          baseline, comparison,
          explanation: {
            claim: excerpt(note.claim ?? note.comparison), rule: excerpt(note.rule),
            calculation: excerpt(note.calculation), comparison: excerpt(note.comparison),
            hypothesis: excerpt(note.hypothesis), ...(note.alternative && { alternative: excerpt(note.alternative) }),
          },
        }),
      });
      if (answer.status === 409) {
        setMessage("本机服务无法确认两条来源或当前会话。可重试，或使用离线自查。");
        return;
      }
      if (!answer.ok) throw new Error("Review unavailable");
      const reply: Review = await answer.json();
      if (!["ai", "author"].includes(reply.mode) || typeof reply.question !== "string") throw new Error("Invalid review");
      setResult(reply);
      setMessage(reply.mode === "ai" ? `AI 选出的追问 · ${reply.question}` :
        `${reply.reason === "not_connected" ? "可先连接 AI。" : "本次 AI 审阅暂不可用。"} 作者自查 · ${reply.question}`);
    } catch {
      setMessage("无法请求在线审阅。可重试，或使用离线自查。");
    } finally {
      setBusy(false);
    }
  }

  return <details>
    <summary>在线解释审阅</summary>
    <p id={consentId}>请求时会把已保存解释各栏的前 160 字和两条已核对的事件摘要发给当前模型供应商，可能产生费用。请避免填写个人信息。</p>
    <button type="button" aria-describedby={consentId} disabled={busy} onClick={() => void review()}>请 AI 审阅</button>
    <p role="status">{message}</p>
    {result?.reason === "not_connected" && <p><a href="./?view=ai">打开 AI 连接设置</a></p>}
    {result && <div className="note-links">
      <a href={sourceLink(note, "baseline")}>查看追问的基线证据</a>
      <a href={sourceLink(note, "comparison")}>查看追问的{note.fork ? "分支" : "政策组"}证据</a>
    </div>}
  </details>;
}
