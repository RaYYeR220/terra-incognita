const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function fmtInt(n: number): string {
  return intFmt.format(Math.round(n));
}

/** Distances are shown to the nearest 10 km: the bands are much coarser than that. */
export function fmtKm(km: number): string {
  return `${fmtInt(km < 100 ? Math.round(km) : Math.round(km / 10) * 10)} km`;
}

export function fmtSol(sol: number): string {
  if (sol >= 100) return `${fmtInt(sol)} SOL`;
  const digits = sol >= 10 ? 1 : sol >= 0.1 ? 2 : 3;
  return `${Number(sol.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits })} SOL`;
}

export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / 1e9;
}

/** m:ss, or h:mm:ss past an hour. */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function timeOfDay(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function shortHash(text: string, head = 4, tail = 4): string {
  return text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

export function latLonText(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(1)}°${lon < 0 ? 'W' : 'E'}`;
}
