import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Collection from './pages/Collection';
import PreMatch from './pages/PreMatch';
import Match from './pages/Match';
import PackOpening from './pages/PackOpening';
import PerfectRun from './pages/PerfectRun';
import Multiplayer from './pages/Multiplayer';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Routes>
        <Route path="/" element={<Navigate to="/collection" replace />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/prematch" element={<PreMatch />} />
        <Route path="/match" element={<Match />} />
        <Route path="/pack" element={<PackOpening />} />
        <Route path="/run" element={<PerfectRun />} />
        <Route path="/multiplayer" element={<Multiplayer />} />
        <Route path="/lobby/:code" element={<Multiplayer />} />
      </Routes>
    </BrowserRouter>
  );
}
