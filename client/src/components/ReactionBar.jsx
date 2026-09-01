/**
 * ReactionBar — reaction emoji buttons + voice sticker input panel.
 * Sits above the main controls bar.
 */

import { useState } from 'react';
import './ReactionBar.css';

const REACTIONS = [
  { type: 'clap',  emoji: '👏', label: 'Clap'  },
  { type: 'wow',   emoji: '😮', label: 'Wow'   },
  { type: 'laugh', emoji: '😂', label: 'Laugh' },
  { type: 'heart', emoji: '❤️', label: 'Heart' },
  { type: 'fire',  emoji: '🔥', label: 'Fire'  },
];

export default function ReactionBar({ onSendReaction, onSendVoiceSticker, maxChars = 50 }) {
  const [stickerText, setStickerText] = useState('');
  const [stickerOpen, setStickerOpen] = useState(false);

  const handleStickerSubmit = (e) => {
    e.preventDefault();
    const trimmed = stickerText.trim();
    if (!trimmed) return;
    onSendVoiceSticker(trimmed);
    setStickerText('');
    setStickerOpen(false);
  };

  return (
    <div className="reaction-bar">
      {/* Reaction buttons */}
      <div className="reaction-bar__reactions">
        {REACTIONS.map(({ type, emoji, label }) => (
          <button
            key={type}
            className="reaction-btn"
            onClick={() => onSendReaction(type)}
            title={label}
            aria-label={`Send ${label} reaction`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="reaction-bar__divider" />

      {/* Voice sticker toggle */}
      <div className="reaction-bar__sticker">
        <button
          className={`reaction-btn reaction-btn--sticker ${stickerOpen ? 'reaction-btn--active' : ''}`}
          onClick={() => setStickerOpen((v) => !v)}
          title="Voice sticker"
          aria-label="Open voice sticker"
        >
          🎤
        </button>

        {stickerOpen && (
          <form className="sticker-form" onSubmit={handleStickerSubmit}>
            <input
              className="sticker-input"
              type="text"
              value={stickerText}
              onChange={(e) => setStickerText(e.target.value.slice(0, maxChars))}
              placeholder="Type to speak… (max 50 chars)"
              maxLength={maxChars}
              autoFocus
              aria-label="Voice sticker text"
            />
            <span className="sticker-counter">{stickerText.length}/{maxChars}</span>
            <button
              type="submit"
              className="sticker-send-btn"
              disabled={!stickerText.trim()}
              aria-label="Send voice sticker"
            >
              📢
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
