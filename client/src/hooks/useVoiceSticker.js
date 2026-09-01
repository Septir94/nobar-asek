/**
 * useVoiceSticker — manages voice sticker sending and receiving.
 *
 * Text-to-Speech voice stickers with distinct custom pitch & speed modulation:
 * - 🤖 Normal: pitch 1.0, rate 1.0
 * - 🐿️ Chipmunk: pitch 2.0, rate 1.4 (ultra high-pitch helium/chipmunk voice)
 * - 👹 Monster: pitch 0.3, rate 0.75 (deep heavy monster voice)
 * - ⚡ Speedy: pitch 1.2, rate 2.0 (fast speedrun voice)
 */

import { useEffect, useState, useCallback, useRef } from 'react';

const MAX_CHARS = 50;
let stickerIdCounter = 0;

export const VOICE_STYLES = {
  normal:   { label: 'Normal',   icon: '🤖', pitch: 1.0, rate: 1.0 },
  chipmunk: { label: 'Chipmunk', icon: '🐿️', pitch: 2.0, rate: 1.4 },
  monster:  { label: 'Monster',  icon: '👹', pitch: 0.3, rate: 0.75 },
  speedy:   { label: 'Speedy',   icon: '⚡', pitch: 1.2, rate: 2.0 },
};

/**
 * @param {import('socket.io-client').Socket | null} socket
 */
export function useVoiceSticker(socket) {
  const [stickers, setStickers] = useState([]); // { id, text, fromDisplayName, styleIcon, x }
  const timeoutsRef = useRef([]);

  const spawnSticker = useCallback((text, fromDisplayName, styleIcon = '📢') => {
    const id = ++stickerIdCounter;
    const x = 10 + Math.random() * 60; // random horizontal %

    setStickers((prev) => [...prev, { id, text, fromDisplayName, styleIcon, x }]);

    // Auto-remove after 4.5s
    const t = setTimeout(() => {
      setStickers((prev) => prev.filter((s) => s.id !== id));
    }, 4500);
    timeoutsRef.current.push(t);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onVoiceSticker = ({ text, fromDisplayName, voiceStyle = 'normal' }) => {
      const styleConfig = VOICE_STYLES[voiceStyle] || VOICE_STYLES.normal;

      // Speak using Web Speech API with custom pitch & rate modulation
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel(); // cancel any active utterance
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.pitch = styleConfig.pitch;
          utterance.rate = styleConfig.rate;
          utterance.volume = 1.0;

          window.speechSynthesis.speak(utterance);
        } catch (err) {
          console.warn('[voice-sticker] speechSynthesis error:', err);
        }
      }

      spawnSticker(text, fromDisplayName, styleConfig.icon);
    };

    socket.on('voice-sticker', onVoiceSticker);
    return () => socket.off('voice-sticker', onVoiceSticker);
  }, [socket, spawnSticker]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => timeoutsRef.current.forEach(clearTimeout);
  }, []);

  const sendVoiceSticker = useCallback(
    (rawText, voiceStyle = 'normal') => {
      if (!socket) return;
      const text = rawText.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, MAX_CHARS);
      if (!text) return;
      socket.emit('send-voice-sticker', { text, voiceStyle });
    },
    [socket]
  );

  return {
    stickers,
    sendVoiceSticker,
    VOICE_STYLES,
    MAX_CHARS,
  };
}
