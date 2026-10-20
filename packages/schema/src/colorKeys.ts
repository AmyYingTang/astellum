import { z } from 'zod';

/**
 * The closed palette of feature color keys. Defined here (next to the palette
 * it drives) rather than in index.ts so taxonomy.ts can map onto it without a
 * circular import through index.ts.
 */
export const ColorKey = z.enum([
  // Hot stars / ionizing sources
  'hot', // bright stars, WR, OB
  'star', // generic star/cluster
  // Whole emission body (distinct from the 'front' feature color)
  'emission', // emission nebula / HII region body
  // Front matter
  'front', // ionization front
  'shock', // shock wave (SNR)
  'shell', // bubble shell
  // Inner structure
  'cavity', // central cavity
  'pillar', // pillar / evaporating gas
  // Surroundings
  'dark', // dark cloud / dust band
  'bg', // untouched background / molecular cloud
  // Comet
  'comet', // comet coma
  'ion', // ion tail (blue)
]);
export type ColorKey = z.infer<typeof ColorKey>;

export interface PaletteEntry {
  stroke: string;
  badge: string;
}

/**
 * The color keys map to a consistent palette across all renderings.
 * Defined here once, consumed by renderer (and later viewer).
 */
export const COLOR_PALETTE: Record<ColorKey, PaletteEntry> = {
  hot: { stroke: '#ffd84a', badge: '#ffd84a' }, // gold
  star: { stroke: '#ffb84a', badge: '#ffb84a' }, // orange
  emission: { stroke: '#ff5277', badge: '#ff5277' }, // rose-red (Hα body)
  front: { stroke: '#ff8a65', badge: '#ff8a65' }, // coral
  shock: { stroke: '#4ec3e0', badge: '#4ec3e0' }, // cyan
  shell: { stroke: '#c5cbdb', badge: '#c5cbdb' }, // light grey
  cavity: { stroke: '#d3d3e8', badge: '#d3d3e8' }, // pale lavender
  pillar: { stroke: '#bb9af7', badge: '#bb9af7' }, // purple
  dark: { stroke: '#9aa5b8', badge: '#9aa5b8' }, // grey
  bg: { stroke: '#7dcfa6', badge: '#7dcfa6' }, // mint
  comet: { stroke: '#5ee0c0', badge: '#5ee0c0' }, // green (coma)
  ion: { stroke: '#5b8cff', badge: '#5b8cff' }, // blue (ion tail)
};
