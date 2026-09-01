/**
 * useReactions — manages sound reactions and floating emoji animations.
 *
 * Listens for 'reaction' socket events.
 * Plays a short synthesized audio tone matched to the reaction type.
 * Spawns floating emoji particles that auto-remove after the animation ends.
 */

import { useEffect, useState, useCallback, useRef } from 'react';

// Reaction definitions: emoji, Web Audio oscillator params for a short tone
const REACTION_DEFS = {
  clap:  { emoji: '👏', freq: 800,  type: 'sawtooth', duration: 0.12, repeats: 3 },
  wow:   { emoji: '😮', freq: 600,  type: 'sine',     duration: 0.25, repeats: 1 },
  laugh: { emoji: '😂', freq: 700,  type: 'triangle', duration: 0.10, repeats: 5 },
  heart: { emoji: '❤️', freq: 440,  type: 'sine',     duration: 0.35, repeats: 1 },
  fire:  { emoji: '🔥', freq: 320,  type: 'sawtooth', duration: 0.08, repeats: 4 },
};

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * Play a short synthesized sound matched to the reaction type.
 */
function playReactionSound(type) {
  const def = REACTION_DEFS[type];
  if (!def) return;

  try {
    const ctx = getAudioCtx();
    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();

    const { freq, type: oscType, duration, repeats } = def;
    const interval = duration * 1.5;

    for (let i = 0; i < repeats; i++) {
      const startAt = ctx.currentTime + i * interval;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = oscType;
      osc.frequency.setValueAtTime(freq, startAt);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.7, startAt + duration);

      gain.gain.setValueAtTime(0.18, startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.01);
    }
  } catch (err) {
    // Audio errors are non-critical
    console.warn('[reactions] audio error:', err);
  }
}

let particleIdCounter = 0;

/**
 * @param {import('socket.io-client').Socket | null} socket
 * @returns {{ particles, sendReaction }}
 */
export function useReactions(socket) {
  const [particles, setParticles] = useState([]); // { id, emoji, x, y }
  const timeoutsRef = useRef([]);

  const spawnParticle = useCallback((emoji) => {
    const id = ++particleIdCounter;
    // Random horizontal position across the screen
    const x = 10 + Math.random() * 80; // 10–90% of viewport width
    const y = 80; // start from bottom area

    setParticles((prev) => [...prev, { id, emoji, x, y }]);

    // Auto-remove after animation (2.5s)
    const t = setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== id));
    }, 2500);
    timeoutsRef.current.push(t);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onReaction = ({ type }) => {
      const def = REACTION_DEFS[type];
      if (!def) return;
      playReactionSound(type);
      // Spawn 2–4 particles per reaction for visual density
      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnParticle(def.emoji), i * 120);
      }
    };

    socket.on('reaction', onReaction);
    return () => socket.off('reaction', onReaction);
  }, [socket, spawnParticle]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => timeoutsRef.current.forEach(clearTimeout);
  }, []);

  const sendReaction = useCallback(
    (type) => {
      if (!socket || !REACTION_DEFS[type]) return;
      socket.emit('send-reaction', { type });
    },
    [socket]
  );

  return { particles, sendReaction, REACTION_DEFS };
}
