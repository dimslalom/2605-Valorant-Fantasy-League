import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'motion/react';
import { TACTICS } from '../engine/endless/seriesCards.js';
import useCardTilt from '../lib/useCardTilt.js';
import useMediaQuery from '../lib/useMediaQuery.js';
import { DUR, EASE, STAGGER } from '../lib/motion.js';
import { playUiSound } from '../lib/gameAudio.js';
import { assetPath } from '../lib/utils.js';
import SquadDock from './SquadDock.jsx';
import styles from './SeriesCardTable.module.css';

const ROLE_MARK = { Duelist: 'DLT', Initiator: 'INI', Controller: 'CTL', Sentinel: 'SEN' };
const NARROW = '(max-width: 820px)';
const CARD_RATIO = 580 / 400;
const PREVIEW_GAP = 10;
const PREVIEW_MARGIN = 8;

// Shared physical object for every non-player card: the supplied 400×580
// silhouette, three parallax planes, spring tilt, and a drag that snaps home.
//
// Every card is authored twice. The full face carries the whole panel
// hierarchy and needs ~170px to read; the small face carries only what
// identifies the card and scales its type in container units, so it stays
// legible down to the 64px live-cast rail. A small card is never a shrunken
// full card — pointing at one raises the full face in a portal instead.
function TableCard(props) {
  const {
    className = '', seed, label, clickable = false, onClick, style,
    background, subject, information,
    smallSubject = null, smallInformation = null,
    small = false, previewWidth = 230,
    faceDown = false, back = null, isPreview = false, ...attributes
  } = props;
  const {
    tiltRef, onPointerMove, onPointerEnter, onPointerDown, onPointerUp,
    onPointerLeave, onFocus, onBlur,
  } = useCardTilt({ seed, disabled: isPreview });
  const buttonRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const previewable = small && !isPreview;

  const closePreview = useCallback(() => setPreview(null), []);

  // Resolved to final viewport pixels here rather than a CSS translate:
  // Motion writes `transform` inline while it animates, which would wipe a
  // translate(-50%,-100%) out mid-flight and hang the card off its own
  // top-left corner. Clamped on both axes so it is always fully on screen.
  const openPreview = useCallback(() => {
    const node = buttonRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const width = previewWidth;
    const height = width * CARD_RATIO;
    const clamp = (value, max) => Math.max(PREVIEW_MARGIN, Math.min(value, Math.max(PREVIEW_MARGIN, max)));
    const above = rect.top - PREVIEW_GAP - height > PREVIEW_MARGIN;
    setPreview({
      left: clamp(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - PREVIEW_MARGIN),
      top: clamp(
        above ? rect.top - PREVIEW_GAP - height : rect.bottom + PREVIEW_GAP,
        window.innerHeight - height - PREVIEW_MARGIN,
      ),
      above,
    });
  }, [previewWidth]);

  // The preview is anchored to a viewport rect, so anything that moves the
  // card underneath it dismisses rather than drifts. Touch has no pointerleave
  // it can trust, so a press anywhere else dismisses instead.
  useEffect(() => {
    if (!preview) return undefined;
    const dismiss = () => setPreview(null);
    const onKey = (event) => { if (event.key === 'Escape') dismiss(); };
    const onOutside = (event) => {
      if (!buttonRef.current?.contains(event.target)) dismiss();
    };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside, true);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside, true);
    };
  }, [preview]);

  // On a small card the first press shows the full face and the second one
  // commits, which is the only affordance touch gets in place of hover.
  const activate = () => {
    if (previewable && !preview) { openPreview(); return; }
    if (!clickable) { closePreview(); return; }
    playUiSound('select');
    closePreview();
    onClick?.();
  };

  return (
    <>
      <m.button
        ref={buttonRef}
        type="button"
        className={[styles.cardObject, className].join(' ')}
        style={{ ...style, '--card-mask': `url(${assetPath('/assets/card-mask.svg')})` }}
        aria-label={label}
        aria-disabled={!clickable}
        tabIndex={clickable && !isPreview ? 0 : -1}
        aria-hidden={isPreview || undefined}
        data-small={small ? 'true' : undefined}
        data-preview={isPreview ? 'true' : undefined}
        onClick={activate}
        drag={!isPreview}
        dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
        dragElastic={0.2}
        dragMomentum={false}
        whileDrag={{ zIndex: 80 }}
        onDragStart={() => { closePreview(); playUiSound('lift'); }}
        onDragEnd={() => playUiSound('drop')}
        onPointerMove={onPointerMove}
        onPointerEnter={(event) => {
          onPointerEnter(event);
          playUiSound('hover');
          if (previewable && event.pointerType === 'mouse') openPreview();
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={(event) => {
          onPointerLeave(event);
          // Touch fires pointerleave on release, which would close the
          // preview the first tap just opened.
          if (event.pointerType === 'mouse') closePreview();
        }}
        onFocus={(event) => { onFocus(event); if (previewable) openPreview(); }}
        onBlur={(event) => { onBlur(event); closePreview(); }}
        {...attributes}
      >
        <span className={styles.cardShadow} aria-hidden="true" />
        <span ref={tiltRef} className={styles.cardTilt}>
          <span className={styles.cardFlip} data-face-down={faceDown ? 'true' : undefined}>
            <span className={styles.cardFace} data-face="front" aria-hidden={faceDown}>
              <span className={styles.cardMask}>
                <span className={styles.cardPlane} data-plane="background">{background}</span>
                <span className={styles.cardPlane} data-plane="subject">{small ? smallSubject : subject}</span>
                <span className={styles.cardPlane} data-plane="information">{small ? smallInformation : information}</span>
                <span className={styles.cardGlare} aria-hidden="true" />
                <CardBorder />
              </span>
            </span>
            <span className={styles.cardFace} data-face="back" aria-hidden={!faceDown}>
              <span className={styles.cardMask}>
                <span className={styles.cardPlane} data-plane="background">{back}</span>
                <CardBorder />
              </span>
            </span>
          </span>
        </span>
      </m.button>
      {preview && typeof document !== 'undefined' && createPortal(
        <m.div
          className={styles.cardPreview}
          data-place={preview.above ? 'above' : 'below'}
          style={{
            left: preview.left,
            top: preview.top,
            width: previewWidth,
            transformOrigin: preview.above ? 'center bottom' : 'center top',
          }}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: DUR.hover, ease: EASE.out }}
        >
          <TableCard {...props} small={false} isPreview clickable={false} />
        </m.div>,
        document.body,
      )}
    </>
  );
}

function CardBorder() {
  return (
    <svg className={styles.cardBorder} viewBox="0 0 400 580" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 41L200 2L398 41V539L200 578L2 539Z" />
    </svg>
  );
}

function OpponentShelf({ opponent, activeIds = [] }) {
  if (!opponent?.roster?.length) return null;
  return (
    <div className={styles.opponentShelf}>
      <SquadDock
        roster={opponent.roster}
        size={5}
        starterCount={5}
        iglId={opponent.iglId}
        squadName={opponent.name}
        locked
        activeIds={activeIds}
      />
    </div>
  );
}

// Small map face carries the place, its letter and the live rule; mastery
// pips and role marks stay on the full face.
export function MapCard({ card, owner = null, selectable = false, onPick, mastery = 0, compact = false }) {
  const ownerMark = owner === 'player' ? '★' : '◆';
  return (
    <TableCard
      className={styles.mapCard}
      seed={`map-${card.id}-${card.year}`}
      label={`${card.name}: ${card.label}`}
      clickable={selectable}
      onClick={() => onPick?.(card)}
      small={compact}
      previewWidth={186}
      data-owner={owner ?? undefined}
      data-selectable={selectable ? 'true' : undefined}
      style={{ '--map-hue': card.hue, '--card-edge': card.hue }}
      background={<span className={styles.mapPhoto}><img src={assetPath(card.image)} alt="" draggable={false} /></span>}
      subject={<span className={styles.mapGeometry} aria-hidden="true"><i /><i /><i /></span>}
      information={(
        <span className={styles.mapInformation}>
          <span className={styles.mapName}>{card.name}</span>
          <span className={styles.ruleSticker} data-changed={card.changed ? 'true' : undefined}>
            <b>{card.label}</b>
            <span className={styles.roleRun}>{card.roles.map(role => <i key={role}><em>{ROLE_MARK[role]}</em></i>)}</span>
          </span>
          <span className={styles.mastery} aria-label={`${mastery} map mastery`}>
            {Array.from({ length: 6 }, (_, index) => <i key={index} data-on={index < mastery ? 'true' : undefined} />)}
          </span>
          {owner && <span className={styles.ownerStamp} aria-hidden="true">{ownerMark}</span>}
        </span>
      )}
      smallInformation={(
        <span className={styles.mapSmallInformation}>
          <span className={styles.mapSmallName}>{card.name}</span>
          <span className={styles.mapSmallRule} data-changed={card.changed ? 'true' : undefined}><em>{card.label}</em></span>
          {owner && <span className={styles.ownerStampSmall} aria-hidden="true">{ownerMark}</span>}
        </span>
      )}
    />
  );
}

export function MapDealTable({ maps, playerPick, opponentPick, selectableIds, onPick, mastery, opponent }) {
  return (
    <section className={styles.table} data-phase="maps">
      <OpponentShelf opponent={opponent} />
      <div className={styles.mapFan}>
        {maps.map((card, index) => (
          <m.div key={card.id} className={styles.dealtMap} initial={{ opacity: 0, y: -80, rotate: (index - maps.length / 2) * 4 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: DUR.enter, ease: EASE.out, delay: index * STAGGER }}>
            <MapCard card={card} owner={playerPick === card.id ? 'player' : opponentPick === card.id ? 'opponent' : null} selectable={selectableIds.has(card.id)} onPick={onPick} mastery={mastery?.[card.name] ?? 0} />
          </m.div>
        ))}
      </div>
    </section>
  );
}

// Small tactic face carries name and rule; the tag becomes the edge colour
// rather than a label that cannot fit.
export function TacticCard({ instance, selected = false, disabled = false, onPlay, compact = false, replace = false, hidden = false }) {
  const tactic = TACTICS[instance?.key];
  if (!tactic) return null;
  return (
    <TableCard
      className={styles.tacticCard}
      seed={`tactic-${instance.uid}`}
      label={hidden ? 'Opponent tactic face down' : `${tactic.name}: ${tactic.rule}`}
      clickable={!disabled && !hidden}
      onClick={() => onPlay?.(instance)}
      small={compact}
      previewWidth={150}
      data-tier={tactic.tier}
      data-tag={tactic.tag}
      data-selected={selected ? 'true' : undefined}
      data-replace={replace ? 'true' : undefined}
      data-hidden={hidden ? 'true' : undefined}
      faceDown={hidden}
      back={<span className={styles.tacticBack}><i /><b>⌁</b><i /></span>}
      background={<span className={styles.tacticMaterial} />}
      subject={<span className={styles.tacticCut} aria-hidden="true"><i /><i /><i /></span>}
      information={(
        <span className={styles.tacticInformation}>
          <span className={styles.tacticTag}>{tactic.tag}</span>
          <b className={styles.tacticName}>{tactic.name}</b>
          <span className={styles.tacticRule}>{tactic.rule}</span>
          <span className={styles.tacticSource} data-source={instance.source}>{instance.source === 'igl' ? '⌁' : '✦'}</span>
        </span>
      )}
      smallSubject={<span className={styles.tacticSmallBand} aria-hidden="true" />}
      smallInformation={(
        <span className={styles.tacticSmallInformation}>
          <b className={styles.tacticSmallName}>{tactic.name}</b>
          <span className={styles.tacticSmallRule}>{tactic.rule}</span>
        </span>
      )}
    />
  );
}

export function TacticTable({ map, hand, opponentHand = [], opponent, opponentActiveIds = [], onPlay, reveal }) {
  const enemyCards = opponentHand.length ? opponentHand : (reveal?.opponent ? [reveal.opponent] : []);
  // The arena squeezes cards to ~105px below 820px, which is small-face
  // territory; the full face is one press away.
  const narrow = useMediaQuery(NARROW);
  return (
    <section className={styles.table} data-phase="tactics">
      <OpponentShelf opponent={opponent} activeIds={opponentActiveIds} />
      <div className={styles.activeMap}><MapCard card={map} compact /></div>
      <div className={styles.tacticArena} data-reveal={reveal ? 'true' : undefined}>
        <AnimatePresence mode="popLayout">
          {reveal ? (
            <m.div key={reveal.player.uid} className={styles.selectedTactic} layout initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
              <TacticCard instance={reveal.player} selected disabled compact={narrow} />
            </m.div>
          ) : (
            <m.div key="player-hand" className={styles.tacticHand} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {hand.map((card, index) => (
                <m.div key={card.uid} className={styles.handCard} initial={{ opacity: 0, y: 50, rotate: (index - hand.length / 2) * 2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: DUR.enter, ease: EASE.out, delay: index * STAGGER }}><TacticCard instance={card} onPlay={onPlay} compact={narrow} /></m.div>
              ))}
            </m.div>
          )}
        </AnimatePresence>
        <m.span className={styles.clashMark} data-edge={reveal?.edge} animate={{ opacity: reveal ? 1 : 0, scale: reveal ? 1 : .75 }}>×</m.span>
        <div className={styles.enemyTacticHand}>
          <AnimatePresence mode="popLayout">
            {enemyCards.map((card, index) => {
              const chosen = reveal?.opponent?.uid === card.uid;
              if (reveal && !chosen) return null;
              return (
                <m.div key={card.uid} layout initial={{ opacity: 0, y: -45, rotate: index ? 3 : -3 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, y: -35, scale: .85 }} transition={{ duration: DUR.enter, ease: EASE.out }}>
                  <TacticCard instance={card} selected={chosen} disabled hidden={!reveal} compact={narrow} />
                </m.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function RewardPack({ kind, mark, onChoose }) {
  return (
    <TableCard
      className={styles.rewardPack}
      seed={`reward-${kind}`}
      label={`${kind} pack`}
      clickable
      onClick={() => onChoose(kind)}
      data-kind={kind}
      background={<span className={styles.rewardMaterial} />}
      subject={<span className={styles.packBurst}>{mark}</span>}
      information={<span className={styles.rewardInformation}><b>{kind}</b><i>+</i></span>}
    />
  );
}

export function RewardTable({ step, tacticOffers, tacticHand, onChoosePack, onChooseTactic, pendingTactic, onReplace }) {
  return (
    <section className={styles.table} data-phase="reward">
      {step === 'packs' && <div className={styles.rewardPair}><RewardPack kind="player" mark="★" onChoose={onChoosePack} /><RewardPack kind="tactic" mark="⌁" onChoose={onChoosePack} /></div>}
      {step === 'tactics' && <div className={styles.rewardTactics}>{tacticOffers.map(card => <TacticCard key={card.uid} instance={card} selected={pendingTactic?.uid === card.uid} onPlay={onChooseTactic} />)}</div>}
      {step === 'replace' && <div className={styles.replaceTable}><TacticCard instance={pendingTactic} selected disabled /><span className={styles.replaceArrow}>→</span><div className={styles.replaceHand}>{tacticHand.map(card => <TacticCard key={card.uid} instance={card} compact replace onPlay={onReplace} />)}</div></div>}
    </section>
  );
}

export function MapPatchTable({ cards }) {
  if (!cards?.length) return null;
  return (
    <section className={styles.patchTable} aria-label="Map rule changes">
      <div className={styles.patchCards}>{cards.map((card, index) => <m.div key={card.id} initial={{ opacity: 0, y: -30, rotate: index - 1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: DUR.enter, ease: EASE.out, delay: index * STAGGER }}><MapCard card={card} compact /></m.div>)}</div>
    </section>
  );
}
