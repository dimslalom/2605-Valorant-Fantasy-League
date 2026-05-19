import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Collection from './pages/Collection';
import PreMatch from './pages/PreMatch';
import Match from './pages/Match';
import PackOpening from './pages/PackOpening';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/collection" replace />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/prematch" element={<PreMatch />} />
        <Route path="/match" element={<Match />} />
        <Route path="/pack" element={<PackOpening />} />
      </Routes>
    </BrowserRouter>
  );
}
