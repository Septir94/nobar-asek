/**
 * ReactionBar — reaction emoji buttons + voice sticker input with custom pitch.
 * Sits above the main controls bar.
 */

import { useState } from 'react';
import { VOICE_STYLES } from '../hooks/useVoiceSticker';
import './ReactionBar.css';

const REACTIONS = [
  { type: 'clap',  emoji: '👏', label: 'Applause' },
  { type: 'laugh', emoji: '😂', label: 'Laugh' },
  { type: 'heart', emoji: '❤️', label: 'Love' },
  { type: 'wow',   emoji: '😮', label: 'Wow' },
  { type: 'fire',  emoji: '🔥', label: 'Fire' },
];

export default function ReactionBar({
  onSendReaction,
  onSendVoiceSticker,
  maxChars = 50,
}) {
  const [stickerText, setStickerText] = useState('');
  const [stickerOpen, setStickerOpen] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('normal');

  const handleStickerSubmit = (e) => {
    e.preventDefault();
    const trimmed = stickerText.trim();
    if (!trimmed) return;
    onSendVoiceSticker(trimmed, selectedVoice);
    setStickerText('');
    setStickerOpen(false);
  };

  return (
    <div className="reaction-bar">
      {/* Reaction emoji buttons */}
      <div className="reaction-bar__reactions">
        {REACTIONS.map(({ type, emoji, label }) => (
          <button
            key={type}
            className="reaction-btn"
            onClick={() => onSendReaction(type)}
            title={label}
            aria-label={`Send ${label} reaction`}
            type="button"
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="reaction-bar__divider" />

      {/* Voice sticker toggle with custom pitch */}
      <div className="reaction-bar__sticker">
        <button
          className={`reaction-btn reaction-btn--sticker ${stickerOpen ? 'reaction-btn--active' : ''}`}
          onClick={() => setStickerOpen((v) => !v)}
          title="Voice Sticker (TTS)"
          aria-label="Open voice sticker"
          type="button"
        >
          🎤
        </button>

        {stickerOpen && (
          <form className="sticker-form" onSubmit={handleStickerSubmit}>
            {/* Pitch Voice Style Selection */}
            <div className="sticker-voice-selector">
              {Object.entries(VOICE_STYLES).map(([key, style]) => (
                <button
                  key={key}
                  type="button"
                  className={`voice-pill ${selectedVoice === key ? 'voice-pill--active' : ''}`}
                  onClick={() => setSelectedVoice(key)}
                  title={`Pitch: ${style.label}`}
                >
                  {style.icon} {style.label}
                </button>
              ))}
            </div>

            <div className="sticker-input-row">
              <input
                className="sticker-input"
                type="text"
                value={stickerText}
                onChange={(e) => setStickerText(e.target.value.slice(0, maxChars))}
                placeholder="Type to speak aloud…"
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
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
