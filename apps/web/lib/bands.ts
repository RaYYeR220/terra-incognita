import { BAND_KM, BAND_NAMES } from '@terra-incognita/core';
import type { Band, BandName } from '@terra-incognita/core';

import { fmtInt } from './format';

export const BANDS = BAND_NAMES.map((name, band) => ({ band: band as Band, name })) as readonly {
  band: Band;
  name: BandName;
}[];

/** Coldest first, as the scale is drawn. */
export const BANDS_COLD_TO_HOT = [...BANDS].reverse();

export function bandName(band: Band): BandName {
  return BAND_NAMES[band];
}

/** Distance range a band stands for, from the program's own table. */
export function bandRange(band: Band): string {
  if (band === 0) return `within ${BAND_KM[0]} km`;
  if (band === 7) return `over ${fmtInt(BAND_KM[6])} km`;
  return `${fmtInt(BAND_KM[band - 1] as number)}–${fmtInt(BAND_KM[band] as number)} km`;
}

/** The band a distance falls in, for illustrations only. Real bands come from the enclave. */
export function bandForKm(km: number): Band {
  const i = BAND_KM.findIndex((limit) => km <= limit);
  return (i < 0 ? 7 : i) as Band;
}
