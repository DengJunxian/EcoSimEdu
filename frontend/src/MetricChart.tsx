import { useEffect, useRef, type MouseEvent } from "react";
import { LineChart, type LineSeriesOption } from "echarts/charts";
import { GridComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { Frame, Metric } from "./lesson.ts";

use([LineChart, GridComponent, CanvasRenderer]);

const grid = { left: 38, right: 18, top: 20, bottom: 30 };
const markerRadius = 7;

function financialSegments(frames: readonly Frame[], id: string): LineSeriesOption[] {
  const series: LineSeriesOption[] = [];
  let data: number[][] = [], direction = 0;
  const add = () => {
    if (data.length < 2) return;
    series.push({ type: "line", showSymbol: false, silent: true, data,
      lineStyle: { color: direction > 0 ? "#a92d2d" : "#146247", width: 3 } });
  };
  for (let index = 1; index < frames.length; index++) {
    const before = frames[index - 1].metrics[id], value = frames[index].metrics[id];
    const sign = typeof before === "number" && typeof value === "number" ? Math.sign(value - before) : 0;
    if (sign !== direction) {
      add();
      data = [];
      direction = sign;
    }
    if (direction) {
      if (!data.length) data.push([index - 1, before!]);
      data.push([index, value!]);
    }
  }
  add();
  return series;
}

export default function MetricChart({ metric, frames, cursor, maximum, financial, onSelect }: {
  metric: Metric; frames: readonly Frame[]; cursor?: number; maximum?: number; financial?: boolean; onSelect?: (tick: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const plot = init(element);
    chart.current = plot;
    const observer = new ResizeObserver(() => plot.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      plot.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    const plot = chart.current;
    if (!plot) return;
    plot.setOption({
      animation: false,
      grid,
      xAxis: { type: "category", boundaryGap: false, data: frames.map(frame => frame.tick) },
      yAxis: { type: "value", minInterval: financial ? 0.01 : undefined, scale: financial, max: maximum, splitLine: { lineStyle: { color: "#d9e2d9" } } },
      series: [{ type: "line", showSymbol: true, lineStyle: { color: metric.color, width: 2 },
        data: frames.map(frame => ({
          value: frame.metrics[metric.id] ?? null,
          symbolSize: frame.tick === cursor || frame.turningPoint ? 11 : 6,
          itemStyle: { color: frame.turningPoint ? "#ae5b23" : metric.color },
        })),
      }, ...(financial ? financialSegments(frames, metric.id) : [])],
    }, { replaceMerge: ["series"] });
  }, [metric, frames, cursor, maximum, financial]);
  function locate(event: MouseEvent<HTMLDivElement>) {
    const plot = chart.current;
    if (!onSelect || !plot) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    if (x < grid.left - markerRadius || x > box.width - grid.right + markerRadius ||
        y < grid.top - markerRadius || y > box.height - grid.bottom + markerRadius) return;
    const index = plot.convertFromPixel({ xAxisIndex: 0 }, x);
    if (typeof index === "number" && frames[index]) onSelect(frames[index].tick);
  }
  return <div className="metric-chart" ref={container} aria-hidden="true" onClick={onSelect ? locate : undefined}/>;
}
