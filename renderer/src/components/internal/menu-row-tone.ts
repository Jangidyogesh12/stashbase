/** The ink a popup row's label wears, shared by MenuItem and SelectItem.
 *  At rest it sits a step under full ink rather than muted: muted read as
 *  disabled, and full ink on every row, with its glyph and description beside
 *  it, made a dense menu heavy. Glyphs, descriptions and badges stay muted,
 *  so the label is the one thing a row says plainly; the highlighted or
 *  chosen row takes full ink. */
export function menuRowTone(lit: boolean): string {
  return lit ? 'text-foreground' : 'text-foreground/80';
}
