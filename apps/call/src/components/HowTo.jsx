import cards from '../../../../src/data/cards.json';
import { BINGO, ECONOMY, TRACKED_MAX } from '../../../../src/engine/collect/rules';
import { assetPath, thumbnailSrc } from '../../../../src/lib/utils';
import { logoFor } from '../lib/orgs';

const virtyy = cards.find(card => card.id === 'loud-virtyy-gold-001');
const valyn = cards.find(card => card.id === 'g2-valyn-gold-001');

function Team({ tag }) {
  const logo = logoFor(tag);
  return <span className="guide-team">{logo && <img src={logo} alt="" />}<b>{tag}</b></span>;
}

function Player({ card }) {
  if (!card) return null;
  const image = thumbnailSrc(card);
  return <span className="guide-player">
    {image && <img src={assetPath(image)} alt="" />}
    <b>{card.player}</b>
  </span>;
}

export default function HowTo({ onDone }) {
  return <div className="guide">
    <section className="guide-row">
      <div className="guide-copy">
        <h3>Call a match</h3>
        <p>Before kickoff, pick a winner. Score and star are optional.</p>
      </div>
      <div className="guide-match" role="img" aria-label="Example call: LOUD selected over GE">
        <span className="guide-match-picked"><Team tag="LOUD" /><span aria-hidden="true">✓</span></span>
        <span className="guide-match-other"><Team tag="GE" /></span>
      </div>
    </section>

    <section className="guide-row">
      <div className="guide-copy">
        <h3>Track your ten</h3>
        <p>Open your two free packs to build a team. Only Tracked cards earn player points. Swap with Storage in Cards.</p>
      </div>
      <div className="guide-swap" role="img" aria-label={`Swap a player from Storage into your ${TRACKED_MAX} Tracked cards`}>
        <span><small>Tracked</small><Player card={virtyy} /></span>
        <span className="guide-swap-arrow" aria-hidden="true">←</span>
        <span><small>Storage</small><Player card={valyn} /></span>
      </div>
    </section>

    <section className="guide-row">
      <div className="guide-copy">
        <h3>Play bingo</h3>
        <p>Pick four events for the same Monday-to-Monday week. A match square can cover the week or name one match for more points. The first card is free; extra cards unlock after payout calibration and cost {BINGO.cardCost} CR.</p>
      </div>
      <div className="guide-bingo" role="img" aria-label="Example bingo card: four squares, the rare one worth 6 points">
        {[['3', 'An ace'], ['2', '25+ kills'], ['6', '30+ kills'], ['4', 'Yoru tops']].map(([pts, label]) => (
          <span key={label} data-rare={Number(pts) >= 5}><b>{pts}</b><small>{label}</small></span>
        ))}
      </div>
    </section>

    <section className="guide-row guide-row-last">
      <div className="guide-copy">
        <h3>Reveal &amp; collect</h3>
        <p>Reveal finished results to score your call and cards. Earn credits for packs.</p>
      </div>
      <div className="guide-reward" role="img" aria-label={`Points earn credits; ${ECONOMY.packCost} credits opens ${ECONOMY.packSize} cards`}>
        <span className="guide-reveal-pill">Reveal result <span aria-hidden="true">↗</span></span>
        <span className="guide-reward-pack"><img src="/assets/pack/OpVAL-Front.png" alt="" /><strong>{ECONOMY.packCost} <small>CR</small></strong><span>{ECONOMY.packSize} cards</span></span>
      </div>
    </section>

    <footer className="guide-footer"><button type="button" className="primary" onClick={onDone}>Got it</button></footer>
  </div>;
}
