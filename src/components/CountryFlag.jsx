import { countryName } from '../lib/utils';

// flag-icons ships a sprite per ISO-3166-1 alpha-2 code. Anything outside that
// set (UN, WA and friends in the card data) has no flag to draw, so it falls
// back to a neutral block rather than a broken sprite.
const ALLOWED_COUNTRIES = new Set('AE AR AT AU BA BE BG BM BR BY CA CH CL CN CO CR CZ DE DK DO EC EE EG ES EU FI FR GB GT HK HR HU ID IE IN IT JO JP KG KH KR KW KZ LA LB LT LV LY MA MD MK MN MX MY NL NO PE PH PL PR PS PT RO RS RU SA SE SG SI SK SY TH TN TR TW UA US UY VE VN'.split(' '));

/**
 * A real flag image, not an emoji.
 *
 * The emoji version this replaces rendered a TEXT GLYPH, so the width/height
 * every caller passes sized an empty box while the glyph sat on the text
 * baseline at whatever font-size it inherited - which is why flags looked
 * mis-scaled and mis-positioned. It also degraded to two letters on Windows,
 * where flag emoji are not drawn at all.
 */
export default function CountryFlag({ code, className = '', decorative = true, style }) {
  const normalized = String(code ?? '').toUpperCase();
  const known = /^[A-Z]{2}$/.test(normalized) && ALLOWED_COUNTRIES.has(normalized);
  const classes = [known ? `fi fi-${normalized.toLowerCase()}` : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      style={known ? style : { ...style, background: 'var(--surface-hi)' }}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : countryName(normalized)}
    />
  );
}
