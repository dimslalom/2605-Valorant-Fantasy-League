import { useRef, useEffect } from 'react';

export default function MapCanvas({ frame = null, mapData = null }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d0f17';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(232, 224, 255, 0.08)';
    ctx.font = '14px DM Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Map canvas — coming in sprint 2', canvas.width / 2, canvas.height / 2);
  }, [frame, mapData]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={400}
      style={{ display: 'block', borderRadius: 8, background: '#0d0f17' }}
    />
  );
}
