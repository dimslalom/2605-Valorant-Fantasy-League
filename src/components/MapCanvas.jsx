import { useRef, useEffect } from 'react';

export default function MapCanvas({
  liveScore = null,
  activeRound = null,
  teamA = 'YOU',
  teamB = 'OPP',
  mapName = 'Haven',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Background - Dark Tactical Slate
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, w, h);

    // Grid lines for tactical grid feeling
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw Map Blueprint - Haven 3 Sites Layout
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;

    // Site A
    ctx.beginPath();
    ctx.rect(70, 70, 110, 90);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff4655';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('A SITE', 95, 120);

    // Site B (Mid)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.beginPath();
    ctx.rect(240, 60, 120, 100);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffb800';
    ctx.fillText('B SITE', 270, 115);

    // Site C
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.beginPath();
    ctx.rect(410, 70, 110, 90);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#00d2ff';
    ctx.fillText('C SITE', 435, 120);

    // Mid Corridor / Chokepoints
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.setLineDash([5, 5]);
    // Attack lanes
    ctx.beginPath();
    ctx.moveTo(125, 320); ctx.lineTo(125, 160); // A Long
    ctx.moveTo(300, 320); ctx.lineTo(300, 160); // Mid
    ctx.moveTo(465, 320); ctx.lineTo(465, 160); // C Long
    ctx.stroke();
    ctx.setLineDash([]);

    // Defender Spawn
    ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
    ctx.fillRect(200, 15, 200, 35);
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('DEFENDER SPAWN', 250, 37);

    // Attacker Spawn
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.fillRect(200, 340, 200, 45);
    ctx.fillStyle = '#ef4444';
    ctx.fillText('ATTACKER SPAWN', 250, 367);

    // Dynamic Player Dots based on live score / round progression
    const roundNumber = (liveScore?.a ?? 0) + (liveScore?.b ?? 0) + 1;
    const timeSeed = Date.now() / 800;

    // Attacker dots (Team A - Red)
    ctx.fillStyle = '#ff4655';
    ctx.shadowColor = '#ff4655';
    ctx.shadowBlur = 10;
    for (let i = 0; i < 5; i++) {
      const offsetX = Math.sin(timeSeed + i) * 20;
      const offsetY = Math.cos(timeSeed * 0.8 + i) * 15;
      const px = 120 + i * 80 + offsetX;
      const py = 250 + offsetY;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Defender dots (Team B - Teal/Green)
    ctx.fillStyle = '#00d2ff';
    ctx.shadowColor = '#00d2ff';
    ctx.shadowBlur = 10;
    for (let i = 0; i < 5; i++) {
      const offsetX = Math.cos(timeSeed + i) * 15;
      const offsetY = Math.sin(timeSeed * 0.9 + i) * 10;
      const px = 110 + i * 90 + offsetX;
      const py = 110 + offsetY;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Active Duel Flash Indicator
    const flashSiteX = roundNumber % 3 === 0 ? 125 : roundNumber % 3 === 1 ? 300 : 465;
    const flashSiteY = 115;
    ctx.fillStyle = 'rgba(255, 70, 85, 0.3)';
    ctx.beginPath();
    ctx.arc(flashSiteX, flashSiteY, 25 + Math.sin(timeSeed * 5) * 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ ENGAGEMENT ZONE', flashSiteX, flashSiteY + 38);

  }, [liveScore, activeRound, teamA, teamB, mapName]);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 640 }}>
      <canvas
        ref={canvasRef}
        width={640}
        height={400}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
        }}
      />
    </div>
  );
}
