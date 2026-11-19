import type { Actor, Frame, Lesson, LessonEvent, Run } from "./lesson.ts";

const actorIds = Array.from({ length: 24 }, (_, index) => `N${String(index + 1).padStart(2, "0")}`);
const metric = "waiting";
const busyThreshold = 6;
const player = actorIds[0];

// Every neighbor gets the same arrival and willingness draws in both branches.
function draw(seed: number, index: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(index + 1, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  return ((x ^ (x >>> 15)) >>> 0) / 2 ** 32;
}

function simulate({ seed, choices, policy }: Parameters<Lesson["run"]>[0]): Run {
  const actors: Actor[] = actorIds.map((id, index) => ({
    id, name: index === 0 ? "你 · 小林" : `邻居 ${id}`, marker: index === 0 ? "你" : id.slice(1), state: "idle",
    constraint: index === 0 ? `第 ${choices[0] === "early" ? 1 : 2} 轮申请；最多等 ${choices[1] === "short" ? 1 : 3} 轮` :
      "每人最多申请一套工具",
    signal: "还没有看到等候公示", reason: "等待申请时机",
  }));
  const queue: { actorIndex: number; since: number }[] = [];
  const frames: Frame[] = [{ tick: 0, actors: [...actors], metrics: { [metric]: 0 }, events: [] }];
  for (let tick = 1; tick <= 8; tick++) {
    const announced = queue.length;
    const events: LessonEvent[] = [];
    const signal = `上一轮结束时有 ${announced} 人等候`;
    function record(actorIndex: number, state: string, reason: string, delta: number, usesSignal = false) {
      const actor = actors[actorIndex];
      actors[actorIndex] = { ...actor, state, reason, signal };
      events.push({ id: `${tick}/${events.length}`, actorId: actor.id, text: `${actor.name}：${reason}`,
        deltas: { [metric]: delta },
        ...(usesSignal ? { priorSignal: { metricId: metric, tick: tick - 1, value: announced } } : {}) });
    }
    const playerPlace = queue.findIndex(entry => actors[entry.actorIndex].id === player);
    if (playerPlace >= 0 && tick - queue[playerPlace].since >= (choices[1] === "short" ? 1 : 3)) {
      queue.splice(playerPlace, 1);
      record(0, "left", "已等到自己设定的期限，改去找备用工具", -1);
    }

    for (let index = 0; index < actors.length; index++) {
      const window = index === 0 ? (choices[0] === "early" ? 1 : 2) :
        index <= 9 ? 1 : 2 + Math.floor(draw(seed, index * 2) * 4);
      if (tick !== window || actors[index].state !== "idle") continue;
      if (index !== 0 && announced >= busyThreshold && draw(seed, index * 2 + 1) < .75) {
        record(index, "left", "看到等候人数达到 6 人，决定改天再借", 0, true);
      } else {
        queue.push({ actorIndex: index, since: tick });
        record(index, "waiting", index === 0 ? "按你的决定提交申请" : "看到当前等候人数后，选择申请", 1, index !== 0);
      }
    }

    for (const entry of queue.splice(0, policy)) {
      record(entry.actorIndex, "served", "轮到这位申请人，领到一套工具", -1);
    }
    for (const { actorIndex } of queue) {
      const actor = actors[actorIndex];
      if (actor.state !== "waiting" || actor.signal === signal) continue;
      actors[actorIndex] = { ...actor, signal, reason: "申请已入队，等待轮到自己" };
    }

    const crossed = announced < busyThreshold && queue.length >= busyThreshold;
    frames.push({ tick, actors: [...actors], metrics: { [metric]: queue.length }, events,
      ...(crossed ? { turningPoint: "等候人数从低于 6 人升到拥挤阈值" } : {}) });
  }
  return { id: `tool-library/v1/${seed}/${choices.join("-")}/${policy}`, seed, frames };
}

export const toolLibrary: Lesson = {
  title: "一把工具，要等多久？",
  populationTitle: "工具站的邻居",
  role: { title: "小林 · 社区居民",
    perspective: "你要在第 3 轮用到一套工具。社区工具站每轮发放 2 套，按申请先后发放。排到你前，你可以取消申请。",
    timeline: [{ label: "第 1 轮" }, { label: "第 2 轮" }, { label: "需要工具", highlighted: true }],
    facts: [{ label: "用工具的时间", value: "第 3 轮" }, { label: "发放规则", value: "先申请，先领取" }] },
  source: { kind: "illustrative", note: "脚手架练习 · 虚构社区，数据由本机模型生成。" },
  decisions: [
    { prompt: "你会在什么时候申请？", options: [
      { id: "early", label: "第 1 轮就申请", response: "你的申请会在第 1 轮进入队列。" },
      { id: "late", label: "第 2 轮再申请", response: "你会留到第 2 轮再提交申请。" },
    ] },
    { prompt: "排不到时，你最多愿意等多久？", options: [
      { id: "short", label: "等 1 轮就换办法", response: "等满 1 轮时，你会退出队列。" },
      { id: "long", label: "最多等 3 轮", response: "等满 3 轮时，你会退出队列。" },
    ] },
  ],
  metrics: [{ id: metric, label: "等候人数", unit: "人", color: "#26666b" }],
  states: {
    idle: { label: "尚未申请", color: "#d7ded3" },
    waiting: { label: "在等待", color: "#f4c16a" },
    served: { label: "已领工具", color: "#78cdc2" },
    left: { label: "退出或改天", color: "#b3a2cf" },
  },
  policy: { label: "每轮发放工具", min: 2, max: 5, baseline: 2, unit: "套" },
  seed: 412,
  run: simulate,
};
