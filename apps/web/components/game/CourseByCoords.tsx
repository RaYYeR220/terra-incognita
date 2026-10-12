'use client';

import { useEffect, useId, useState } from 'react';

import type { LonLat } from '@/lib/geo';

import s from './game.module.css';

/** Parses "lat, lon" in decimal degrees, with optional N/S/E/W. */
export function parseLatLon(text: string): LonLat | null {
  const parts = text.trim().replace(/°/g, ' ').split(/[,;\s]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const read = (raw: string, pos: string, neg: string) => {
    const m = /^([+-]?\d+(?:\.\d+)?)([a-z])?$/i.exec(raw);
    if (!m) return NaN;
    const n = Number(m[1]);
    const h = m[2]?.toUpperCase();
    if (h && h !== pos && h !== neg) return NaN;
    return h === neg ? -Math.abs(n) : n;
  };
  const lat = read(parts[0]!, 'N', 'S');
  const lon = read(parts[1]!, 'E', 'W');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

/** Precise navigation: type a position and it becomes the proposed course, to confirm as usual. */
export function CourseByCoords({ initial, hint, onPlot }: { initial: string | null; hint: string; onPlot: (at: LonLat) => void }) {
  const id = useId();
  const [text, setText] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial) setText(initial);
  }, [initial]);
  return (
    <form
      className={s.hint}
      data-reserve=""
      data-testid="course-by-coords"
      onSubmit={(e) => {
        e.preventDefault();
        const at = parseLatLon(text);
        if (!at) {
          setError('Use latitude, longitude, e.g. -41.3, 60.5');
          return;
        }
        setError(null);
        onPlot(at);
      }}
    >
      <p>{hint}</p>
      <label htmlFor={id} className={s.coordsLabel}>Set course by coordinates</label>
      <span className={s.coordsRow}>
        <input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="lat, lon" inputMode="decimal" autoComplete="off" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} />
        <button type="submit">Plot</button>
      </span>
      {error ? <span id={`${id}-e`} className={s.coordsError} role="alert">{error}</span> : null}
    </form>
  );
}
