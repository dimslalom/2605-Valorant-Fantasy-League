import cards from '../../../../src/data/cards.json';
import teamColors from '../data/teamColors.json';

// Team tag -> logo, from the card data. Teams without art (for example KC) get a
// monogram tile instead of a broken image.
const logos = {};
for (const c of cards) if (c.org && c.org_logo && !logos[c.org]) logos[c.org] = c.org_logo;

export const logoFor = tag => logos[tag] ?? null;
export const colorsFor = tag => teamColors[tag] ?? ['#6e778b'];
