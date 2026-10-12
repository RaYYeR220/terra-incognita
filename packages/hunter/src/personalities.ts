/** Tunable character of a hunter. Every bot runs the same solver with different numbers. */
export interface Personality {
  name: string;
  /** Number of sample points the belief holds. */
  samples: number;
  /** Number of those used to score one candidate probe. */
  evalSamples: number;
  /** Multiplier on how many candidate probes are considered per decision. */
  breadth: number;
  /**
   * How much a second of flying or waiting hurts, against a second of expected future search.
   * Values near 0 minimise the number of probes; larger values keep the ship to short hops.
   */
  timeWeight: number;
  /**
   * How much a second of flight that the next probe is expected to make necessary hurts. It is
   * what pulls the ship towards the region instead of sounding from afar.
   */
  approach: number;
  /** Bits of information a future probe is assumed to yield when estimating what is left to do. */
  bitsPerProbe: number;
  /** Bonus, in probes, for the chance that the next probe is a strike. */
  strikeBias: number;
  /**
   * Share of belief handed to a place where a rival keeps probing, relative to the hunter's own
   * belief: at 1 a fully convincing rival counts as much as everything the hunter knows.
   * 0 ignores rivals.
   */
  rivalWeight: number;
  /** Softmax temperature in seconds over candidate scores. 0 always takes the best candidate. */
  temperature: number;
  /** Number of most recent soundings taken into account. */
  memory: number;
  /** Rounds of local improvement applied to the chosen probe. */
  refine: number;
}

/** Methodical: flies wherever a probe tells the most, and so needs the fewest of them. */
export const SURVEYOR: Personality = {
  name: 'surveyor',
  samples: 2400,
  evalSamples: 1200,
  breadth: 1.25,
  timeWeight: 0.15,
  approach: 0.15,
  bitsPerProbe: 1.6,
  strikeBias: 0,
  rivalWeight: 0,
  temperature: 0,
  memory: Infinity,
  refine: 2,
};

/** Greedy: counts every second in the air, takes cheap nearby soundings and early strike shots. */
export const SPRINTER: Personality = {
  name: 'sprinter',
  samples: 1600,
  evalSamples: 800,
  breadth: 1,
  timeWeight: 2,
  approach: 2,
  bitsPerProbe: 1.6,
  strikeBias: 0.5,
  rivalWeight: 0,
  temperature: 0,
  memory: Infinity,
  refine: 1,
};

/** Opportunist: runs its own search but leans towards wherever rivals have started to circle. */
export const SHADOW: Personality = {
  name: 'shadow',
  samples: 2000,
  evalSamples: 1000,
  breadth: 1,
  timeWeight: 0.5,
  approach: 1,
  bitsPerProbe: 1.6,
  strikeBias: 0.25,
  rivalWeight: 0.75,
  temperature: 0,
  memory: Infinity,
  refine: 1,
};

/** Deliberately poor: remembers only its last three soundings and picks among options almost at random. */
export const WANDERER: Personality = {
  name: 'wanderer',
  samples: 600,
  evalSamples: 300,
  breadth: 0.5,
  timeWeight: 0.3,
  approach: 0.3,
  bitsPerProbe: 1.6,
  strikeBias: 0,
  rivalWeight: 0,
  temperature: 6,
  memory: 3,
  refine: 0,
};

export const PERSONALITIES = {
  surveyor: SURVEYOR,
  sprinter: SPRINTER,
  shadow: SHADOW,
  wanderer: WANDERER,
} as const;

export type PersonalityName = keyof typeof PERSONALITIES;
