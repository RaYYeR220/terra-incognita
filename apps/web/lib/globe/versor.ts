/**
 * Quaternion helpers for turning a globe so the point under the pointer stays under it,
 * whatever the rotation. After Mike Bostock's versor dragging.
 */
export type Quat = [number, number, number, number];
export type Cart = [number, number, number];
export type Rotation = [number, number, number];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function cartesian([lon, lat]: [number, number]): Cart {
  const l = lon * RAD;
  const p = lat * RAD;
  const c = Math.cos(p);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
}

export function versor([l, p, g]: Rotation): Quat {
  const a = (l * RAD) / 2;
  const b = (p * RAD) / 2;
  const c = (g * RAD) / 2;
  const sl = Math.sin(a), cl = Math.cos(a), sp = Math.sin(b), cp = Math.cos(b), sg = Math.sin(c), cg = Math.cos(c);
  return [
    cl * cp * cg + sl * sp * sg,
    sl * cp * cg - cl * sp * sg,
    cl * sp * cg + sl * cp * sg,
    cl * cp * sg - sl * sp * cg,
  ];
}

export function rotationOf([a, b, c, d]: Quat): Rotation {
  return [
    Math.atan2(2 * (a * b + c * d), 1 - 2 * (b * b + c * c)) * DEG,
    Math.asin(Math.max(-1, Math.min(1, 2 * (a * c - d * b)))) * DEG,
    Math.atan2(2 * (a * d + b * c), 1 - 2 * (c * c + d * d)) * DEG,
  ];
}

export function multiply([a1, b1, c1, d1]: Quat, [a2, b2, c2, d2]: Quat): Quat {
  return [
    a1 * a2 - b1 * b2 - c1 * c2 - d1 * d2,
    a1 * b2 + b1 * a2 + c1 * d2 - d1 * c2,
    a1 * c2 - b1 * d2 + c1 * a2 + d1 * b2,
    a1 * d2 + b1 * c2 - c1 * b2 + d1 * a2,
  ];
}

/** The rotation that takes direction v0 to direction v1. */
export function delta(v0: Cart, v1: Cart): Quat {
  const w: Cart = [v0[1] * v1[2] - v0[2] * v1[1], v0[2] * v1[0] - v0[0] * v1[2], v0[0] * v1[1] - v0[1] * v1[0]];
  const l = Math.hypot(w[0], w[1], w[2]);
  if (!l) return [1, 0, 0, 0];
  const t = Math.acos(Math.max(-1, Math.min(1, v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2]))) / 2;
  const s = Math.sin(t);
  return [Math.cos(t), (w[2] / l) * s, (-w[1] / l) * s, (w[0] / l) * s];
}
