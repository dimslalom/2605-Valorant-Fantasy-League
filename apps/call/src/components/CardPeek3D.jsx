import { useEffect, useRef } from 'react';
import CardThumb from './CardThumb';

export default function CardPeek3D({ card, scale, up, hasNext, controllerRef }) {
  const root = useRef(null);
  const host = useRef(null);
  const front = useRef(null);
  const back = useRef(null);
  const scene = useRef(null);
  const revealed = useRef(up);

  useEffect(() => {
    revealed.current = up;
    scene.current?.reveal(up);
  }, [up]);

  useEffect(() => {
    let cancelled = false;
    let currentPeek = [0, 1];
    const surface = root.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fallback = () => {
      surface.dataset.renderer = 'fallback';
      scene.current?.dispose();
      scene.current = null;
    };
    const controls = {
      peek(progress, side) {
        currentPeek = [progress, side];
        scene.current?.peek(progress, side);
        // A real two-sided rigid turn remains available without WebGL.
        surface.style.setProperty('--peek-angle', `${-side * progress * 115}deg`);
      },
    };
    controllerRef.current = controls;
    // Keep the normal card usable while the optional renderer and textures load.
    import('../lib/cardScene3D').then(async ({ captureCard, createCardScene }) => {
      if (cancelled) return;
      const [faceTexture, backTexture] = await Promise.all([captureCard(front.current), captureCard(back.current)]);
      if (cancelled) return;
      scene.current = createCardScene(host.current, faceTexture, backTexture, reduced, fallback, hasNext);
      scene.current.reveal(revealed.current);
      if (!revealed.current) scene.current.peek(...currentPeek);
      surface.dataset.renderer = 'webgl';
    }).catch(error => {
      if (!cancelled) {
        fallback();
        console.warn('3D card unavailable; using the two-sided card.', error);
      }
    });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
      if (controllerRef.current === controls) controllerRef.current = null;
    };
  }, [card, controllerRef, hasNext]);

  return (
    <div ref={root} className="pk-surface" data-up={up}>
      <div className="pk-rigid" aria-hidden={!up}>
        <div className="pk-face"><CardThumb card={card} scale={scale} /></div>
        <div className="pk-back"><div className="pk-back-art"><span className="pk-back-seal">VCT</span></div></div>
      </div>
      <div ref={host} className="pk-webgl" aria-hidden="true" />
      <div className="pk-textures" aria-hidden="true" inert>
        <div ref={front} className="pk-texture"><CardThumb card={card} scale={1} /></div>
        <div ref={back} className="pk-texture"><div className="pk-back"><div className="pk-back-art"><span className="pk-back-seal">VCT</span></div></div></div>
      </div>
    </div>
  );
}
