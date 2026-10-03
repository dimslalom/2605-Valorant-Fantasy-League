import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LayoutGroup, LazyMotion, MotionConfig } from 'motion/react';
import Shell from './components/Shell';

const Today = lazy(() => import('./pages/Today'));
const Collection = lazy(() => import('./pages/Collection'));
const Table = lazy(() => import('./pages/Table'));
const Legal = lazy(() => import('./pages/Legal'));

// PlayerCard (shared with the old site) animates with the `m` namespace under a
// strict LazyMotion, so the same providers wrap this app.
const loadFeatures = () => import('../../../src/lib/motionFeatures').then(mod => mod.default);

export default function App() {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<Suspense fallback={<p className="loading">Loading</p>}><Today /></Suspense>} />
                <Route path="collection" element={<Suspense fallback={<p className="loading">Loading</p>}><Collection /></Suspense>} />
                <Route path="table" element={<Suspense fallback={<p className="loading">Loading</p>}><Table /></Suspense>} />
                <Route path="legal" element={<Suspense fallback={<p className="loading">Loading</p>}><Legal /></Suspense>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </LayoutGroup>
      </MotionConfig>
    </LazyMotion>
  );
}
