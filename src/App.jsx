import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LazyMotion, MotionConfig, LayoutGroup } from 'motion/react';
import RouteErrorBoundary, { NotFound } from './components/RouteError';

const Collection = lazy(() => import('./pages/Collection'));
const PreMatch = lazy(() => import('./pages/PreMatch'));
const Match = lazy(() => import('./pages/Match'));
const PackOpening = lazy(() => import('./pages/PackOpening'));
const PerfectRun = lazy(() => import('./pages/PerfectRun'));
const Multiplayer = lazy(() => import('./pages/Multiplayer'));

// domMax (not domAnimation) is required for layoutId and drag, both used by
// the card-surface morphs. Loaded as its own async chunk so it doesn't sit in
// the entry bundle; `strict` makes a bare `motion.div` throw, so every call
// site is forced onto the `m` namespace instead of drifting onto the (larger,
// non-tree-shaken) full import.
const loadFeatures = () => import('./lib/motionFeatures').then(mod => mod.default);

export default function App() {
  return (
    <LazyMotion features={loadFeatures} strict>
      {/* reducedMotion="user" is the fix for the gap the CSS-only
          `prefers-reduced-motion` kill in index.css can't cover: that kill
          only neutralises CSS transitions/animations, and Framer Motion
          animates via WAAPI + inline styles, neither of which it touches. */}
      <MotionConfig reducedMotion="user">
        {/* LayoutGroup at the root so layoutId survives createPortal — React
            context flows through a portal even though the DOM node doesn't,
            which the dock/sheet/overlay card morphs depend on. */}
        <LayoutGroup>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <RouteErrorBoundary>
              <Suspense fallback={<div className="route-loading" role="status">Loading game…</div>}>
                <Routes>
                  <Route path="/" element={<Navigate to="/run" replace />} />
                  {/* Renamed from /collection - kept as a redirect so old links still work. */}
                  <Route path="/collection" element={<Navigate to="/cards" replace />} />
                  <Route path="/cards" element={<Collection />} />
                  <Route path="/prematch" element={<PreMatch />} />
                  <Route path="/match" element={<Match />} />
                  <Route path="/pack" element={<PackOpening />} />
                  <Route path="/run" element={<PerfectRun />} />
                  <Route path="/multiplayer" element={<Multiplayer />} />
                  <Route path="/lobby/:code" element={<Multiplayer />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </RouteErrorBoundary>
          </BrowserRouter>
        </LayoutGroup>
      </MotionConfig>
    </LazyMotion>
  );
}
