/** The paper colours, for drawing on canvas and in generated SVG. CSS reads the same values from globals.css. */
export const K = {
  cream: '#F6F1E3',
  kraft: '#E7DFC9',
  t1: '#CFE6DC',
  t2: '#9FCFC0',
  t3: '#5FAF9F',
  t4: '#2F7F78',
  t5: '#1B4F52',
  t6: '#0C2F31',
  coral: '#F2734E',
  coralD: '#D95C39',
  scorch: '#B8391F',
  peach: '#F6C59E',
  ink: '#2B2B2B',
  ray: '#C2DFD3',
  landShadow: '#143F42',
} as const;

/** Hard shadows: a cut shape casts a copy of itself, never a blur. */
export const SH = 'rgba(27,79,82,.26)';
export const SHD = 'rgba(14,51,54,.36)';
