import opening from "../data/schelling-inputs.json" with { type: "json" };
import { Recorder, profiles, roundEven, type Entity } from "./record.ts";

const residents = opening.grid.filter((resident): resident is string => resident !== null).sort();
const positionOf = new Map(residents.map((resident, index) => [resident, index]));
const hashes = Uint8Array.from(atob(opening.search_digests), byte => byte.charCodeAt(0));
const size = opening.size;
const neighbors = opening.grid.map((_, cell) => {
  const row = Math.floor(cell / size), col = cell % size;
  const adjacent = [];
  for (let r = Math.max(0, row - 1); r <= Math.min(size - 1, row + 1); r++) {
    for (let c = Math.max(0, col - 1); c <= Math.min(size - 1, col + 1); c++) {
      if (r !== row || c !== col) adjacent.push(r * size + c);
    }
  }
  return adjacent;
});

// CPython Random seeds the MT19937 array from the UTF-8 key followed by its SHA-512 digest.
function shuffleCandidates(candidates: number[], key: string, offset: number) {
  const bytes = new Uint8Array(key.length + 64);
  bytes.set(new TextEncoder().encode(key));
  bytes.set(hashes.subarray(offset, offset + 64), key.length);
  const words = new Uint32Array(Math.ceil(bytes.length / 4));
  bytes.reverse().forEach((byte, i) => { words[i >>> 2] |= byte << (i % 4 * 8); });
  const state = new Uint32Array(624);
  state[0] = 19650218;
  for (let i = 1; i < 624; i++) state[i] = Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1812433253) + i;
  let i = 1, j = 0;
  for (let k = 0; k < 624; k++) {
    state[i] = (state[i] ^ Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1664525)) + words[j] + j;
    if (++i === 624) { state[0] = state[623]; i = 1; }
    if (++j === words.length) j = 0;
  }
  for (let k = 0; k < 623; k++) {
    state[i] = (state[i] ^ Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1566083941)) - i;
    if (++i === 624) { state[0] = state[623]; i = 1; }
  }
  state[0] = 0x80000000;
  for (let k = 0; k < 624; k++) {
    const bits = (state[k] & 0x80000000) | (state[(k + 1) % 624] & 0x7fffffff);
    state[k] = state[(k + 397) % 624] ^ (bits >>> 1) ^ (bits & 1 ? 0x9908b0df : 0);
  }
  let draw = 0;
  for (let n = candidates.length; n > 1; n--) {
    const bits = 32 - Math.clz32(n);
    let index: number;
    do {
      let value = state[draw++];
      value ^= value >>> 11;
      value ^= (value << 7) & 0x9d2c5680;
      value ^= (value << 15) & 0xefc60000;
      value ^= value >>> 18;
      index = value >>> (32 - bits);
    } while (index >= n);
    [candidates[n - 1], candidates[index]] = [candidates[index], candidates[n - 1]];
  }
}

export const coordinates = (cell: number) => `第 ${Math.floor(cell / size) + 1} 行第 ${cell % size + 1} 列`;
export const openingChoice = opening.student_target;

function counts(grid: readonly (string | null)[], cell: number, resident: string, excluded = -1) {
  let same = 0, total = 0;
  for (const neighbor of neighbors[cell]) {
    const other = grid[neighbor];
    if (neighbor === excluded || !other) continue;
    total++;
    if (other[0] === resident[0]) same++;
  }
  return [same, total] as const;
}

export const openingNeighbors = counts(opening.grid, opening.grid.indexOf("A001"), "A001");
export const openingTarget = counts(opening.grid, openingChoice, "A001", opening.grid.indexOf("A001"));

const meetsThreshold = ([same, total]: readonly [number, number], threshold: number) => 100 * same >= threshold * total;

export function residentOptions(grid: readonly (string | null)[], resident: string, threshold: number) {
  const origin = grid.indexOf(resident);
  const home = counts(grid, origin, resident);
  const legal = grid.flatMap((occupant, cell) => {
    if (occupant !== null) return [];
    const local = counts(grid, cell, resident, origin);
    return meetsThreshold(local, threshold) ? [{ cell, local }] : [];
  });
  return { origin, home, satisfied: meetsThreshold(home, threshold), legal };
}

export function schelling(seed: number, action: string, scenario: string, threshold: number) {
  const grid = [...opening.grid];
  const cells = new Map(grid.flatMap((actor, i) => actor ? [[actor, i] as const] : []));
  const vacancies = new Set(grid.flatMap((actor, i) => actor ? [] : [i]));
  const eligible = (local: readonly [number, number]) => meetsThreshold(local, threshold);
  const people = profiles(residents, `阈值 ${threshold}%，候选位置只能是空格`, "达到阈值时不按阈值规则迁移");
  for (const actor of residents) people[actor].state = actor[0];
  const log = new Recorder(residents, people);
  let moves = 0, remaining = 0;

  function emit(kind: string, text: string, period: number, actors: string[], marked: number[], data?: object, turningPoint?: string,
    evidence?: NonNullable<Parameters<Recorder["emit"]>[3]>["evidence"]) {
    const entities: Entity = {};
    let sameEdges = 0, edges = 0;
    remaining = 0;
    for (const actor of residents) {
      const cell = cells.get(actor)!;
      const local = counts(grid, cell, actor);
      sameEdges += local[0];
      edges += local[1];
      remaining += Number(!eligible(local));
      entities[actor] = { 位置: coordinates(cell), 同组邻居: local[0], 已占邻居: local[1], 达到阈值: eligible(local) ? "是" : "否" };
    }
    log.emit(kind, text, { satisfied: roundEven(10000 * (residents.length - remaining) / residents.length) / 100,
      similarity: edges ? roundEven(10000 * sameEdges / edges) / 100 : null, moves, remaining },
    { period, actors, entities, evidence, data, turningPoint, board: { size, cells: [...grid], marked } });
  }

  function relocate(actor: string, destination: number, period: number, student = false) {
    const origin = cells.get(actor)!;
    const before = counts(grid, origin, actor);
    const affected = [...new Set([...neighbors[origin], ...neighbors[destination]]
      .flatMap(index => grid[index] && grid[index] !== actor ? [grid[index]!] : []))].sort();
    const previous = affected.map(id => counts(grid, cells.get(id)!, id));
    grid[origin] = null;
    grid[destination] = actor;
    cells.set(actor, destination);
    vacancies.delete(destination);
    vacancies.add(origin);
    const after = counts(grid, destination, actor);
    const changed_neighbors = affected.map((id, index) => ({
      actor: id, before: previous[index], after: counts(grid, cells.get(id)!, id),
    }));
    moves++;
    emit(student ? "student_move" : "move",
      `${actor} 从${coordinates(origin)}搬到${coordinates(destination)}。同组邻居 ${before.join("/")} → ${after.join("/")}，影响 ${affected.length} 户的邻居集合。`,
      period, [actor, ...affected], [origin, destination],
      { actor_id: actor, origin, destination, before, after, changed_neighbors, source: student ? "student" : "rule" },
      moves === 1 ? "首次发生真实搬迁" : undefined,
      changed_neighbors.map(row => ({ actorId: row.actor, deltas: {}, text:
        `${row.actor} 的同组邻居 / 已占邻居 ${row.before.join("/")} → ${row.after.join("/")}` })));
  }

  const marked = [cells.get("A001")!, openingChoice];
  emit("opening", `社区共有 ${residents.length} 户，最低同类比例为 ${threshold}%`, 0, ["A001"], marked,
    { size, grid: opening.grid, student_target: openingChoice });
  if (action === "move") relocate("A001", openingChoice, 0, true);
  else emit("student_stay", "A001 留在原地。", 0, ["A001"], marked);

  let lastRound = 0, terminal = "round_limit";
  for (const [index, visit] of opening.visits.entries()) {
    const round = index + 1;
    lastRound = round;
    const start = moves;
    for (const actor of visit) {
      const origin = cells.get(actor)!;
      if (eligible(counts(grid, origin, actor))) continue;
      const candidates = [...vacancies].sort((a, b) => a - b);
      shuffleCandidates(candidates, `${seed}:search:${round}:${actor}`, (index * residents.length + positionOf.get(actor)!) * 64);
      const destination = candidates.find(cell => eligible(counts(grid, cell, actor, origin)));
      if (destination !== undefined) relocate(actor, destination, round);
    }
    emit("round_end", `第 ${round} 轮搬迁 ${moves - start} 次。`, round, [], []);
    if (!remaining || moves === start) {
      terminal = remaining ? "blocked" : "all_satisfied";
      break;
    }
  }
  emit("market_close", { round_limit: "达到轮数上限。", blocked: "无可行搬迁，仍有居民未达阈值。",
    all_satisfied: "所有居民达到阈值。" }[terminal]!, lastRound, [], [], { terminal });
  return log.run("schelling_segregation", seed, action, scenario);
}
