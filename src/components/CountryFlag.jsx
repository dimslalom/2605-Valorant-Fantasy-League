import { countryName } from '../lib/utils';

const ALLOWED_COUNTRIES = new Set('AE AR AT AU BA BE BG BM BR BY CA CH CL CN CO CR CZ DE DK DO EC EE EG EN ES EU FI FR GB GT HK HR HU ID IE IN IT JO JP KG KH KR KW KZ LA LB LT LV LY MA MD MK MN MX MY NL NO PE PH PL PR PS PT RO RS RU SA SE SG SI SK SY TH TN TR TW UA UN US UY VE VN WA'.split(' '));

function flagGlyph(code) {
  if (!/^[A-Z]{2}$/.test(code) || !ALLOWED_COUNTRIES.has(code)) return '🌐';
  return String.fromCodePoint(...code.split('').map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

export default function CountryFlag({ code, className = '', decorative = true, style }) {
  const normalized = String(code ?? '').toUpperCase();
  return (
    <span
      className={className}
      style={style}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : countryName(normalized)}
    >
      {flagGlyph(normalized)}
    </span>
  );
}
