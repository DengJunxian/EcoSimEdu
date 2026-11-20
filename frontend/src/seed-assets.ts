export function additionalSeeds(seed: number): readonly [number, number] {
  return [seed + 1, seed + 2];
}

export function seedOffset(seed: number, requested: number) {
  const index = additionalSeeds(seed).indexOf(requested);
  if (index < 0) throw new Error("缺少这个种子的课件输入。");
  return index;
}

import type bank from "./data/paired-inputs.json";

export async function pairedInput<K extends "classroom" | "auction" | "svb">(group: K, seed: number, requested: number): Promise<(typeof bank)[K][number]> {
  const { default: inputs } = await import("./data/paired-inputs.json", { with: { type: "json" } });
  return inputs[group][seedOffset(seed, requested)] as (typeof bank)[K][number];
}
