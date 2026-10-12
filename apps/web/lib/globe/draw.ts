import { AIRSHIP } from '../paper';
import { K } from '../palette';

export interface ShipColours {
  body: string;
  fin: string;
  rib: string;
  gondola: string;
}

export const OWN_SHIP: ShipColours = { body: K.coral, fin: K.coralD, rib: K.cream, gondola: K.t5 };
export const RIVAL: ShipColours = { body: K.cream, fin: K.t3, rib: K.t2, gondola: K.t5 };

let paths: Record<keyof typeof AIRSHIP, Path2D> | null = null;
function shipPaths() {
  paths ??= {
    fins: new Path2D(AIRSHIP.fins),
    body: new Path2D(AIRSHIP.body),
    ribs: new Path2D(AIRSHIP.ribs),
    gondola: new Path2D(AIRSHIP.gondola),
  };
  return paths;
}

/** An airship nosing along (dx, dy), drawn with its hard shadow. */
export function drawShip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  s: number,
  c: ShipColours,
): void {
  const P = shipPaths();
  ctx.save();
  ctx.translate(x, y);
  if (dx < 0) ctx.scale(-1, 1);
  const a = Math.max(-0.55, Math.min(0.55, Math.atan2(dy, Math.abs(dx) || 1e-6)));
  for (const pass of [0, 1]) {
    ctx.save();
    if (!pass) ctx.translate(dx < 0 ? -4 : 4, 5);
    ctx.rotate(a);
    ctx.scale(s, s);
    if (!pass) {
      ctx.fillStyle = 'rgba(12,47,49,.45)';
      ctx.fill(P.fins);
      ctx.fill(P.body);
      ctx.fill(P.gondola);
    } else {
      ctx.fillStyle = c.fin;
      ctx.fill(P.fins);
      ctx.fillStyle = c.body;
      ctx.fill(P.body);
      ctx.strokeStyle = c.rib;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = (2.4 / s) * 0.4;
      ctx.stroke(P.ribs);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.gondola;
      ctx.fill(P.gondola);
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Diagonal hatching for the waters outside the search zone. */
export function hatchPattern(ctx: CanvasRenderingContext2D, dpr: number): CanvasPattern | null {
  const z = Math.round(10 * dpr);
  const c = document.createElement('canvas');
  c.width = c.height = z;
  const x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = K.t5;
  x.fillRect(0, 0, z, z);
  x.strokeStyle = '#2B6668';
  x.lineWidth = 3 * dpr;
  x.beginPath();
  x.moveTo(-2, z + 2);
  x.lineTo(z + 2, -2);
  x.moveTo(-2, 2);
  x.lineTo(2, -2);
  x.moveTo(z - 2, z + 2);
  x.lineTo(z + 2, z - 2);
  x.stroke();
  const p = ctx.createPattern(c, 'repeat');
  p?.setTransform(new DOMMatrix().scale(1 / dpr));
  return p;
}

export function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, width: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, ro: number, ri: number, n: number, fill: string): void {
  ctx.beginPath();
  for (let i = 0; i < 2 * n; i += 1) {
    const a = (i * Math.PI) / n - Math.PI / 2;
    const r = i % 2 ? ri : ro;
    if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
