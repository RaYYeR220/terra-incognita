import { render as R } from '@terra-incognita/core';
import type { LogEntry, Pin, Ship, Zone } from '@terra-incognita/core';
import { geoCircle, geoDistance, geoGraticule, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';

import { unitToLonLat, vecToLonLat } from '../geo';
import type { LonLat } from '../geo';
import { K } from '../palette';
import { declutter } from './declutter';
import { OWN_SHIP, RIVAL, drawCross, drawShip, drawStar, hatchPattern } from './draw';
import { cartesian, delta, multiply, rotationOf, versor } from './versor';
import type { Rotation } from './versor';

export interface GlobeScene {
  zone: Zone;
  ships: readonly Ship[];
  myShip: number;
  pins: readonly Pin[];
  logbook: readonly LogEntry[];
  proposal: LonLat | null;
  revealed: LonLat | null;
}

export interface GlobeCallbacks {
  onPick: (at: LonLat) => void;
  onPin: (pin: Pin, at: LonLat) => void;
  onView?: (centre: LonLat, zoom: number) => void;
}

interface Drop {
  at: LonLat;
  t0: number;
  mine: boolean;
}

const GRATICULE = geoGraticule().step([15, 15])();
const MIN_Z = 1;
const MAX_Z = 9;
const FINE_FROM = 2.2;
const DROP_MS = 1100;

/**
 * The globe on the game screen: a canvas drawn with d3-geo, turned with versor dragging and
 * inertia, zoomed with the wheel, pinch or keys. It redraws only when something changed or is
 * moving. DOM markers in the overlay (flaps, the course tag, tooltips) are positioned here so
 * they stay glued to the globe without React re-rendering every frame.
 */
export class GlobeEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly proj = geoOrthographic().clipAngle(90).precision(0.4);
  private readonly path = geoPath(this.proj);
  private land: GeoPermissibleObjects | null = null;
  private fine: GeoPermissibleObjects | null = null;
  private hatch: CanvasPattern | null = null;
  private scene: GlobeScene | null = null;
  private pinLL: { pin: Pin; at: LonLat }[] = [];
  private ownLL: LonLat[] = [];

  private W = 0;
  private H = 0;
  private cx = 0;
  private cy = 0;
  private radius = 100;
  private dpr = 1;
  private rot: Rotation = [-52, 43, 0];
  private zoom = 1.4;

  private raf = 0;
  private interacting = false;
  private focused = false;
  private velocity: Rotation | null = null;
  private lastFrame = 0;
  private drops: Drop[] = [];
  private tween: { from: Rotation; to: Rotation; t0: number; ms: number } | null = null;
  private flapOffsets = new Map<string, [number, number]>();
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: {
    x: number; y: number; moved: boolean; q0: ReturnType<typeof versor>; v0: [number, number, number];
    samples: { r: Rotation; t: number }[];
  } | null = null;
  private pinch: { d: number; z: number } | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLElement,
    private readonly now: () => number,
    private readonly cb: GlobeCallbacks,
    private readonly reserved: () => DOMRect[] = () => [],
    private readonly reduceMotion = false,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.bind();
  }

  setLand(land: GeoPermissibleObjects): void {
    this.land = land;
    this.draw();
  }

  setFineLand(land: GeoPermissibleObjects): void {
    this.fine = land;
    this.draw();
  }

  get wantsFine(): boolean {
    return this.zoom >= FINE_FROM && !this.fine;
  }

  setScene(scene: GlobeScene): void {
    const prev = this.scene;
    this.scene = scene;
    if (!prev || prev.pins !== scene.pins) this.pinLL = scene.pins.map((pin) => ({ pin, at: vecToLonLat(pin.pos) }));
    if (!prev || prev.logbook !== scene.logbook) this.ownLL = scene.logbook.map((e) => vecToLonLat(e.pos));
    this.draw();
  }

  /** A lead line dropping onto the globe: on every new sounding, mine or a rival's. */
  drop(at: LonLat, mine: boolean): void {
    if (this.reduceMotion) return;
    this.drops.push({ at, t0: performance.now(), mine });
    this.draw();
  }

  zoomBy(f: number): void {
    this.zoom = Math.max(MIN_Z, Math.min(MAX_Z, this.zoom * f));
    this.viewChanged();
    this.draw();
  }

  rotateBy(dl: number, dp: number): void {
    this.rot = [this.rot[0] + dl, Math.max(-89, Math.min(89, this.rot[1] + dp)), this.rot[2]];
    this.viewChanged();
    this.draw();
  }

  centreOn([lon, lat]: LonLat, instant = false): void {
    const to: Rotation = [-lon, -lat, 0];
    if (this.reduceMotion || instant) {
      this.rot = to;
      this.draw();
      return;
    }
    const from = [...this.rot] as Rotation;
    to[0] = from[0] + ((((to[0] - from[0]) % 360) + 540) % 360) - 180;
    this.tween = { from, to, t0: performance.now(), ms: 700 };
    this.draw();
  }

  /** The point at the centre of the view; the keyboard picks it with Enter. */
  centre(): LonLat {
    const ll = this.proj.invert?.([this.cx, this.cy]);
    return ll ? [ll[0], ll[1]] : [0, 0];
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    const mobile = this.W < 560;
    const lap = mobile ? 10 : 26;
    let rad = mobile ? Math.min(this.W / 2 - 14, (this.H - lap) / 2 - 12) : Math.min(this.W / 2 - 56, (this.H - lap) / 2 - 18);
    this.cx = this.W / 2;
    this.cy = (this.H - lap) / 2 + (mobile ? 6 : 4);
    // Keep the zone sign, hint and zoom buttons clear of the globe's edge.
    const floor = rad * 0.62;
    const box = this.canvas.getBoundingClientRect();
    for (const b of this.reserved()) {
      const x = Math.max(b.left - box.left, Math.min(this.cx, b.right - box.left));
      const y = Math.max(b.top - box.top, Math.min(this.cy, b.bottom - box.top));
      const d = Math.hypot(x - this.cx, y - this.cy);
      if (d - 10 < rad) rad = Math.max(floor, d - 10);
    }
    this.radius = Math.max(60, rad);
    this.hatch = hatchPattern(this.ctx, this.dpr);
    this.draw();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    if (this.viewTimer) clearTimeout(this.viewTimer);
    for (const off of this.cleanup) off();
  }

  draw = (): void => {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  private frame = (ts: number): void => {
    this.raf = 0;
    const dt = this.lastFrame ? Math.min(64, ts - this.lastFrame) : 16;
    this.lastFrame = ts;
    let moving = false;

    if (this.tween) {
      const k = Math.min(1, (ts - this.tween.t0) / this.tween.ms);
      const e = 1 - Math.pow(1 - k, 3);
      const { from, to } = this.tween;
      this.rot = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e];
      if (k >= 1) this.tween = null;
      moving = true;
      this.viewChanged();
    } else if (this.velocity && !this.drag) {
      const v = this.velocity;
      this.rot = [this.rot[0] + v[0] * dt, Math.max(-89, Math.min(89, this.rot[1] + v[1] * dt)), this.rot[2] + v[2] * dt];
      const decay = Math.exp(-dt / 320);
      this.velocity = [v[0] * decay, v[1] * decay, v[2] * decay];
      if (Math.hypot(...this.velocity) < 0.002) this.velocity = null;
      moving = true;
      this.viewChanged();
    }

    moving = this.paint() || moving;
    if (moving) this.draw();
    else this.lastFrame = 0;
  };

  private visible = (ll: LonLat, centre: LonLat): boolean => geoDistance(ll, centre) < Math.PI / 2 - 0.02;

  /** Draws one frame. Returns true while something on the globe is still moving. */
  private paint(): boolean {
    const { ctx, proj, path } = this;
    const s = this.scene;
    const t = this.now();
    const mobile = this.W < 560;
    let animating = false;

    proj.rotate(this.rot).scale(this.radius * this.zoom).translate([this.cx, this.cy]);
    const R0 = this.radius * this.zoom;
    const centre = this.centre();
    const vis = (ll: LonLat) => this.visible(ll, centre);
    const P = (ll: LonLat): [number, number] => proj(ll) as [number, number];

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    path.context(ctx);

    ctx.fillStyle = 'rgba(12,47,49,.34)';
    ctx.beginPath();
    ctx.arc(this.cx + 8, this.cy + 10, R0, 0, 7);
    ctx.fill();
    ctx.fillStyle = K.t4;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R0, 0, 7);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R0, 0, 7);
    ctx.clip();
    ctx.beginPath();
    path(GRATICULE);
    ctx.strokeStyle = 'rgba(95,175,159,.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const land = this.zoom >= FINE_FROM && this.fine && !this.interacting && !this.velocity ? this.fine : this.land;
    if (land) {
      ctx.save();
      ctx.translate(3, 4);
      ctx.beginPath();
      path(land);
      ctx.fillStyle = 'rgba(20,63,66,.75)';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      path(land);
      ctx.fillStyle = K.cream;
      ctx.fill();
      ctx.strokeStyle = K.cream;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    if (!s) {
      ctx.restore();
      this.rim(R0);
      return false;
    }

    // Outside the zone: hatched paper with a round hole cut for the zone, then the stitched edge.
    if (s.zone.stage > 0) {
      const radius = R.zoneRadiusDeg(s.zone.stage);
      const zone = geoCircle().center(vecToLonLat(s.zone.center)).radius(radius).precision(1)();
      const outside = { type: 'Polygon' as const, coordinates: [zone.coordinates[0]!.slice().reverse()] };
      ctx.save();
      ctx.translate(5, 7);
      ctx.beginPath();
      path(outside);
      ctx.fillStyle = 'rgba(12,47,49,.3)';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      path(outside);
      ctx.globalAlpha = 0.66;
      ctx.fillStyle = this.hatch ?? K.t5;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
      ctx.setLineDash([9, 6]);
      ctx.save();
      ctx.translate(1.5, 2);
      ctx.beginPath();
      path(zone);
      ctx.strokeStyle = 'rgba(12,47,49,.45)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      path(zone);
      ctx.strokeStyle = K.coral;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Where each ship is now.
    const shipAt = s.ships.map((ship) => {
      const at = unitToLonLat(R.shipPosition(ship, t));
      const flying = ship.embarked && t < ship.arriveTs;
      if (flying) animating = true;
      return { ship, at, flying, to: vecToLonLat(ship.to) };
    });

    ctx.lineCap = 'round';
    for (const [i, a] of shipAt.entries()) {
      if (i === s.myShip || !a.flying || !a.ship.embarked) continue;
      ctx.beginPath();
      path({ type: 'LineString', coordinates: [a.at, a.to] });
      ctx.setLineDash([1, 7]);
      ctx.strokeStyle = 'rgba(246,241,227,.9)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const mine = s.myShip >= 0 ? shipAt[s.myShip] : undefined;
    if (mine && this.ownLL.length) {
      ctx.beginPath();
      path({ type: 'LineString', coordinates: [...this.ownLL, mine.flying ? vecToLonLat(mine.ship.from) : mine.at] });
      ctx.strokeStyle = 'rgba(242,115,78,.6)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    const dest = mine?.flying ? mine.to : s.proposal;
    if (dest) {
      if (mine) {
        ctx.beginPath();
        path({ type: 'LineString', coordinates: [mine.at, dest] });
        ctx.setLineDash([2, 8]);
        ctx.strokeStyle = K.coral;
        ctx.lineWidth = 3.4;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (vis(dest)) {
        const q = P(dest);
        drawCross(ctx, q[0] + 1.5, q[1] + 2, 8, 'rgba(12,47,49,.4)', 5);
        drawCross(ctx, q[0], q[1], 8, K.coral, 5);
      }
    }

    // Rival pins: closed flaps. Where, never what.
    const pinSize = mobile ? 6 : 7.5;
    const inZone = (ll: LonLat) =>
      s.zone.stage <= 0 || (geoDistance(ll, vecToLonLat(s.zone.center)) * 180) / Math.PI <= R.zoneRadiusDeg(s.zone.stage);
    for (const { pin, at } of this.pinLL) {
      if (pin.shipIndex === s.myShip || !vis(at)) continue;
      const q = P(at);
      ctx.globalAlpha = inZone(at) ? 1 : 0.55;
      ctx.fillStyle = 'rgba(12,47,49,.5)';
      ctx.beginPath();
      ctx.roundRect(q[0] - pinSize + 2, q[1] - pinSize + 3, 2 * pinSize, 2 * pinSize, 2.5);
      ctx.fill();
      ctx.fillStyle = K.cream;
      ctx.beginPath();
      ctx.roundRect(q[0] - pinSize, q[1] - pinSize, 2 * pinSize, 2 * pinSize, 2.5);
      ctx.fill();
      ctx.strokeStyle = K.t2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(q[0] - pinSize + 1.5, q[1] - pinSize + 3.5);
      ctx.lineTo(q[0] + pinSize - 1.5, q[1] - pinSize + 3.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Lead lines: the line drops from the gondola, the bob lands, a ring spreads.
    const nowMs = performance.now();
    this.drops = this.drops.filter((d) => nowMs - d.t0 < DROP_MS);
    for (const d of this.drops) {
      if (!vis(d.at)) continue;
      animating = true;
      const k = (nowMs - d.t0) / DROP_MS;
      const q = P(d.at);
      const top = q[1] - (d.mine ? 18 : 12);
      const fall = Math.min(1, k / 0.4);
      const y = top + (q[1] - top) * fall * fall;
      ctx.strokeStyle = 'rgba(43,43,43,.75)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(q[0], top);
      ctx.lineTo(q[0], y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = K.t6;
      ctx.beginPath();
      ctx.moveTo(q[0] - 4, y - 7);
      ctx.lineTo(q[0] + 4, y - 7);
      ctx.lineTo(q[0] + 2, y);
      ctx.lineTo(q[0] - 2, y);
      ctx.fill();
      if (k > 0.4) {
        const r = 4 + (k - 0.4) * (d.mine ? 48 : 30);
        ctx.globalAlpha = Math.max(0, 1 - (k - 0.4) / 0.6);
        ctx.strokeStyle = d.mine ? K.coral : K.cream;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(q[0], q[1], r, r * 0.55, 0, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    this.placeFlaps(ctx, vis, P, inZone, mobile);

    for (const [i, a] of shipAt.entries()) {
      if (i === s.myShip || !a.ship.embarked || !vis(a.at)) continue;
      const q = P(a.at);
      const h = a.flying ? this.heading(a.at, a.to) : [1, 0];
      drawShip(ctx, q[0], q[1] - 14, h[0]!, h[1]!, mobile ? 0.13 : 0.17, RIVAL);
    }
    if (mine && mine.ship.embarked && vis(mine.at)) {
      const q = P(mine.at);
      const h = dest ? this.heading(mine.at, dest) : [1, 0];
      ctx.strokeStyle = 'rgba(43,43,43,.6)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(q[0], q[1]);
      ctx.lineTo(q[0], q[1] - 14);
      ctx.stroke();
      ctx.fillStyle = K.t6;
      ctx.beginPath();
      ctx.arc(q[0], q[1], 3, 0, 7);
      ctx.fill();
      drawShip(ctx, q[0], q[1] - 30, h[0]!, h[1]!, mobile ? 0.22 : 0.27, OWN_SHIP);
    }

    if (s.revealed && vis(s.revealed)) {
      const q = P(s.revealed);
      const strike = geoCircle().center(s.revealed).radius((50 / 6371.0088) * (180 / Math.PI))();
      ctx.beginPath();
      path(strike);
      ctx.fillStyle = 'rgba(242,115,78,.35)';
      ctx.fill();
      drawStar(ctx, q[0] + 3, q[1] + 4, 17, 9, 10, 'rgba(12,47,49,.45)');
      drawStar(ctx, q[0], q[1], 17, 9, 10, K.coral);
      drawCross(ctx, q[0], q[1], 5, K.cream, 3);
    }

    ctx.restore();
    this.rim(R0);

    if (this.focused) {
      ctx.strokeStyle = K.cream;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, 11, 0, 7);
      ctx.moveTo(this.cx - 18, this.cy);
      ctx.lineTo(this.cx - 6, this.cy);
      ctx.moveTo(this.cx + 6, this.cy);
      ctx.lineTo(this.cx + 18, this.cy);
      ctx.moveTo(this.cx, this.cy - 18);
      ctx.lineTo(this.cx, this.cy - 6);
      ctx.moveTo(this.cx, this.cy + 6);
      ctx.lineTo(this.cx, this.cy + 18);
      ctx.stroke();
    }

    this.placeAnchors(vis, P);
    return animating;
  }

  private rim(R0: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R0, 0, 7);
    ctx.strokeStyle = 'rgba(12,47,49,.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private heading(from: LonLat, to: LonLat): [number, number] {
    const p = this.proj(from);
    const q = this.proj(geoInterpolate(from, to)(0.03));
    if (!p || !q) return [1, 0];
    return [q[0] - p[0], q[1] - p[1]];
  }

  /** Own flaps: positioned on their soundings, moved apart when they would overlap. */
  private placeFlaps(
    ctx: CanvasRenderingContext2D,
    vis: (ll: LonLat) => boolean,
    P: (ll: LonLat) => [number, number],
    inZone: (ll: LonLat) => boolean,
    mobile: boolean,
  ): void {
    const flaps = [...this.overlay.querySelectorAll<HTMLElement>('[data-flap]')];
    const fs = mobile ? 28 : 34;
    const items: { el: HTMLElement; key: string; q: [number, number]; at: LonLat; w: number }[] = [];
    for (const el of flaps) {
      const at: LonLat = [Number(el.dataset.lon), Number(el.dataset.lat)];
      if (!vis(at)) {
        el.style.visibility = 'hidden';
        continue;
      }
      const open = el.classList.contains('open');
      const w = open ? Math.max(fs, (el.dataset.band?.length ?? 4) * 7.4 + 12) : fs;
      items.push({ el, key: el.dataset.key ?? '', q: P(at), at, w });
    }
    // Newest soundings keep their spot; older ones move aside.
    items.sort((a, b) => Number(b.key) - Number(a.key));
    const R0 = this.radius * this.zoom;
    const placed = declutter(
      items.map((it) => ({ key: it.key, x: it.q[0], y: it.q[1], w: it.w, h: fs })),
      this.flapOffsets,
      (x, y) => Math.hypot(x - this.cx, y - this.cy) < R0 - fs * 0.6,
    );
    const offsets = new Map<string, [number, number]>();
    placed.forEach((p, i) => {
      const it = items[i]!;
      offsets.set(p.key, [p.x - it.q[0], p.y - it.q[1]]);
      if (p.moved) {
        ctx.strokeStyle = 'rgba(43,43,43,.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(it.q[0], it.q[1]);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.fillStyle = K.cream;
        ctx.beginPath();
        ctx.arc(it.q[0], it.q[1], 3, 0, 7);
        ctx.fill();
        ctx.strokeStyle = K.t6;
        ctx.stroke();
      }
      it.el.style.visibility = '';
      it.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
      it.el.classList.toggle('out', !inZone(it.at));
    });
    this.flapOffsets = offsets;
  }

  /** Course tag and tooltips hang from a point on the globe. */
  private placeAnchors(vis: (ll: LonLat) => boolean, P: (ll: LonLat) => [number, number]): void {
    for (const el of this.overlay.querySelectorAll<HTMLElement>('[data-anchor]')) {
      const at: LonLat = [Number(el.dataset.lon), Number(el.dataset.lat)];
      if (!vis(at)) {
        el.style.visibility = 'hidden';
        continue;
      }
      const q = P(at);
      const half = el.offsetWidth / 2;
      const x = Math.max(half + 12, Math.min(this.W - half - 12, q[0]));
      el.style.visibility = '';
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${q[1].toFixed(1)}px`;
      el.style.setProperty('--tx', `${(q[0] - x).toFixed(1)}px`);
    }
  }

  private viewChanged(): void {
    if (!this.cb.onView || this.viewTimer) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      this.cb.onView?.(this.centre(), this.zoom);
    }, 400);
  }

  private bind(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      c.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => c.removeEventListener(type, fn as EventListener, opts));
    };
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    on('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      this.velocity = null;
      this.tween = null;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom };
        this.drag = null;
        return;
      }
      const ll = this.proj.invert?.([p.x, p.y]);
      this.drag = {
        x: p.x, y: p.y, moved: false, q0: versor(this.rot),
        v0: cartesian(ll ? [ll[0], ll[1]] : [0, 0]),
        samples: [{ r: [...this.rot] as Rotation, t: performance.now() }],
      };
    });

    on('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = Math.max(MIN_Z, Math.min(MAX_Z, (this.pinch.z * d) / this.pinch.d));
        this.interacting = true;
        this.draw();
        return;
      }
      const drag = this.drag;
      if (!drag) return;
      if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) > 4) {
        drag.moved = true;
        this.interacting = true;
        c.classList.add('dragging');
      }
      if (!drag.moved) return;
      this.proj.rotate(versorRotation(drag.q0));
      const ll = this.proj.invert?.([p.x, p.y]);
      if (!ll) return;
      const v1 = cartesian([ll[0], ll[1]]);
      this.rot = rotationOf(multiply(drag.q0, delta(drag.v0, v1)));
      drag.samples.push({ r: [...this.rot] as Rotation, t: performance.now() });
      if (drag.samples.length > 6) drag.samples.shift();
      this.viewChanged();
      this.draw();
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      c.classList.remove('dragging');
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        this.interacting = false;
        this.draw();
        return;
      }
      const drag = this.drag;
      this.drag = null;
      this.interacting = false;
      if (!drag) return;
      if (drag.moved) {
        const s = drag.samples;
        const a = s[0]!;
        const b = s[s.length - 1]!;
        const dt = b.t - a.t;
        if (!this.reduceMotion && dt > 0 && performance.now() - b.t < 80) {
          const v: Rotation = [(b.r[0] - a.r[0]) / dt, (b.r[1] - a.r[1]) / dt, (b.r[2] - a.r[2]) / dt];
          if (Math.hypot(...v) > 0.01) this.velocity = v;
        }
        this.draw();
        return;
      }
      if (e.type === 'pointercancel') return;
      this.pick(local(e));
    };
    on('pointerup', end);
    on('pointercancel', end);

    on(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );

    on('keydown', (e) => {
      const step = 6 / this.zoom;
      const keys: Record<string, [number, number]> = {
        ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      };
      if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') this.zoomBy(0.8);
      else if (e.key === 'Enter' || e.key === ' ') this.cb.onPick(this.centre());
      else if (keys[e.key]) {
        const [dl, dp] = keys[e.key]!;
        this.rotateBy(dl, dp);
      } else return;
      e.preventDefault();
    });
    // Moving the window to a screen with another pixel ratio re-sizes the backing store.
    const watchDpr = () => {
      const m = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      const change = () => {
        this.resize();
        watchDpr();
      };
      m.addEventListener('change', change, { once: true });
      this.cleanup.push(() => m.removeEventListener('change', change));
    };
    watchDpr();

    on('focus', () => {
      this.focused = c.matches(':focus-visible');
      this.draw();
    });
    on('blur', () => {
      this.focused = false;
      this.draw();
    });
  }

  private pick(p: { x: number; y: number }): void {
    if (Math.hypot(p.x - this.cx, p.y - this.cy) > this.radius * this.zoom) return;
    const s = this.scene;
    const centre = this.centre();
    if (s) {
      for (const { pin, at } of this.pinLL) {
        if (pin.shipIndex === s.myShip || !this.visible(at, centre)) continue;
        const q = this.proj(at);
        if (q && Math.hypot(q[0] - p.x, q[1] - p.y) < 11) {
          this.cb.onPin(pin, at);
          return;
        }
      }
    }
    const ll = this.proj.invert?.([p.x, p.y]);
    if (ll) this.cb.onPick([ll[0], ll[1]]);
  }
}

function versorRotation(q: ReturnType<typeof versor>): Rotation {
  return rotationOf(q);
}
