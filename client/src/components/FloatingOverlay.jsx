/**
 * FloatingOverlay — renders floating emoji reactions and voice sticker badges.
 * Positioned fixed over the full viewport; pointer-events none so it never blocks UI.
 */
import './FloatingOverlay.css';

export default function FloatingOverlay({ particles = [], stickers = [] }) {
  return (
    <div className="floating-overlay" aria-hidden="true">
      {particles.map(({ id, emoji, x }) => (
        <span
          key={id}
          className="floating-particle"
          style={{ left: `${x}%` }}
        >
          {emoji}
        </span>
      ))}

      {stickers.map(({ id, text, fromDisplayName, x }) => (
        <div
          key={id}
          className="floating-sticker"
          style={{ left: `${x}%` }}
        >
          <span className="floating-sticker__name">{fromDisplayName}</span>
          <span className="floating-sticker__text">💬 {text}</span>
        </div>
      ))}
    </div>
  );
}
