import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import RouteErrorBoundary, { NotFound } from './components/RouteError';

const Collection = lazy(() => import('./pages/Collection'));
const PreMatch = lazy(() => import('./pages/PreMatch'));
const Match = lazy(() => import('./pages/Match'));
const PackOpening = lazy(() => import('./pages/PackOpening'));
const PerfectRun = lazy(() => import('./pages/PerfectRun'));
const Multiplayer = lazy(() => import('./pages/Multiplayer'));

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <RouteErrorBoundary>
        <Suspense fallback={<div className="route-loading" role="status">Loading game…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/collection" replace />} />
            <Route path="/collection" element={<Collection />} />
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
  );
}
