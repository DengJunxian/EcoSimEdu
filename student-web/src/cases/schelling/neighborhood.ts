import type { Grid } from "../../lesson-types";

export type Counts = [same: number, total: number];
export type LocalCell = { index: number | null; actor: string | null; center: boolean };

export function localCells(grid: Grid, cell: number, excluded?: number): LocalCell[] {
  const row = Math.floor(cell / grid.size), col = cell % grid.size;
  return [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => {
    const y = row + dy, x = col + dx;
    const index = y < 0 || x < 0 || y >= grid.size || x >= grid.size ? null : y * grid.size + x;
    return {
      index, actor: index !== null && index !== excluded ? grid.cells[index] : null,
      center: dy === 0 && dx === 0,
    };
  }));
}

export function occupiedNeighbors(cells: LocalCell[]) {
  return cells.flatMap(item => !item.center && item.actor !== null ? [item.actor] : []);
}

export function localCounts(cells: LocalCell[], actor: string): Counts {
  const neighbors = occupiedNeighbors(cells);
  return [neighbors.filter(value => value[0] === actor[0]).length, neighbors.length];
}

export function satisfied([same, total]: Counts, threshold: number) {
  return 100 * same >= threshold * total;
}

export function coordinates(cell: number, size: number) {
  return `第 ${Math.floor(cell / size) + 1} 行第 ${cell % size + 1} 列`;
}
