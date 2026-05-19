export default function TimeoutPanel({ onTimeout }) {
  return (
    <div style={{ padding: 16, color: '#e8e0ff' }}>
      <p style={{ opacity: 0.5, fontSize: 14, marginBottom: 12 }}>Timeout Panel</p>
      <button
        onClick={onTimeout}
        style={{
          background: 'rgba(232,224,255,0.1)',
          border: '1px solid rgba(232,224,255,0.2)',
          color: '#e8e0ff',
          borderRadius: 6,
          padding: '8px 16px',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        Call Timeout
      </button>
    </div>
  );
}
