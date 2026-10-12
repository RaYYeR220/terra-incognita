/**
 * Places labels so they do not cover each other. Each item wants to sit on its anchor; when
 * that spot is taken it moves out along rings of eight directions and is tied back to the
 * anchor with a thread. Earlier items in the list win.
 */
export interface LabelBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed {
  key: string;
  x: number;
  y: number;
  moved: boolean;
}

const DIRS: [number, number][] = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

export function declutter(
  items: readonly LabelBox[],
  previous: ReadonlyMap<string, [number, number]> = new Map(),
  inside: (x: number, y: number) => boolean = () => true,
  gap = 3,
): Placed[] {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: Placed[] = [];
  const free = (x: number, y: number, w: number, h: number) =>
    placed.every((p) => Math.abs(p.x - x) * 2 >= p.w + w + gap * 2 || Math.abs(p.y - y) * 2 >= p.h + h + gap * 2);

  for (const it of items) {
    const tries: [number, number][] = [[0, 0]];
    const prev = previous.get(it.key);
    if (prev) tries.unshift(prev);
    for (let ring = 1; ring <= 4; ring += 1) {
      for (const [dx, dy] of DIRS) tries.push([dx * (it.w * 0.55 + gap) * ring, dy * (it.h + gap) * ring]);
    }
    let pick: [number, number] = [0, 0];
    for (const [dx, dy] of tries) {
      const x = it.x + dx;
      const y = it.y + dy;
      if ((dx || dy) && !inside(x, y)) continue;
      if (free(x, y, it.w, it.h)) {
        pick = [dx, dy];
        break;
      }
    }
    placed.push({ x: it.x + pick[0], y: it.y + pick[1], w: it.w, h: it.h });
    out.push({ key: it.key, x: it.x + pick[0], y: it.y + pick[1], moved: pick[0] !== 0 || pick[1] !== 0 });
  }
  return out;
}
