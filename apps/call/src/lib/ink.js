// Text colour for a solid team-colour fill: whichever of near-black or white has the higher
// WCAG contrast against it. Non-hex input falls back to white.
const lum = hex => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const inkOn = hex => {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex ?? '')) return '#ffffff';
  const L = lum(hex);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#0b0d14' : '#ffffff';
};

// Everything the glass material needs for one colour: the fill, its ink, and a text shadow that
// lifts that ink (dark under light text, light under dark text), as CSS custom properties.
// Prefixed --glass so they never shadow the app's own --ink text token.
export const glassVars = hex => {
  const ink = inkOn(hex);
  return { '--glass': hex, '--glass-ink': ink, '--glass-shadow': ink === '#ffffff' ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.45)' };
};
