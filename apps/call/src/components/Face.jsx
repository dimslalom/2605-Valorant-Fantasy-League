import CardThumb from './CardThumb';
import { colorsFor, logoForName, tagForName } from '../lib/orgs';
import { cardFor } from '../lib/rosterCards';

export function Crest({ name, size = 28 }) {
  const logo = logoForName(name);
  return logo
    ? <img className="crest" src={logo} alt="" style={{ width: size, height: size }} />
    : <span className="crest crest-mono" aria-hidden="true" style={{ width: size, height: size }}>{tagForName(name) ?? String(name ?? '?').slice(0, 3)}</span>;
}

// A player's card at `scale`, or (no card yet) a card-shaped tile in their team's colours with its crest.
// `to` pins the crest of the team they move to on the card's corner.
export function Face({ player, team, card, to, scale = 0.26, onClick, children, state }) {
  const c = card ?? cardFor(player, team);
  const body = c ? <CardThumb card={c} scale={scale} />
    : <span className="pface-blank" style={{ width: 400 * scale, height: 580 * scale, fontSize: Math.max(10, 64 * scale), '--team': colorsFor(tagForName(to ?? team))[0] }}>
      <Crest name={to ?? team} size={Math.round(170 * scale)} /><b>{player}</b>
    </span>;
  const Tag = onClick ? 'button' : 'span';
  return <Tag type={onClick ? 'button' : undefined} className="pface" data-state={state} onClick={onClick} aria-label={onClick ? player : undefined}>
    {body}
    {to && <span className="pface-crest"><Crest name={to} size={Math.round(120 * scale)} /></span>}
    {children}
  </Tag>;
}
