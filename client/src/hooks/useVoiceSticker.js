/**
 * useVoiceSticker — manages voice sticker sending and receiving.
 *
 * Receiving: uses Web Speech API (speechSynthesis) to read text aloud,
 * and spawns a floating text badge that auto-removes after a few seconds.
 * Sending: emits 'send-voice-sticker' with sanitized text.
 */

import { useEffect, useState, useCallback, useRef } from 'react';

const MAX_CHARS = 50;
let stickerIdCounter = 0;

/**
 * @param {import('socket.io-client').Socket | null} socket
 */
export function useVoiceSticker(socket) {
  const [stickers, setStickers] = useState([]); // { id, text, fromDisplayName, x }
  const timeoutsRef = useRef([]);

  const spawnSticker = useCallback((text, fromDisplayName) => {
    const id = ++stickerIdCounter;
    const x = 10 + Math.random() * 60; // random horizontal %

    setStickers((prev) => [...prev, { id, text, fromDisplayName, x }]);

    // Auto-remove after 4s
    const t = setTimeout(() => {
      setStickers((prev) => prev.filter((s) => s.id !== id));
    }, 4000);
    timeoutsRef.current.push(t);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onVoiceSticker = ({ text, fromDisplayName }) => {
      // Speak the text using the Web Speech API (best-effort)
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        try {
          // Cancel any queued utterances to avoid pile-up
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.1;
          utterance.pitch = 1.0;
          utterance.volume = 0.9;
          window.speechSynthesis.speak(utterance);
        } catch (err) {
          console.warn('[voice-sticker] speechSynthesis error:', err);
        }
      }

      spawnSticker(text, fromDisplayName);
    };

    socket.on('voice-sticker', onVoiceSticker);
    return () => socket.off('voice-sticker', onVoiceSticker);
  }, [socket, spawnSticker]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => timeoutsRef.current.forEach(clearTimeout);
  }, []);

  const sendVoiceSticker = useCallback(
    (rawText) => {
      if (!socket) return;
      // Client-side sanitize: strip control chars, trim, limit length
      const text = rawText.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, MAX_CHARS);
      if (!text) return;
      socket.emit('send-voice-sticker', { text });
    },
    [socket]
  );

  return { stickers, sendVoiceSticker, MAX_CHARS };
}
