/**
 * useWebRTC — custom hook managing the full WebRTC mesh lifecycle.
 *
 * Responsibilities:
 * - Acquire local camera/mic via getUserMedia
 * - processExistingUsers(): called by Room.jsx with the list from join-room callback
 * - On 'user-joined': pre-create PC for new peers
 * - Forward offer/answer/ICE through socket
 * - Handle ontrack to surface remote streams (camera AND screen share)
 * - Toggle mic mute / camera
 * - Screen share with optional system audio capture
 *
 * Key design decisions:
 * 1. Socket event handlers register when socket is available (no `enabled` guard)
 *    so no events are missed after join-room.
 * 2. existingUsers are NOT received via socket event — they come from the
 *    join-room callback and are processed via processExistingUsers().
 * 3. Peers that arrive before getUserMedia completes are buffered in
 *    pendingPeersRef and drained when localStream becomes available.
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
 * @param {boolean} enabled - only start media when true (after socket join confirmed)
 */
export function useWebRTC(socket, enabled) {
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef({}); // socketId → RTCPeerConnection
  const iceConfigRef = useRef(ICE_CONFIG_FALLBACK);
  const pendingCandidatesRef = useRef({}); // socketId → RTCIceCandidateInit[]
  const pendingPeersRef = useRef([]); // { socketId, displayName, userId, isOfferer }[]
  // Track screen audio senders so we can remove them on stop
  const screenAudioSendersRef = useRef({}); // socketId → RTCRtpSender

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // socketId → { stream, displayName, userId }
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({}); // socketId → MediaStream
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [remoteCameraStates, setRemoteCameraStates] = useState({}); // socketId → boolean
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [screenAudioEnabled, setScreenAudioEnabled] = useState(false);

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

      // Also add screen audio track if currently sharing with audio
      if (screenStreamRef.current) {
        const screenAudioTrack = screenStreamRef.current.getAudioTracks()[0];
        if (screenAudioTrack) {
          const sender = pc.addTrack(screenAudioTrack, screenStreamRef.current);
          screenAudioSendersRef.current[targetSocketId] = sender;
        }
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
          console.warn(`[webrtc] Connection failed with ${targetSocketId}`);
        }
      };

      // Remote track arrived — detect camera vs screen share streams
      pc.ontrack = ({ track, streams }) => {
        if (!streams || streams.length === 0) return;
        const stream = streams[0];

        // If this stream contains only a video track and its label hints at
        // a display surface, treat it as screen share.  Otherwise it's a
        // camera/mic stream.  We also watch for audio-only tracks coming
        // on a second stream (screen audio).  The simplest heuristic: if we
        // already have a camera stream from this peer and a new stream arrives,
        // it's likely screen share.
        updateRemoteStream(targetSocketId, {
          stream,
          displayName,
          userId,
        });
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
    if (!localStream || !socket) return;

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
  }, [localStream, socket, createPeerConnection]);

  /**
   * processExistingUsers — called by Room.jsx after join-room callback.
   * This replaces the old 'existing-users' socket event to avoid race conditions.
   */
  const processExistingUsers = useCallback(
    (users) => {
      if (!users || !Array.isArray(users) || users.length === 0) return;

      for (const { socketId, displayName, userId } of users) {
        if (!localStreamRef.current) {
          // Stream not ready — buffer for later
          pendingPeersRef.current.push({ socketId, displayName, userId, isOfferer: true });
        } else {
          // Stream ready — create offer immediately
          (async () => {
            const pc = createPeerConnection(socketId, displayName, userId);
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket.emit('offer', { targetSocketId: socketId, sdp: offer });
            } catch (err) {
              console.error('[webrtc] createOffer failed for existing user:', err);
            }
          })();
        }
      }
    },
    [socket, createPeerConnection]
  );

  // ── Socket event handlers ─────────────────────────────────────────────────
  // Register as soon as socket is available (no `enabled` guard) so we never
  // miss events. Note: we no longer listen for 'existing-users' — that data
  // comes from the join-room callback via processExistingUsers().
  useEffect(() => {
    if (!socket) return;

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
      delete screenAudioSendersRef.current[socketId];
      removeRemoteStream(socketId);
      pendingPeersRef.current = pendingPeersRef.current.filter((p) => p.socketId !== socketId);
    };

    // ── camera-toggle from remote peer ────────────────────────────────────
    const onRemoteCameraToggle = ({ fromSocketId, cameraOn }) => {
      setRemoteCameraStates((prev) => ({ ...prev, [fromSocketId]: cameraOn }));
    };

    socket.on('user-joined', onUserJoined);
    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('user-left', onUserLeft);
    socket.on('camera-toggle', onRemoteCameraToggle);

    return () => {
      socket.off('user-joined', onUserJoined);
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('user-left', onUserLeft);
      socket.off('camera-toggle', onRemoteCameraToggle);
    };
  }, [socket, createPeerConnection, removeRemoteStream]);

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
  /**
   * @param {boolean} includeAudio - whether to capture system/tab audio
   */
  const startScreenShare = useCallback(async (includeAudio = false) => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'window',
          selfBrowserSurface: 'exclude',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        // Request system audio if the toggle is on.
        // The browser will show a "Share audio" checkbox in its native picker.
        audio: includeAudio ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } : false,
      });

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsSharingScreen(true);
      setScreenAudioEnabled(stream.getAudioTracks().length > 0);

      const screenTrack = stream.getVideoTracks()[0];
      const screenAudioTrack = stream.getAudioTracks()[0] || null;

      // Replace video track + add audio track in ALL peer connections + renegotiate
      const renegotiationPromises = Object.entries(peerConnectionsRef.current).map(
        async ([targetSocketId, pc]) => {
          // Replace video track
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
          }

          // Add screen audio track if available
          if (screenAudioTrack) {
            const audioSender = pc.addTrack(screenAudioTrack, stream);
            screenAudioSendersRef.current[targetSocketId] = audioSender;
          }

          // Renegotiate so remote side picks up the changes
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('offer', { targetSocketId, sdp: offer });
          } catch (err) {
            console.warn('[webrtc] Screen share renegotiation failed:', err);
          }
        }
      );

      await Promise.allSettled(renegotiationPromises);
      socket.emit('start-screen-share');

      // When user stops sharing via browser UI
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
    setScreenAudioEnabled(false);

    // Restore camera track + remove screen audio senders + renegotiate
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    Object.entries(peerConnectionsRef.current).forEach(async ([targetSocketId, pc]) => {
      // Restore video
      if (cameraTrack) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(cameraTrack);
        }
      }

      // Remove screen audio sender
      const audioSender = screenAudioSendersRef.current[targetSocketId];
      if (audioSender) {
        try { pc.removeTrack(audioSender); } catch (_) {}
        delete screenAudioSendersRef.current[targetSocketId];
      }

      // Renegotiate
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { targetSocketId, sdp: offer });
      } catch (err) {
        console.warn('[webrtc] Stop screen share renegotiation failed:', err);
      }
    });

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
      screenAudioSendersRef.current = {};
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
    screenAudioEnabled,
    startScreenShare,
    stopScreenShare,
    setIceConfig,
    processExistingUsers,
  };
}
