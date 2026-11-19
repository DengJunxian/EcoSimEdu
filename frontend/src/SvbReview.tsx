import type { Session } from "./lesson.ts";

export function SvbReview({ session }: { session: Session }) {
  if (session.stage !== 2 || !session.run) return null;
  const frames = session.run.frames.slice(0, session.cursor + 1);
  const application = frames.find(frame => frame.events.some(event => event.actorId === "D01" && event.kind === "request"));
  if (!application) return null;
  const payment = frames.find(frame => frame.events.some(event => event.actorId === "D01" && event.kind === "payment"));
  return <section className="prediction-review" aria-label="核对入场预测">
    <h2>申请与到账</h2>
    <p>你原先选了「{session.choices[1] === "at-request" ? "提交申请时" : "实际支付时"}」。</p>
    <p>D01 在第 {application.tick} 轮提出申请。申请事件增加待付额。
      {payment ? `在第 ${payment.tick} 轮实际支付时，这笔款项才使银行现金和存款负债同减。` :
        "已揭示的记录里暂未出现 D01 到账事件，可以继续播放。"}
    </p>
  </section>;
}
