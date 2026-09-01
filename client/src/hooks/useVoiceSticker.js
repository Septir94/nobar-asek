/**
 * useVoiceSticker — manages voice sticker sending and receiving.
 *
 * Supports:
 * 1. Text-to-Speech voice stickers with custom pitch modulation (Normal, Chipmunk, Monster, Speedy)
 * 2. Soundboard meme audio presets (/sound/...)
 */

import { useEffect, useState, useCallback, useRef } from 'react';

const MAX_CHARS = 50;
let stickerIdCounter = 0;

export const VOICE_STYLES = {
  normal:   { label: 'Normal',   icon: '🤖', pitch: 1.0, rate: 1.0 },
  chipmunk: { label: 'Chipmunk', icon: '🐿️', pitch: 1.6, rate: 1.25 },
  monster:  { label: 'Monster',  icon: '👹', pitch: 0.5, rate: 0.85 },
  speedy:   { label: 'Speedy',   icon: '⚡', pitch: 1.1, rate: 1.55 },
};

export const SOUNDBOARD_PRESETS = [
  { id: 'applause',   label: 'Applause',   emoji: '👏', soundFile: '/sound/applause-2.mp3' },
  { id: 'evil-laugh', label: 'Evil Laugh', emoji: '😈', soundFile: '/sound/evil-laugh.mp3' },
  { id: 'kiss',       label: 'Kiss',       emoji: '💋', soundFile: '/sound/kiss-2.mp3' },
  { id: 'laugh',      label: 'LOL Laugh',  emoji: '😆', soundFile: '/sound/laugh-2.mp3' },
  { id: 'wow',        label: 'WOW',        emoji: '😮', soundFile: '/sound/wow-video.mp3' },
  { id: 'clap',       label: 'Fast Clap',  emoji: '👏', soundFile: '/sound/clap-sound.mp3' },
];

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
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.pitch = styleConfig.pitch;
          utterance.rate = styleConfig.rate;
          utterance.volume = 0.95;

          // Attempt to pick a natural voice if available
          const voices = window.speechSynthesis.getVoices();
          const idVoice = voices.find((v) => v.lang.startsWith('id') || v.lang.startsWith('en'));
          if (idVoice) utterance.voice = idVoice;

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
    SOUNDBOARD_PRESETS,
    MAX_CHARS,
  };
}
