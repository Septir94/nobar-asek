/**
 * useWebRTC — custom hook managing the full WebRTC mesh lifecycle.
 *
 * Responsibilities:
 * - Acquire local camera/mic via getUserMedia with graceful mobile multi-stage fallback
 * - Maintain unified remote MediaStreams per peer containing video + all audio tracks
 * - Handle screen sharing (video replaceTrack + screen audio addTrack + renegotiation)
 * - Provide host preview of the screen stream
 * - Process existing users from socket event AND join-room callback safely without race conditions
 * - Never drop offers when localStream is starting up
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
  const remoteStreamsMapRef = useRef({}); // socketId → MediaStream
  const iceConfigRef = useRef(ICE_CONFIG_FALLBACK);
  const pendingCandidatesRef = useRef({}); // socketId → RTCIceCandidateInit[]
  const pendingPeersRef = useRef([]); // { socketId, displayName, userId, isOfferer }[]
  const screenAudioSendersRef = useRef({}); // socketId → RTCRtpSender

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // socketId → { stream, displayName, userId }
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
    if (remoteStreamsMapRef.current[socketId]) {
      delete remoteStreamsMapRef.current[socketId];
    }
    setRemoteStreams((prev) => {
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
        return peerConnectionsRef.current[targetSocketId];
      }

      const pc = new RTCPeerConnection(iceConfigRef.current);

      if (!remoteStreamsMapRef.current[targetSocketId]) {
        remoteStreamsMapRef.current[targetSocketId] = new MediaStream();
      }

      // Choose active video track: screen track if currently sharing, else camera
      const isSharing = !!screenStreamRef.current;
      const activeVideoTrack = isSharing
        ? screenStreamRef.current?.getVideoTracks()[0]
        : localStreamRef.current?.getVideoTracks()[0];

      const micAudioTrack = localStreamRef.current?.getAudioTracks()[0];

      if (micAudioTrack) {
        pc.addTrack(micAudioTrack, localStreamRef.current);
      }

      if (activeVideoTrack) {
        pc.addTrack(activeVideoTrack, localStreamRef.current);
      }

      // Add screen audio track if currently sharing with audio
      if (isSharing && screenStreamRef.current) {
        const screenAudioTrack = screenStreamRef.current.getAudioTracks()[0];
        if (screenAudioTrack) {
          const sender = pc.addTrack(screenAudioTrack, localStreamRef.current);
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

      // Remote track arrived — add to dedicated peer MediaStream
      pc.ontrack = ({ track }) => {
        console.log(`[webrtc] ontrack from ${targetSocketId}: kind=${track.kind}, id=${track.id}`);

        let pStream = remoteStreamsMapRef.current[targetSocketId];
        if (!pStream) {
          pStream = new MediaStream();
          remoteStreamsMapRef.current[targetSocketId] = pStream;
        }

        const currentTracks = pStream.getTracks();
        if (!currentTracks.some((t) => t.id === track.id)) {
          if (track.kind === 'video') {
            // Remove old/previous video tracks so we only have 1 active video track
            pStream.getVideoTracks().forEach((oldTrack) => {
              if (oldTrack.id !== track.id) {
                pStream.removeTrack(oldTrack);
              }
            });
          }
          pStream.addTrack(track);
        }

        track.onended = () => {
          console.log(`[webrtc] Track ended: ${track.kind} (${track.id})`);
          if (pStream.getTracks().some((t) => t.id === track.id)) {
            pStream.removeTrack(track);
          }
        };

        // Update React state with the updated stream
        updateRemoteStream(targetSocketId, {
          stream: pStream,
          displayName,
          userId,
        });
      };

      peerConnectionsRef.current[targetSocketId] = pc;
      return pc;
    },
    [socket, updateRemoteStream]
  );

  // ── Init local media with multi-stage mobile fallback ─────────────────────
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function initMedia() {
      // Stage 1: Try ideal 720p facingMode user
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
        return;
      } catch (err) {
        console.warn('[webrtc] getUserMedia high-res failed, trying basic video+audio:', err);
      }

      // Stage 2: Try basic unconstrained video + audio (fixes mobile orientation/constraint errors)
      try {
        const basicStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          basicStream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = basicStream;
        setLocalStream(basicStream);
        return;
      } catch (basicErr) {
        console.warn('[webrtc] Basic video+audio failed, trying audio only:', basicErr);
      }

      // Stage 3: Try audio-only fallback
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) {
          audioOnly.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = audioOnly;
        setLocalStream(audioOnly);
      } catch (audioErr) {
        console.error('[webrtc] All getUserMedia fallbacks failed (permissions denied or no devices):', audioErr);
        // Provide empty stream placeholder so peer can still join and watch others
        const emptyStream = new MediaStream();
        localStreamRef.current = emptyStream;
        setLocalStream(emptyStream);
      }
    }

    initMedia();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /**
   * Drain pending peers once local stream is available & attach tracks to any existing PCs.
   */
  useEffect(() => {
    if (!localStream || !socket) return;

    // 1. Attach local tracks to any existing peer connections created before localStream was ready
    Object.entries(peerConnectionsRef.current).forEach(([targetSocketId, pc]) => {
      const senders = pc.getSenders();
      const hasVideo = senders.some((s) => s.track?.kind === 'video');
      const hasAudio = senders.some((s) => s.track?.kind === 'audio');

      const videoTrack = screenStreamRef.current
        ? screenStreamRef.current.getVideoTracks()[0]
        : localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];

      if (!hasAudio && audioTrack) {
        pc.addTrack(audioTrack, localStream);
      }
      if (!hasVideo && videoTrack) {
        pc.addTrack(videoTrack, localStream);
      }
    });

    // 2. Drain pending peers
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
   * processExistingUsers — handles list of existing room members.
   */
  const processExistingUsers = useCallback(
    (users) => {
      if (!users || !Array.isArray(users) || users.length === 0) return;

      for (const { socketId, displayName, userId } of users) {
        if (peerConnectionsRef.current[socketId]) {
          continue; // already connected or connecting
        }

        if (!localStreamRef.current) {
          if (!pendingPeersRef.current.some((p) => p.socketId === socketId)) {
            pendingPeersRef.current.push({ socketId, displayName, userId, isOfferer: true });
          }
        } else {
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
  useEffect(() => {
    if (!socket) return;

    // ── existing-users event: joiner initiates offers ──────────────────────
    const onExistingUsers = (users) => {
      console.log('[webrtc] Socket on existing-users:', users);
      processExistingUsers(users);
    };

    // ── user-joined: a new user connected, pre-create PC ─────────────────
    const onUserJoined = ({ socketId, displayName, userId }) => {
      console.log('[webrtc] User joined:', socketId, displayName);
      if (peerConnectionsRef.current[socketId]) return;

      if (!localStreamRef.current) {
        if (!pendingPeersRef.current.some((p) => p.socketId === socketId)) {
          pendingPeersRef.current.push({ socketId, displayName, userId, isOfferer: false });
        }
        return;
      }
      createPeerConnection(socketId, displayName, userId);
    };

    // ── offer received: answer immediately (never drop offers!) ─────────────
    const onOffer = async ({ fromSocketId, fromDisplayName, fromUserId, sdp }) => {
      let pc = peerConnectionsRef.current[fromSocketId];
      if (!pc) {
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
  }, [socket, createPeerConnection, processExistingUsers, removeRemoteStream]);

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

  // ── Stop Screen share ─────────────────────────────────────────────────────
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
      // 1. Restore video track
      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (videoSender && cameraTrack) {
        await videoSender.replaceTrack(cameraTrack);
      }

      // 2. Remove screen audio sender
      const audioSender = screenAudioSendersRef.current[targetSocketId];
      let needsRenegotiation = false;
      if (audioSender) {
        try {
          pc.removeTrack(audioSender);
          needsRenegotiation = true;
        } catch (_) {}
        delete screenAudioSendersRef.current[targetSocketId];
      }

      // 3. Renegotiate if audio m-line changed
      if (needsRenegotiation) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { targetSocketId, sdp: offer });
        } catch (err) {
          console.warn('[webrtc] Stop screen share renegotiation failed:', err);
        }
      }
    });

    socket.emit('stop-screen-share');
  }, [socket]);

  // ── Start Screen share ────────────────────────────────────────────────────
  /**
   * @param {boolean} includeAudio - whether to capture system/tab audio
   */
  const startScreenShare = useCallback(async (includeAudio = false) => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: 30, max: 60 },
        },
        audio: includeAudio ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } : false,
      });

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsSharingScreen(true);
      const hasAudio = stream.getAudioTracks().length > 0;
      setScreenAudioEnabled(hasAudio);

      const screenTrack = stream.getVideoTracks()[0];
      const screenAudioTrack = hasAudio ? stream.getAudioTracks()[0] : null;

      // Replace video track + add audio track in ALL peer connections
      const renegotiationPromises = Object.entries(peerConnectionsRef.current).map(
        async ([targetSocketId, pc]) => {
          // 1. Replace video track with screen track
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
          }

          // 2. Add screen audio track if available
          let needsRenegotiation = false;
          if (screenAudioTrack) {
            const audioSender = pc.addTrack(screenAudioTrack, localStreamRef.current || stream);
            screenAudioSendersRef.current[targetSocketId] = audioSender;
            needsRenegotiation = true;
          }

          // 3. Renegotiate if audio m-line was added
          if (needsRenegotiation) {
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

      // When user stops sharing via native browser bar
      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
        console.error('[webrtc] getDisplayMedia failed:', err);
      }
    }
  }, [socket, stopScreenShare]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
      peerConnectionsRef.current = {};
      remoteStreamsMapRef.current = {};
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      pendingPeersRef.current = [];
      screenAudioSendersRef.current = {};
    };
  }, []);

  return {
    localStream,
    remoteStreams,
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
