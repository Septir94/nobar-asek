/**
 * useReactions — manages sound reactions and floating emoji animations.
 *
 * Listens for 'reaction' socket events.
 * Plays audio matched to the reaction type:
 *   - 'clap'  → realistic hand-clapping sound using Web Audio noise burst + BiquadFilter
 *   - others  → short synthesized tone via oscillator
 * Spawns floating emoji particles that auto-remove after the animation ends.
 */

import { useEffect, useState, useCallback, useRef } from 'react';

// Reaction definitions: emoji + synthesizer params (used for non-clap reactions)
const REACTION_DEFS = {
  clap:  { emoji: '👏' }, // sound handled separately by playClappingSound()
  wow:   { emoji: '😮', freq: 600,  type: 'sine',     duration: 0.28, repeats: 1 },
  laugh: { emoji: '😂', freq: 700,  type: 'triangle', duration: 0.10, repeats: 5 },
  heart: { emoji: '❤️', freq: 440,  type: 'sine',     duration: 0.40, repeats: 1 },
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
 * Realistic hand-clapping sound using white noise + amplitude envelope.
 *
 * A real clap is a transient broadband noise burst shaped by a sharp attack
 * and fast exponential decay. We replicate this with:
 *   1. A noise buffer (white noise)
 *   2. A bandpass filter (1.8kHz) to colour it like skin-on-skin impact
 *   3. A sharp-attack / fast-decay gain envelope per clap hit
 *   4. A small convolver "room" reverb using a secondary noise tail
 *
 * @param {number} [hits=3] — number of individual clap hits
 * @param {number} [startOffset=0] — Web Audio time offset in seconds
 */
function playClappingSound(hits = 3, startOffset = 0) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const sampleRate = ctx.sampleRate;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);

    // Small reverb tail: random noise buffer convolved as impulse response
    const irLength = Math.floor(sampleRate * 0.15); // 150ms reverb tail
    const irBuffer = ctx.createBuffer(1, irLength, sampleRate);
    const irData = irBuffer.getChannelData(0);
    for (let i = 0; i < irLength; i++) {
      irData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLength, 3);
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = irBuffer;
    convolver.connect(masterGain);

    const spacing = 0.14; // seconds between hits (natural clap rhythm ~140ms)

    for (let hit = 0; hit < hits; hit++) {
      const t = ctx.currentTime + startOffset + hit * spacing;

      // ── Noise source ──────────────────────────────────────────────────────
      const noiseLength = Math.floor(sampleRate * 0.08); // 80ms of noise per hit
      const noiseBuffer = ctx.createBuffer(1, noiseLength, sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseLength; i++) {
        noiseData[i] = Math.random() * 2 - 1;
      }

      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer;

      // ── Bandpass filter — shape the noise to sound like flesh/skin ────────
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = 1800;
      bpf.Q.value = 0.9;

      // High-pass filter for the snap
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 900;

      // ── Envelope ────────────────────────────────────────────────────────────
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1.0, t + 0.002);       // 2ms attack
      env.gain.exponentialRampToValueAtTime(0.3, t + 0.02);   // quick decay
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.075); // tail off

      // ── Routing: source → bpf → hpf → envelope → dry + reverb ────────────
      source.connect(bpf);
      bpf.connect(hpf);
      hpf.connect(env);
      env.connect(masterGain);   // dry signal
      env.connect(convolver);    // wet/reverb signal

      source.start(t);
      source.stop(t + 0.09);
    }
  } catch (err) {
    console.warn('[reactions] clap audio error:', err);
  }
}

/**
 * Play a short synthesized sound for non-clap reactions.
 */
function playReactionSound(type) {
  if (type === 'clap') {
    playClappingSound(3, 0);
    return;
  }

  const def = REACTION_DEFS[type];
  if (!def || !def.freq) return;

  const { freq, type: oscType, duration, repeats } = def;

  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

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
    console.warn('[reactions] audio error:', err);
  }
}

let particleIdCounter = 0;

/**
 * @param {import('socket.io-client').Socket | null} socket
 * @returns {{ particles, sendReaction, REACTION_DEFS }}
 */
export function useReactions(socket) {
  const [particles, setParticles] = useState([]); // { id, emoji, x, y }
  const timeoutsRef = useRef([]);

  const spawnParticle = useCallback((emoji) => {
    const id = ++particleIdCounter;
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
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnParticle(def.emoji), i * 100);
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
