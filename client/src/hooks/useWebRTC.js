/**
 * useWebRTC — custom hook managing the full WebRTC mesh lifecycle.
 *
 * Responsibilities:
 * - Acquire local camera/mic via getUserMedia
 * - On 'existing-users': initiate RTCPeerConnection + offer to each existing peer
 * - On 'user-joined': wait for their offer
 * - Forward offer/answer/ICE through socket
 * - Handle ontrack to surface remote streams (camera AND screen share)
 * - Toggle mic mute
 * - Screen share (renegotiation so receiver gets a real stream)
 *
 * Key fix vs previous version:
 *   Socket event handlers are registered as soon as `socket + enabled` are truthy,
 *   INDEPENDENTLY of localStream. When existing-users / user-joined arrive before
 *   getUserMedia finishes, they are buffered in `pendingPeersRef`.  Once the local
 *   stream is ready we drain that buffer and initiate/accept offers normally.
 *   This eliminates the race-condition where peers could not see each other.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const ICE_CONFIG_FALLBACK = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * @param {import('socket.io-client').Socket} socket
 * @param {boolean} enabled - only start when true (after socket join confirmed)
 */
export function useWebRTC(socket, enabled) {
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef({}); // socketId → RTCPeerConnection
  const iceConfigRef = useRef(ICE_CONFIG_FALLBACK);
  // Buffer ICE candidates that arrive before setRemoteDescription completes
  const pendingCandidatesRef = useRef({}); // socketId → RTCIceCandidateInit[]
  // Buffer peers that arrived before localStream was ready
  const pendingPeersRef = useRef([]); // { socketId, displayName, userId, isOfferer }[]

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // socketId → { stream, displayName, userId }
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({}); // socketId → MediaStream
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [remoteCameraStates, setRemoteCameraStates] = useState({}); // socketId → boolean
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [screenStream, setScreenStream] = useState(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const updateRemoteStream = useCallback((socketId, partial) => {
    setRemoteStreams((prev) => ({
      ...prev,
      [socketId]: { ...prev[socketId], ...partial },
    }));
  }, []);

  const removeRemoteStream = useCallback((socketId) => {
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    setRemoteScreenStreams((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  /**
   * Create a new RTCPeerConnection for a given remote socket.
   * Adds local tracks and wires up ICE + track events.
   */
  const createPeerConnection = useCallback(
    (targetSocketId, displayName, userId) => {
      if (peerConnectionsRef.current[targetSocketId]) {
        peerConnectionsRef.current[targetSocketId].close();
      }

      const pc = new RTCPeerConnection(iceConfigRef.current);

      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      // ICE candidate → send to remote
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          socket.emit('ice-candidate', { targetSocketId, candidate });
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[webrtc] ICE state ${targetSocketId}: ${pc.iceConnectionState}`);
      };

      pc.onconnectionstatechange = () => {
        console.log(`[webrtc] Conn state ${targetSocketId}: ${pc.connectionState}`);
        if (pc.connectionState === 'failed') {
          console.warn(`[webrtc] Connection failed with ${targetSocketId} — consider ICE restart`);
        }
      };

      // Remote track arrived — map to camera stream or screen stream
      pc.ontrack = ({ track, streams }) => {
        if (!streams || streams.length === 0) return;
        const stream = streams[0];

        // Screen share streams are identified by a stream ID prefixed 'screen-'
        if (stream.id && stream.id.startsWith('screen-')) {
          setRemoteScreenStreams((prev) => ({ ...prev, [targetSocketId]: stream }));
        } else {
          updateRemoteStream(targetSocketId, {
            stream,
            displayName,
            userId,
          });
        }
      };

      peerConnectionsRef.current[targetSocketId] = pc;
      return pc;
    },
    [socket, updateRemoteStream]
  );

  // ── Init local media ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (err) {
        console.error('[webrtc] getUserMedia failed:', err);
        // Try audio-only fallback
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (cancelled) { audioOnly.getTracks().forEach((t) => t.stop()); return; }
          localStreamRef.current = audioOnly;
          setLocalStream(audioOnly);
        } catch (audioErr) {
          console.error('[webrtc] Audio-only fallback also failed:', audioErr);
        }
      }
    }

    initMedia();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /**
   * Drain pending peers once local stream is available.
   */
  useEffect(() => {
    if (!localStream || !socket || !enabled) return;

    const pending = pendingPeersRef.current;
    if (pending.length === 0) return;
    pendingPeersRef.current = [];

    pending.forEach(async ({ socketId, displayName, userId, isOfferer }) => {
      if (isOfferer) {
        const pc = createPeerConnection(socketId, displayName, userId);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { targetSocketId: socketId, sdp: offer });
        } catch (err) {
          console.error('[webrtc] Failed to create offer for buffered peer:', err);
        }
      } else {
        createPeerConnection(socketId, displayName, userId);
      }
    });
  }, [localStream, socket, enabled, createPeerConnection]);

  // ── Socket event handlers ─────────────────────────────────────────────────
  // NOTE: This effect does NOT depend on localStream — registers as soon as
  // socket + enabled are ready. Peers buffered until localStream is available.
  useEffect(() => {
    if (!socket || !enabled) return;

    // ── existing-users: we are the new joiner, initiate offers to each ────
    const onExistingUsers = async (users) => {
      for (const { socketId, displayName, userId } of users) {
        if (!localStreamRef.current) {
          pendingPeersRef.current.push({ socketId, displayName, userId, isOfferer: true });
          continue;
        }
        const pc = createPeerConnection(socketId, displayName, userId);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { targetSocketId: socketId, sdp: offer });
        } catch (err) {
          console.error('[webrtc] createOffer failed:', err);
        }
      }
    };

    // ── user-joined: a new user connected, pre-create PC ─────────────────
    const onUserJoined = ({ socketId, displayName, userId }) => {
      if (!localStreamRef.current) {
        pendingPeersRef.current.push({ socketId, displayName, userId, isOfferer: false });
        return;
      }
      createPeerConnection(socketId, displayName, userId);
    };

    // ── offer received: answer it ──────────────────────────────────────────
    const onOffer = async ({ fromSocketId, fromDisplayName, fromUserId, sdp }) => {
      let pc = peerConnectionsRef.current[fromSocketId];
      if (!pc) {
        if (!localStreamRef.current) {
          console.warn('[webrtc] Offer received before local stream — delaying 2s');
          await new Promise((r) => setTimeout(r, 2000));
          if (!localStreamRef.current) {
            console.error('[webrtc] Stream still not ready — dropping offer from', fromSocketId);
            return;
          }
        }
        pc = createPeerConnection(fromSocketId, fromDisplayName, fromUserId);
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const queued = pendingCandidatesRef.current[fromSocketId] || [];
        delete pendingCandidatesRef.current[fromSocketId];
        for (const c of queued) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { targetSocketId: fromSocketId, sdp: answer });
      } catch (err) {
        console.error('[webrtc] Error handling offer:', err);
      }
    };

    // ── answer received ────────────────────────────────────────────────────
    const onAnswer = async ({ fromSocketId, sdp }) => {
      const pc = peerConnectionsRef.current[fromSocketId];
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const queued = pendingCandidatesRef.current[fromSocketId] || [];
        delete pendingCandidatesRef.current[fromSocketId];
        for (const c of queued) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
        }
      } catch (err) {
        console.error('[webrtc] Error handling answer:', err);
      }
    };

    // ── ICE candidate received ─────────────────────────────────────────────
    const onIceCandidate = async ({ fromSocketId, candidate }) => {
      const pc = peerConnectionsRef.current[fromSocketId];
      if (!pc) return;
      if (!pc.remoteDescription) {
        pendingCandidatesRef.current[fromSocketId] =
          pendingCandidatesRef.current[fromSocketId] || [];
        pendingCandidatesRef.current[fromSocketId].push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[webrtc] addIceCandidate error:', err);
      }
    };

    // ── user left: close and clean up ─────────────────────────────────────
    const onUserLeft = ({ socketId }) => {
      const pc = peerConnectionsRef.current[socketId];
      if (pc) {
        pc.close();
        delete peerConnectionsRef.current[socketId];
      }
      removeRemoteStream(socketId);
      pendingPeersRef.current = pendingPeersRef.current.filter((p) => p.socketId !== socketId);
    };

    // ── camera-toggle from remote peer ────────────────────────────────────
    const onRemoteCameraToggle = ({ fromSocketId, cameraOn }) => {
      setRemoteCameraStates((prev) => ({ ...prev, [fromSocketId]: cameraOn }));
    };

    socket.on('existing-users', onExistingUsers);
    socket.on('user-joined', onUserJoined);
    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('user-left', onUserLeft);
    socket.on('camera-toggle', onRemoteCameraToggle);

    return () => {
      socket.off('existing-users', onExistingUsers);
      socket.off('user-joined', onUserJoined);
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('user-left', onUserLeft);
      socket.off('camera-toggle', onRemoteCameraToggle);
    };
  }, [socket, enabled, createPeerConnection, removeRemoteStream]);

  // ── Store TURN ice config ─────────────────────────────────────────────────
  const setIceConfig = useCallback((iceServers) => {
    iceConfigRef.current = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        ...(Array.isArray(iceServers) ? iceServers : [iceServers]),
      ],
    };
    console.log('[webrtc] ICE config updated:', JSON.stringify(iceConfigRef.current));
  }, []);

  // ── Toggle mic ────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setMicEnabled(audioTrack.enabled);
  }, []);

  // ── Toggle camera ─────────────────────────────────────────────────────────
  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    const newState = videoTrack.enabled;
    setCameraEnabled(newState);
    if (socket) socket.emit('camera-toggle', { cameraOn: newState });
  }, [socket]);

  // ── Screen share ──────────────────────────────────────────────────────────
  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'window',
          selfBrowserSurface: 'exclude',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsSharingScreen(true);

      const screenTrack = stream.getVideoTracks()[0];

      // Replace video track + renegotiate so remote ontrack fires
      const renegotiationPromises = Object.entries(peerConnectionsRef.current).map(
        async ([targetSocketId, pc]) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(screenTrack);
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket.emit('offer', { targetSocketId, sdp: offer });
            } catch (err) {
              console.warn('[webrtc] Screen share renegotiation failed:', err);
            }
          }
        }
      );

      await Promise.allSettled(renegotiationPromises);
      socket.emit('start-screen-share');

      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
        console.error('[webrtc] getDisplayMedia failed:', err);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const stopScreenShare = useCallback(() => {
    if (!screenStreamRef.current) return;

    screenStreamRef.current.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsSharingScreen(false);

    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraTrack) {
      Object.entries(peerConnectionsRef.current).forEach(async ([targetSocketId, pc]) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(cameraTrack);
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { targetSocketId, sdp: offer });
          } catch (err) {
            console.warn('[webrtc] Stop screen share renegotiation failed:', err);
          }
        }
      });
    }

    socket.emit('stop-screen-share');
  }, [socket]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
      peerConnectionsRef.current = {};
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      pendingPeersRef.current = [];
    };
  }, []);

  return {
    localStream,
    remoteStreams,
    remoteScreenStreams,
    micEnabled,
    toggleMic,
    cameraEnabled,
    toggleCamera,
    remoteCameraStates,
    isSharingScreen,
    screenStream,
    startScreenShare,
    stopScreenShare,
    setIceConfig,
  };
}
