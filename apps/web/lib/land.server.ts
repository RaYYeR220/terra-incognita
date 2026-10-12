import 'server-only';

import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import land110 from 'world-atlas/land-110m.json';

const topo = land110 as unknown as Topology<{ land: GeometryCollection }>;

/** Coastlines for drawing on the server: the SVG ships in the HTML, the data never does. */
export const LAND = feature(topo, topo.objects.land);
