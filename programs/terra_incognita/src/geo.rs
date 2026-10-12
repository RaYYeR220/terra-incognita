//! Fixed-point geometry on the unit sphere.
//!
//! A point is a unit vector `[x, y, z]` scaled by `S = 1e9`. Distances are compared in
//! cosine space against literal tables, so nothing here needs trigonometry and every
//! result is reproducible bit for bit off-chain. The TypeScript package `core` implements
//! the same rules; `packages/core/vectors/geometry.json` is checked by the tests below.

use anchor_lang::prelude::Pubkey;
use solana_sha256_hasher::hashv;

pub type Vec3 = [i32; 3];

/// Coordinate scale.
pub const S: i64 = 1_000_000_000;
/// Scale of a dot product of two points.
pub const S2: i64 = S * S;
/// Accepted deviation of `x² + y² + z²` from `S²`.
pub const NORM_TOLERANCE: u64 = 4_000_000_000;

/// Mean Earth radius, 6371.0088 km, in units of 0.1 m.
pub const EARTH_RADIUS_E4_KM: u128 = 63_710_088;

/// Great-circle thresholds of the distance bands, in km.
pub const BAND_KM: [u32; 7] = [50, 150, 400, 1000, 2500, 5000, 10000];
/// `cos(BAND_KM[i] / R)` scaled by 1e18.
pub const BAND_COS_E18: [i64; 7] = [
    999969204208259243,
    999722849254785827,
    998029706561980356,
    987706889731782782,
    923992975612913888,
    707526037964013760,
    1186188794110208,
];
/// Band of a sounding within 50 km of the treasure.
pub const BAND_STRIKE: u8 = 0;

/// Number of shrinking stages of the public search zone. Stage 0 is the whole globe.
pub const ZONE_STAGES: u8 = 8;
/// Angular radius of the zone cap per stage, in degrees.
pub const ZONE_DEG: [u8; 8] = [90, 60, 40, 25, 15, 9, 5, 3];
/// `sin(ZONE_DEG[i])` scaled by 1e9.
pub const ZONE_SIN_E9: [i64; 8] = [
    1000000000, 866025404, 642787610, 422618262, 258819045, 156434465, 87155743, 52335956,
];
/// `cos(ZONE_DEG[i])` scaled by 1e18.
pub const ZONE_COS_E18: [i64; 8] = [
    0,
    500000000000000000,
    766044443118978080,
    906307787036649968,
    965925826289068300,
    987688340595137726,
    996194698091745532,
    998629534754573874,
];

const COMMITMENT_DOMAIN: &[u8] = b"terra-incognita:v1";
/// Digests tried when sampling a unit vector before falling back to the north pole.
const SAMPLE_ATTEMPTS: usize = 32;
/// Samples closer to the origin than 0.01 are rejected before normalisation.
const MIN_SAMPLE_R2: i128 = (S2 / 10_000) as i128;
const NORTH_POLE: Vec3 = [0, 0, S as i32];

/// Whether `v` lies on the unit sphere within the accepted tolerance.
pub fn is_unit(v: &Vec3) -> bool {
    let n2: u64 = v
        .iter()
        .map(|&c| {
            let c = c.unsigned_abs() as u64;
            c * c
        })
        .sum();
    n2.abs_diff(S2 as u64) <= NORM_TOLERANCE
}

/// Dot product of two points, scaled by 1e18. Equals the cosine of their angular distance.
///
/// Both inputs must be points (components within ±1.000000002e9), which keeps the sum far
/// from the i64 limits. The arithmetic wraps instead of checking for overflow: a checked
/// add branches on the signs of its operands, and `probe` must not spend compute that
/// depends on where the treasure lies.
pub fn dot(a: &Vec3, b: &Vec3) -> i64 {
    let term = |i: usize| (a[i] as i64).wrapping_mul(b[i] as i64);
    term(0).wrapping_add(term(1)).wrapping_add(term(2))
}

/// 1 when `a < b`, otherwise 0. Plain arithmetic, so the instructions executed do not
/// depend on the operands. Both must stay within ±4e18.
#[inline(always)]
pub fn lt(a: i64, b: i64) -> u64 {
    (a.wrapping_sub(b) as u64) >> 63
}

/// Distance band for a dot product: the number of thresholds the distance exceeds.
/// 0 is a strike, 7 is the far side of the globe. Every threshold is always evaluated.
pub fn band_for_dot(d: i64) -> u8 {
    let mut band = 0u64;
    for threshold in BAND_COS_E18 {
        band += lt(d, threshold);
    }
    band as u8
}

/// Distance band between two points.
pub fn band(a: &Vec3, b: &Vec3) -> u8 {
    band_for_dot(dot(a, b))
}

/// Floor of the square root.
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let bits = 128 - n.leading_zeros();
    let mut x = 1u128 << ((bits + 1) / 2);
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// Scales `v` to length `S`: each component is `c · S / isqrt(|v|²)` rounded half away
/// from zero. The zero vector maps to the north pole. Components are expected to be
/// around 1e18 so the floor in the square root is far below one output unit.
pub fn normalize(v: [i128; 3]) -> Vec3 {
    let n = isqrt(v.iter().map(|&c| c.unsigned_abs().pow(2)).sum());
    if n == 0 {
        return NORTH_POLE;
    }
    let mut out = [0i32; 3];
    for (o, &c) in out.iter_mut().zip(v.iter()) {
        let q = ((2 * c.unsigned_abs() * S as u128 + n) / (2 * n)) as i32;
        *o = if c < 0 { -q } else { q };
    }
    out
}

/// The point of the sphere a vector accepted by `is_unit` stands for. Player input is
/// stored in this form, so two spellings of one direction measure the same distance.
pub fn canonical(v: &Vec3) -> Vec3 {
    let s = S as i128;
    normalize([v[0] as i128 * s, v[1] as i128 * s, v[2] as i128 * s])
}

/// Maps a little-endian i32 onto `[-S, S)`: `v · S / 2³¹`, truncated toward zero.
fn coordinate(word: [u8; 4]) -> i128 {
    ((i32::from_le_bytes(word) as i64 * S) / 2_147_483_648) as i128
}

/// Uniformly distributed unit vector derived from a 32-byte digest.
///
/// The first twelve bytes give a point of the cube `[-S, S)³`. It is kept when its squared
/// length is in `(1e14, 1e18]` and then normalised; otherwise the digest is replaced by its
/// own sha256 and the next attempt is made.
pub fn unit_vector(digest: &[u8; 32]) -> Vec3 {
    let mut d = *digest;
    for _ in 0..SAMPLE_ATTEMPTS {
        let x = coordinate([d[0], d[1], d[2], d[3]]);
        let y = coordinate([d[4], d[5], d[6], d[7]]);
        let z = coordinate([d[8], d[9], d[10], d[11]]);
        let r2 = x * x + y * y + z * z;
        if r2 > MIN_SAMPLE_R2 && r2 <= S2 as i128 {
            let s = S as i128;
            return normalize([x * s, y * s, z * s]);
        }
        d = hashv(&[&d]).to_bytes();
    }
    NORTH_POLE
}

/// Centre of the public zone cap for a stage. Stage 0 has no cap and yields the zero vector.
///
/// The treasure is deflected by a pseudo-random vector slightly shorter than the sine of
/// the cap radius, which can turn it by less than that radius: the cap always contains it.
pub fn zone_center(treasure: &Vec3, zone_seed: &[u8; 32], stage: u8) -> Vec3 {
    if stage == 0 || stage > ZONE_STAGES {
        return [0, 0, 0];
    }
    let u = unit_vector(&hashv(&[zone_seed, &[stage]]).to_bytes());
    let reach = (ZONE_SIN_E9[stage as usize - 1] * 999 / 1000) as i128;
    let s = S as i128;
    normalize([
        treasure[0] as i128 * s + reach * u[0] as i128,
        treasure[1] as i128 * s + reach * u[1] as i128,
        treasure[2] as i128 * s + reach * u[2] as i128,
    ])
}

/// Zone stage the clock asks for: one stage per interval after the start, at most eight.
pub fn zone_stage_at(now: i64, starts_at: i64, interval_secs: u32) -> u8 {
    if interval_secs == 0 || now <= starts_at {
        return 0;
    }
    ((now - starts_at) as u64 / interval_secs as u64).min(ZONE_STAGES as u64) as u8
}

/// Whether `point` lies inside the zone cap of `stage` centred on `center`.
pub fn in_zone(point: &Vec3, center: &Vec3, stage: u8) -> bool {
    stage == 0 || dot(point, center) >= ZONE_COS_E18[stage as usize - 1]
}

/// Straight-line distance on the unit sphere for a dot product, scaled by 1e9.
pub fn chord_e9(d: i64) -> u64 {
    isqrt(2 * (S2 - d).max(0) as u128) as u64
}

/// Whole seconds an airship needs to travel between two points, at least one.
pub fn travel_secs(a: &Vec3, b: &Vec3, speed_kms: u32) -> i64 {
    let km_e13 = chord_e9(dot(a, b)) as u128 * EARTH_RADIUS_E4_KM;
    let per_sec_e13 = 10_000_000_000_000u128 * speed_kms.max(1) as u128;
    km_e13.div_ceil(per_sec_e13).max(1) as i64
}

/// Commitment to a treasure location, published before play starts.
pub fn commitment(hunt: &Pubkey, location: &Vec3, salt: &[u8; 32]) -> [u8; 32] {
    hashv(&[
        COMMITMENT_DOMAIN,
        hunt.as_ref(),
        &location[0].to_le_bytes(),
        &location[1].to_le_bytes(),
        &location[2].to_le_bytes(),
        salt,
    ])
    .to_bytes()
}

/// Location, salt and zone seed derived from one VRF output.
pub fn derive_secrets(randomness: &[u8; 32]) -> (Vec3, [u8; 32], [u8; 32]) {
    let location = unit_vector(&hashv(&[randomness, b"loc"]).to_bytes());
    let salt = hashv(&[randomness, b"salt"]).to_bytes();
    let zone_seed = hashv(&[randomness, b"zone"]).to_bytes();
    (location, salt, zone_seed)
}

/// Zone seed of an author-placed treasure, bound to its salt.
pub fn author_zone_seed(salt: &[u8; 32]) -> [u8; 32] {
    hashv(&[salt, b"zone"]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    const R_KM: f64 = 6371.0088;
    const VECTORS: &str = include_str!("../../../packages/core/vectors/geometry.json");

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vectors {
        format: String,
        version: u32,
        scale: i64,
        speed_kms: u32,
        hunt: String,
        thresholds: Vec<String>,
        bands: Vec<BandCase>,
        pairs: Vec<PairCase>,
        travel: Vec<TravelCase>,
        units: Vec<UnitCase>,
        randomness: Vec<RandomnessCase>,
        zones: Vec<ZoneCase>,
    }

    #[derive(Deserialize)]
    struct BandCase {
        dot: String,
        band: u8,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PairCase {
        a: Vec3,
        b: Vec3,
        dot: String,
        band: u8,
        chord_e9: u64,
        travel_secs: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TravelCase {
        a: Vec3,
        b: Vec3,
        speed_kms: u32,
        travel_secs: i64,
    }

    #[derive(Deserialize)]
    struct UnitCase {
        digest: String,
        vector: Vec3,
        rehashes: u32,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RandomnessCase {
        randomness: String,
        location: Vec3,
        salt: String,
        zone_seed: String,
        commitment: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ZoneCase {
        location: Vec3,
        zone_seed: String,
        stage: u8,
        center: Vec3,
        dot: String,
    }

    fn vectors() -> Vectors {
        let vectors: Vectors = serde_json::from_str(VECTORS).expect("geometry.json parses");
        assert_eq!(vectors.format, "terra-incognita/geometry");
        assert_eq!(vectors.version, 1);
        assert_eq!(vectors.scale, S);
        vectors
    }

    fn hex32(text: &str) -> [u8; 32] {
        assert_eq!(text.len(), 64, "expected 32 bytes of hex");
        let mut out = [0u8; 32];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&text[2 * i..2 * i + 2], 16).expect("hex digit");
        }
        out
    }

    fn int(text: &str) -> i64 {
        text.parse().expect("decimal integer")
    }

    /// Number of digests rejected before `unit_vector` accepts one.
    fn rehashes(digest: &[u8; 32]) -> u32 {
        let mut d = *digest;
        for round in 0..SAMPLE_ATTEMPTS as u32 {
            let [x, y, z] = [0, 4, 8].map(|o| coordinate([d[o], d[o + 1], d[o + 2], d[o + 3]]));
            let r2 = x * x + y * y + z * z;
            if r2 > MIN_SAMPLE_R2 && r2 <= S2 as i128 {
                return round;
            }
            d = hashv(&[&d]).to_bytes();
        }
        SAMPLE_ATTEMPTS as u32
    }

    fn from_lat_lon(lat_deg: f64, lon_deg: f64) -> Vec3 {
        let (lat, lon) = (lat_deg.to_radians(), lon_deg.to_radians());
        let s = S as f64;
        [
            (lat.cos() * lon.cos() * s).round() as i32,
            (lat.cos() * lon.sin() * s).round() as i32,
            (lat.sin() * s).round() as i32,
        ]
    }

    /// Point `km` away from `(0°, 0°)` along the equator.
    fn east_of_origin(km: f64) -> Vec3 {
        from_lat_lon(0.0, (km / R_KM).to_degrees())
    }

    fn seed(i: u32, tag: &[u8]) -> [u8; 32] {
        hashv(&[&i.to_le_bytes(), tag]).to_bytes()
    }

    #[test]
    fn reference_thresholds() {
        let vectors = vectors();
        let thresholds: Vec<i64> = vectors.thresholds.iter().map(|t| int(t)).collect();
        assert_eq!(thresholds, BAND_COS_E18);
    }

    #[test]
    fn reference_bands() {
        let vectors = vectors();
        assert!(vectors.bands.len() >= 7 * 3);
        for case in &vectors.bands {
            assert_eq!(band_for_dot(int(&case.dot)), case.band, "dot {}", case.dot);
        }
    }

    #[test]
    fn reference_pairs() {
        let vectors = vectors();
        assert!(vectors.pairs.len() >= 200);
        for (i, case) in vectors.pairs.iter().enumerate() {
            let d = dot(&case.a, &case.b);
            assert_eq!(d, int(&case.dot), "pair {i} dot");
            assert_eq!(dot(&case.b, &case.a), d, "pair {i} symmetry");
            assert_eq!(band(&case.a, &case.b), case.band, "pair {i} band");
            assert_eq!(chord_e9(d), case.chord_e9, "pair {i} chord");
            assert_eq!(
                travel_secs(&case.a, &case.b, vectors.speed_kms),
                case.travel_secs,
                "pair {i} travel"
            );
        }
    }

    #[test]
    fn reference_travel() {
        let vectors = vectors();
        assert!(!vectors.travel.is_empty());
        for (i, case) in vectors.travel.iter().enumerate() {
            assert_eq!(
                travel_secs(&case.a, &case.b, case.speed_kms),
                case.travel_secs,
                "travel {i} at {} km/s",
                case.speed_kms
            );
        }
    }

    #[test]
    fn reference_unit_vectors() {
        let vectors = vectors();
        assert!(vectors.units.len() >= 32);
        let mut rejected = 0;
        for case in &vectors.units {
            let digest = hex32(&case.digest);
            assert_eq!(unit_vector(&digest), case.vector, "digest {}", case.digest);
            assert_eq!(rehashes(&digest), case.rehashes, "digest {}", case.digest);
            assert!(is_unit(&case.vector));
            rejected += case.rehashes;
        }
        assert!(rejected > 0, "the vectors exercise the rejection path");
    }

    #[test]
    fn reference_randomness() {
        let vectors = vectors();
        let hunt = Pubkey::new_from_array(hex32(&vectors.hunt));
        assert!(vectors.randomness.len() >= 32);
        for case in &vectors.randomness {
            let (location, salt, zone_seed) = derive_secrets(&hex32(&case.randomness));
            assert_eq!(location, case.location, "randomness {}", case.randomness);
            assert_eq!(salt, hex32(&case.salt));
            assert_eq!(zone_seed, hex32(&case.zone_seed));
            assert_eq!(commitment(&hunt, &location, &salt), hex32(&case.commitment));
        }
    }

    #[test]
    fn reference_zones() {
        let vectors = vectors();
        assert!(vectors.zones.len() >= 8 * 16);
        let mut stages = [0u32; ZONE_STAGES as usize + 1];
        for (i, case) in vectors.zones.iter().enumerate() {
            let center = zone_center(&case.location, &hex32(&case.zone_seed), case.stage);
            assert_eq!(center, case.center, "zone {i} stage {}", case.stage);
            assert_eq!(dot(&case.location, &center), int(&case.dot), "zone {i} dot");
            assert!(in_zone(&case.location, &center, case.stage), "zone {i}");
            stages[case.stage as usize] += 1;
        }
        assert!(stages[1..].iter().all(|&count| count > 0), "every stage is covered");
    }

    #[test]
    fn tables_match_the_geometry() {
        for (i, &km) in BAND_KM.iter().enumerate() {
            let expected = (km as f64 / R_KM).cos() * 1e18;
            assert!((BAND_COS_E18[i] as f64 - expected).abs() < 1e4, "band {i}");
        }
        for (i, &deg) in ZONE_DEG.iter().enumerate() {
            let rad = (deg as f64).to_radians();
            assert!((ZONE_SIN_E9[i] as f64 - rad.sin() * 1e9).abs() < 1.0, "sin {i}");
            assert!((ZONE_COS_E18[i] as f64 - rad.cos() * 1e18).abs() < 1e4, "cos {i}");
        }
    }

    #[test]
    fn isqrt_is_the_floor_root() {
        for n in [0u128, 1, 2, 3, 4, 15, 16, 17, 99, 100, 1 << 64, u64::MAX as u128] {
            let r = isqrt(n);
            assert!(r * r <= n && (r + 1) * (r + 1) > n, "n = {n}");
        }
        assert_eq!(isqrt(4_000_000_000_000_000_000), 2_000_000_000);
        let big = 12_000_000_000_000_000_000_000_000_000_000_000_000u128;
        let r = isqrt(big);
        assert!(r * r <= big && (r + 1) * (r + 1) > big);
    }

    #[test]
    fn normalize_rounds_half_away_from_zero() {
        assert_eq!(normalize([0, 0, 0]), NORTH_POLE);
        assert_eq!(normalize([0, 0, -5]), [0, 0, -(S as i32)]);
        assert_eq!(normalize([3, 0, 4]), [600_000_000, 0, 800_000_000]);
        assert_eq!(normalize([-3, 0, -4]), [-600_000_000, 0, -800_000_000]);
        // 1 / isqrt(2 · 10²⁴) · 1e9 · 10¹² = 707 106 781.19 rounds down, on both signs.
        let e12 = 1_000_000_000_000i128;
        assert_eq!(normalize([e12, -e12, 0]), [707_106_781, -707_106_781, 0]);
    }

    #[test]
    fn canonical_form_removes_the_length_slack() {
        let target = from_lat_lon(10.0, 20.0);
        let exact = [600_000_000, 0, 800_000_000];
        let long = [600_000_001, 0, 800_000_001];
        let short = [599_999_999, 0, 799_999_999];
        for v in [exact, long, short] {
            assert!(is_unit(&v));
        }
        // Raw, the longer spelling of the same direction scores a larger dot product.
        assert!(dot(&long, &target) > dot(&exact, &target));
        assert!(dot(&short, &target) < dot(&exact, &target));
        assert_eq!(canonical(&exact), exact);
        assert_eq!(canonical(&long), exact);
        assert_eq!(canonical(&short), exact);
        assert_eq!(dot(&canonical(&long), &target), dot(&exact, &target));
        assert_eq!(dot(&canonical(&short), &target), dot(&exact, &target));
        assert_eq!(band(&canonical(&long), &target), band(&exact, &target));

        for i in 0..2_000u32 {
            let v = unit_vector(&seed(i, b"canonical"));
            let c = canonical(&v);
            assert!(is_unit(&c));
            assert_eq!(canonical(&c), c, "canonical form is stable");
            assert!(v.iter().zip(c.iter()).all(|(a, b)| (a - b).abs() <= 1));
        }
    }

    #[test]
    fn norm_validation() {
        assert!(is_unit(&[S as i32, 0, 0]));
        assert!(is_unit(&[0, 0, -(S as i32)]));
        assert!(is_unit(&from_lat_lon(48.8566, 2.3522)));
        assert!(is_unit(&from_lat_lon(-33.8688, 151.2093)));
        // |n² − S²| is about 2·S·δ for a radial error δ, so the tolerance is two units.
        assert!(is_unit(&[S as i32 + 1, 0, 0]));
        assert!(is_unit(&[S as i32 - 2, 0, 0]));
        assert!(!is_unit(&[S as i32 + 2, 0, 0]));
        assert!(!is_unit(&[S as i32 - 3, 0, 0]));
        assert!(!is_unit(&[0, 0, 0]));
        assert!(!is_unit(&[S as i32, S as i32, 0]));
        assert!(!is_unit(&[i32::MAX, i32::MAX, i32::MAX]));
        assert!(!is_unit(&[i32::MIN, i32::MIN, i32::MIN]));
    }

    #[test]
    fn band_boundaries() {
        let origin = from_lat_lon(0.0, 0.0);
        assert_eq!(band(&origin, &origin), BAND_STRIKE);
        for (i, &km) in BAND_KM.iter().enumerate() {
            let inside = east_of_origin(km as f64 - 0.1);
            let outside = east_of_origin(km as f64 + 0.1);
            assert_eq!(band(&origin, &inside), i as u8, "just inside {km} km");
            assert_eq!(band(&origin, &outside), i as u8 + 1, "just outside {km} km");
        }
        assert_eq!(band(&origin, &from_lat_lon(0.0, 180.0)), 7);
        // A quarter turn is 10 007.5 km.
        assert_eq!(band(&origin, &from_lat_lon(90.0, 0.0)), 7);
        assert_eq!(band(&origin, &from_lat_lon(89.0, 0.0)), 6);
    }

    #[test]
    fn band_thresholds_are_exclusive_below() {
        for (i, &threshold) in BAND_COS_E18.iter().enumerate() {
            assert_eq!(band_for_dot(threshold), i as u8);
            assert_eq!(band_for_dot(threshold - 1), i as u8 + 1);
        }
        assert_eq!(band_for_dot(S2), 0);
        assert_eq!(band_for_dot(S2 + NORM_TOLERANCE as i64), 0);
        assert_eq!(band_for_dot(-S2), 7);
        assert_eq!(band_for_dot(-S2 - NORM_TOLERANCE as i64), 7);
    }

    #[test]
    fn branch_free_comparison() {
        let cases = [
            (0, 0, 0),
            (0, 1, 1),
            (1, 0, 0),
            (-1, 0, 1),
            (-2 * S2, -S2, 1),
            (S2, -2 * S2, 0),
            (-2 * S2, S2 + 4_000_000_000, 1),
        ];
        for (a, b, expected) in cases {
            assert_eq!(lt(a, b), expected, "{a} < {b}");
        }
    }

    #[test]
    fn band_is_symmetric_and_rotation_independent() {
        let paris = from_lat_lon(48.8566, 2.3522);
        let london = from_lat_lon(51.5074, -0.1278);
        let tokyo = from_lat_lon(35.6762, 139.6503);
        // Paris–London is about 344 km, Paris–Tokyo about 9 700 km.
        assert_eq!(band(&paris, &london), 2);
        assert_eq!(band(&london, &paris), 2);
        assert_eq!(band(&paris, &tokyo), 6);
        assert_eq!(band(&tokyo, &paris), 6);
    }

    #[test]
    fn random_unit_vectors_are_valid_and_uniform() {
        const N: i64 = 20_000;
        let mut sum = [0i64; 3];
        let mut sum_sq = [0f64; 3];
        let mut octants = [0u32; 8];
        for i in 0..N as u32 {
            let v = unit_vector(&seed(i, b"uniform"));
            assert!(is_unit(&v), "sample {i} is off the sphere");
            let mut octant = 0;
            for axis in 0..3 {
                sum[axis] += v[axis] as i64;
                sum_sq[axis] += (v[axis] as f64 / S as f64).powi(2);
                if v[axis] < 0 {
                    octant |= 1 << axis;
                }
            }
            octants[octant] += 1;
        }
        for axis in 0..3 {
            let mean = sum[axis] as f64 / N as f64 / S as f64;
            assert!(mean.abs() < 0.02, "axis {axis} mean {mean}");
            let second_moment = sum_sq[axis] / N as f64;
            assert!((second_moment - 1.0 / 3.0).abs() < 0.01, "axis {axis}");
        }
        for (i, &count) in octants.iter().enumerate() {
            let share = count as f64 / N as f64;
            assert!((share - 0.125).abs() < 0.012, "octant {i} share {share}");
        }
    }

    #[test]
    fn unit_vector_reference_values() {
        // The first reference digest and its result, spelled out.
        let digest = hex32("3b04bdf57b73924582ba4b3c377293ba4ce2842977d1d066f1609330dfd54612");
        assert_eq!(unit_vector(&digest), [-110775665, 751038058, 650899830]);
        // The all-ones digest decodes to −1 on every axis, which truncates to the origin and
        // is rejected as too short: the result comes from the rehashed digest.
        let corner = [0xffu8; 32];
        assert_eq!(coordinate([0xff; 4]), 0);
        assert_eq!(coordinate(i32::MIN.to_le_bytes()), -(S as i128));
        assert_eq!(coordinate(i32::MAX.to_le_bytes()), S as i128 - 1);
        assert_eq!(rehashes(&corner), rehashes(&hashv(&[&corner]).to_bytes()) + 1);
        assert_eq!(unit_vector(&corner), unit_vector(&hashv(&[&corner]).to_bytes()));
    }

    #[test]
    fn zone_cap_always_contains_the_treasure() {
        for i in 0..10_000u32 {
            let treasure = unit_vector(&seed(i, b"treasure"));
            let zone_seed = seed(i, b"zone");
            for stage in 1..=ZONE_STAGES {
                let center = zone_center(&treasure, &zone_seed, stage);
                assert!(is_unit(&center), "case {i} stage {stage}");
                assert!(
                    dot(&treasure, &center) >= ZONE_COS_E18[stage as usize - 1],
                    "case {i} stage {stage} leaves the treasure outside"
                );
                assert!(in_zone(&treasure, &center, stage));
            }
        }
    }

    #[test]
    fn zone_centers_do_not_sit_on_the_treasure() {
        for i in 0..1_000u32 {
            let treasure = unit_vector(&seed(i, b"treasure"));
            let center = zone_center(&treasure, &seed(i, b"zone"), ZONE_STAGES);
            assert_ne!(center, treasure);
            assert!(!in_zone(&[-treasure[0], -treasure[1], -treasure[2]], &center, 1));
            assert_eq!(zone_center(&treasure, &seed(i, b"zone"), 0), [0, 0, 0]);
        }
    }

    #[test]
    fn zone_stage_follows_the_clock() {
        assert_eq!(zone_stage_at(99, 100, 10), 0);
        assert_eq!(zone_stage_at(100, 100, 10), 0);
        assert_eq!(zone_stage_at(109, 100, 10), 0);
        assert_eq!(zone_stage_at(110, 100, 10), 1);
        assert_eq!(zone_stage_at(179, 100, 10), 7);
        assert_eq!(zone_stage_at(180, 100, 10), 8);
        assert_eq!(zone_stage_at(1_000_000, 100, 10), 8);
        assert_eq!(zone_stage_at(1_000_000, 100, 0), 0);
    }

    #[test]
    fn travel_time() {
        let origin = from_lat_lon(0.0, 0.0);
        let antipode = from_lat_lon(0.0, 180.0);
        let pole = from_lat_lon(90.0, 0.0);
        assert_eq!(chord_e9(dot(&origin, &origin)), 0);
        assert_eq!(chord_e9(dot(&origin, &antipode)), 2 * S as u64);
        assert_eq!(chord_e9(S2 + 5), 0);
        assert_eq!(travel_secs(&origin, &origin, 800), 1);
        // Diameter 12 742.0176 km at 800 km/s.
        assert_eq!(travel_secs(&origin, &antipode, 800), 16);
        // Quarter turn: chord 9 009.97 km.
        assert_eq!(travel_secs(&origin, &pole, 800), 12);
        assert_eq!(travel_secs(&origin, &pole, 9_010), 1);
        assert_eq!(travel_secs(&origin, &pole, 9_009), 2);
        assert_eq!(travel_secs(&origin, &antipode, 1), 12_743);
        assert_eq!(travel_secs(&origin, &antipode, u32::MAX), 1);
        // 800 km hop takes exactly one second, 801 km takes two.
        assert_eq!(travel_secs(&origin, &east_of_origin(799.0), 800), 1);
        assert_eq!(travel_secs(&origin, &east_of_origin(801.0), 800), 2);
    }

    #[test]
    fn commitment_binds_every_input() {
        let hunt = Pubkey::new_from_array([7u8; 32]);
        let other_hunt = Pubkey::new_from_array([8u8; 32]);
        let location = from_lat_lon(12.5, -45.25);
        let salt = [9u8; 32];
        let base = commitment(&hunt, &location, &salt);
        assert_eq!(base, commitment(&hunt, &location, &salt));
        assert_ne!(base, commitment(&other_hunt, &location, &salt));
        assert_ne!(base, commitment(&hunt, &from_lat_lon(12.5, -45.26), &salt));
        assert_ne!(base, commitment(&hunt, &location, &[10u8; 32]));

        let mut preimage = b"terra-incognita:v1".to_vec();
        preimage.extend_from_slice(hunt.as_ref());
        for c in location {
            preimage.extend_from_slice(&c.to_le_bytes());
        }
        preimage.extend_from_slice(&salt);
        assert_eq!(preimage.len(), 94);
        assert_eq!(base, hashv(&[&preimage]).to_bytes());
    }
}
