export interface PaletteColor {
  /** '#RRGGBB', uppercase. */
  hex: string;
  /** Share of the image, 0..1; weights of a palette sum to ~1. */
  weight: number;
}

export interface Palette {
  /** Sorted by weight descending, 1..8 entries. */
  colors: PaletteColor[];
}

export type ColorRole = 'background' | 'foreground' | 'accent';
