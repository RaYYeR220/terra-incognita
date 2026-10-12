/** Fixed-point scale of a unit-vector component. */
export const SCALE = 1_000_000_000;
export const SCALE_N = 1_000_000_000n;

/** Scale of a dot product of two unit vectors (SCALE squared). */
export const UNIT_E18 = 1_000_000_000_000_000_000n;

/** A vector is accepted as a unit vector when |x² + y² + z² − 1e18| is at most this. */
export const UNIT_TOLERANCE = 4_000_000_000n;

export const EARTH_RADIUS_KM = 6371.0088;
/** Earth radius in units of 0.1 m, so travel time stays in integers. */
export const EARTH_RADIUS_E4 = 63_710_088n;

/** Outer great-circle radius of bands 0..6 in km. Band 7 is everything beyond the last entry. */
export const BAND_KM = [50, 150, 400, 1000, 2500, 5000, 10000] as const;

/** cos(BAND_KM[i] / EARTH_RADIUS_KM) scaled by 1e18. */
export const BAND_COS_E18 = [
  999969204208259243n,
  999722849254785827n,
  998029706561980356n,
  987706889731782782n,
  923992975612913888n,
  707526037964013760n,
  1186188794110208n,
] as const;

export const BAND_NAMES = [
  'strike',
  'scorching',
  'hot',
  'warm',
  'mild',
  'cool',
  'cold',
  'frozen',
] as const;

export const BAND_COUNT = 8;
export const STRIKE_BAND = 0;
export const STRIKE_RADIUS_KM = 50;

/** Number of shrinking stages of the public zone. Stage 0 is the whole globe. */
export const ZONE_STAGES = 8;

/** Angular radius of the zone cap for stages 1..8, in degrees. */
export const ZONE_DEG = [90, 60, 40, 25, 15, 9, 5, 3] as const;

/** sin(ZONE_DEG[i]) scaled by 1e9. */
export const ZONE_SIN_E9 = [
  1000000000, 866025404, 642787610, 422618262, 258819045, 156434465, 87155743, 52335956,
] as const;

/** cos(ZONE_DEG[i]) scaled by 1e18. */
export const ZONE_COS_E18 = [
  0n,
  500000000000000000n,
  766044443118978080n,
  906307787036649968n,
  965925826289068300n,
  987688340595137726n,
  996194698091745532n,
  998629534754573874n,
] as const;

/** The cap centre is displaced by sin(radius) · 999/1000 so rounding can never push the treasure out. */
export const ZONE_MARGIN_NUM = 999n;
export const ZONE_MARGIN_DEN = 1000n;

export const MAX_PROBES = 64;
export const PROBE_COOLDOWN_SECS = 3;
export const MAX_PLAYERS = 64;
export const PIN_RING_SIZE = 128;
export const DEFAULT_SPEED_KMS = 800;
export const MIN_TRAVEL_SECS = 1;
export const MAX_CREATOR_BPS = 2000;
export const MAX_TITLE_BYTES = 48;
export const MAX_CLUE_BYTES = 200;

/** Digests tried when rejection-sampling a unit vector before falling back to the north pole. */
export const UNIT_SAMPLE_ATTEMPTS = 32;
/** Lower bound (exclusive) on the squared length of an accepted sample: 0.0001 · 1e18. */
export const UNIT_SAMPLE_MIN_R2 = 100_000_000_000_000n;

export const COMMITMENT_DOMAIN = 'terra-incognita:v1';
export const LOCATION_TAG = 'loc';
export const SALT_TAG = 'salt';
export const ZONE_TAG = 'zone';
