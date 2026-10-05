import cards from '../../../../src/data/cards.json';
import teamColors from '../data/teamColors.json';

// Team tag -> logo, from the card data. Teams without art (for example KC) get a
// monogram tile instead of a broken image.
const logos = {};
for (const c of cards) if (c.org && c.org_logo && !logos[c.org]) logos[c.org] = c.org_logo;

export const logoFor = tag => logos[tag] ?? null;
export const colorsFor = tag => teamColors[tag] ?? ['#6e778b'];

// Roster sources name teams in full ("100 THIEVES", "Natus Vincere"), so match them on a loose key
// against the cards' org names and tags, plus a few names the cards spell differently.
const loose = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/esports?|gaming|team|club/g, '').replace(/[^a-z0-9]/g, '');
const byName = { drx: '/assets/orgs/drx.png', geng: '/assets/orgs/geng.png', giantx: '/assets/orgs/gmx.png', sentinels: '/assets/orgs/sentinels.png' };
for (const c of cards) if (c.org_logo) for (const k of [c.org, c.org_name]) if (k && !byName[loose(k)]) byName[loose(k)] = c.org_logo;
export const logoForName = name => byName[loose(name)] ?? null;
