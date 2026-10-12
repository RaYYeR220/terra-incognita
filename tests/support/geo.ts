import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

// Independent re-implementation of the on-chain geometry, used to audit what the program wrote.

export type Vec3 = [number, number, number];

export const S = 1_000_000_000n;
export const EARTH_RADIUS_KM = 6371.0088;

export const BAND_COS_E18 = [
  999969204208259243n,
  999722849254785827n,
  998029706561980356n,
  987706889731782782n,
  923992975612913888n,
  707526037964013760n,
  1186188794110208n,
];

export const ZONE_SIN_E9 = [
  1000000000n,
  866025404n,
  642787610n,
  422618262n,
  258819045n,
  156434465n,
  87155743n,
  52335956n,
];

export const ZONE_COS_E18 = [
  0n,
  500000000000000000n,
  766044443118978080n,
  906307787036649968n,
  965925826289068300n,
  987688340595137726n,
  996194698091745532n,
  998629534754573874n,
];

export function fromLatLon(latDeg: number, lonDeg: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const s = Number(S);
  return [
    Math.round(Math.cos(lat) * Math.cos(lon) * s),
    Math.round(Math.cos(lat) * Math.sin(lon) * s),
    Math.round(Math.sin(lat) * s),
  ];
}

export function dot(a: Vec3, b: Vec3): bigint {
  return (
    BigInt(a[0]) * BigInt(b[0]) +
    BigInt(a[1]) * BigInt(b[1]) +
    BigInt(a[2]) * BigInt(b[2])
  );
}

export function bandForDot(d: bigint): number {
  return BAND_COS_E18.filter((threshold) => d < threshold).length;
}

export function band(a: Vec3, b: Vec3): number {
  return bandForDot(dot(a, b));
}

export function distanceKm(a: Vec3, b: Vec3): number {
  const cos = Number(dot(a, b)) / 1e18;
  return Math.acos(Math.max(-1, Math.min(1, cos))) * EARTH_RADIUS_KM;
}

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function normalize(v: [bigint, bigint, bigint]): Vec3 {
  const n = isqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (n === 0n) return [0, 0, Number(S)];
  return v.map((c) => {
    const abs = c < 0n ? -c : c;
    const q = Number((2n * abs * S + n) / (2n * n));
    return c < 0n ? -q : q;
  }) as Vec3;
}

/** The form in which the program stores a vector supplied by a player. */
export function canonical(v: Vec3): Vec3 {
  return normalize([BigInt(v[0]) * S, BigInt(v[1]) * S, BigInt(v[2]) * S]);
}

const sha256 = (...parts: Uint8Array[]): Buffer => {
  const hash = createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest();
};

function coordinate(digest: Buffer, offset: number): bigint {
  return (BigInt(digest.readInt32LE(offset)) * S) / 2_147_483_648n;
}

export function unitVector(seed: Uint8Array): Vec3 {
  let digest: Buffer = Buffer.from(seed);
  for (let round = 0; round < 32; round++) {
    const [x, y, z] = [coordinate(digest, 0), coordinate(digest, 4), coordinate(digest, 8)];
    const r2 = x * x + y * y + z * z;
    if (r2 > (S * S) / 10_000n && r2 <= S * S) return normalize([x * S, y * S, z * S]);
    digest = sha256(digest);
  }
  return [0, 0, Number(S)];
}

export function zoneCenter(treasure: Vec3, zoneSeed: Uint8Array, stage: number): Vec3 {
  if (stage === 0) return [0, 0, 0];
  const u = unitVector(sha256(zoneSeed, Uint8Array.of(stage)));
  const reach = (ZONE_SIN_E9[stage - 1] * 999n) / 1000n;
  return normalize(
    treasure.map((c, i) => BigInt(c) * S + reach * BigInt(u[i])) as [bigint, bigint, bigint],
  );
}

export function zoneStageAt(now: number, startsAt: number, intervalSecs: number): number {
  if (intervalSecs <= 0 || now <= startsAt) return 0;
  return Math.min(8, Math.floor((now - startsAt) / intervalSecs));
}

export function travelSecs(a: Vec3, b: Vec3, speedKms: number): number {
  const gap = S * S - dot(a, b);
  const chord = isqrt(2n * (gap > 0n ? gap : 0n));
  const num = chord * 63_710_088n;
  const den = 10_000_000_000_000n * BigInt(Math.max(1, speedKms));
  const secs = (num + den - 1n) / den;
  return Number(secs > 1n ? secs : 1n);
}

function i32le(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
}

export function commitment(hunt: PublicKey, location: Vec3, salt: Uint8Array): Buffer {
  return sha256(
    Buffer.from("terra-incognita:v1"),
    hunt.toBuffer(),
    i32le(location[0]),
    i32le(location[1]),
    i32le(location[2]),
    salt,
  );
}

export function secretsFromEntropy(entropy: Uint8Array): {
  location: Vec3;
  salt: Buffer;
  zoneSeed: Buffer;
} {
  return {
    location: unitVector(sha256(entropy, Buffer.from("loc"))),
    salt: sha256(entropy, Buffer.from("salt")),
    zoneSeed: sha256(entropy, Buffer.from("zone")),
  };
}

export function authorZoneSeed(salt: Uint8Array): Buffer {
  return sha256(salt, Buffer.from("zone"));
}
