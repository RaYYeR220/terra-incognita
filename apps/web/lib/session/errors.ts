/** Program and simulator error codes, said the way a player would want to hear them. */
const MESSAGES: Record<string, string> = {
  InFlight: 'Your ship is still in the air.',
  Cooldown: 'The lead line is still drying.',
  ProbeLimit: 'All 64 soundings are used.',
  NotLive: 'The hunt is over.',
  NotEmbarked: 'Choose where your ship sets off first.',
  AlreadyEmbarked: 'Your ship is already at sea.',
  HuntFull: 'Every berth on this hunt is taken.',
  HuntClosed: 'This hunt no longer takes new ships.',
  DeadlinePassed: 'The clock has run out.',
  InvalidPosition: 'That point is not on the globe.',
  NotUnitVector: 'That point is not on the globe.',
};

export function explain(code: string): string {
  return MESSAGES[code] ?? 'That did not go through. Try again.';
}
