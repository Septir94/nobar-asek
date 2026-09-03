/**
 * useWebRTC — custom hook managing the full WebRTC mesh lifecycle.
 *
 * Responsibilities:
 * - Acquire local camera/mic via getUserMedia with graceful mobile multi-stage fallback
 * - Pre-check and track media permission state for UI feedback (blocked / prompt / granted)
 * - Unified audio mixing for screen sharing: combines mic voice + screen audio into a single
 *   synchronized track so late-joining participants hear screen audio immediately upon entry.
 * - Maintain unified remote MediaStreams per peer containing video + all audio tracks
 * - Handle screen sharing (video replaceTrack + audio replaceTrack)
 * - Provide host preview of the screen stream
 * - Process existing users from socket event AND join-room callback safely without race conditions
 * - ICE restart and renegotiation after late track addition
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
  const audioMixerContextRef = useRef(null);
  const mixedAudioTrackRef = useRef(null);
  const peerConnectionsRef = useRef({}); // socketId → RTCPeerConnection
  const remoteStreamsMapRef = useRef({}); // socketId → MediaStream
  const iceConfigRef = useRef(ICE_CONFIG_FALLBACK);
  const pendingCandidatesRef = useRef({}); // socketId → RTCIceCandidateInit[]
  const pendingPeersRef = useRef([]); // { socketId, displayName, userId, isOfferer }[]

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // socketId → { stream, displayName, userId }
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [remoteCameraStates, setRemoteCameraStates] = useState({}); // socketId → boolean
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [screenAudioEnabled, setScreenAudioEnabled] = useState(false);

  // Media permission tracking for UI feedback
  // 'checking' | 'granted' | 'denied' | 'prompt' | 'unavailable'
  const [mediaPermissionState, setMediaPermissionState] = useState('checking');
  // Specific error reason for denied state
  const [mediaErrorReason, setMediaErrorReason] = useState(''); // 'blocked' | 'not-found' | 'not-allowed' | 'brave-shield' | ''
  // Suppress renegotiation during batch track additions
  const suppressNegotiationRef = useRef(false);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getActiveAudioTrack = useCallback(() => {
    if (mixedAudioTrackRef.current) {
      return mixedAudioTrackRef.current;
    }
    return localStreamRef.current?.getAudioTracks()[0] || null;
  }, []);

  const getActiveVideoTrack = useCallback(() => {
    if (screenStreamRef.current) {
      return screenStreamRef.current.getVideoTracks()[0] || null;
    }
    return localStreamRef.current?.getVideoTracks()[0] || null;
  }, []);

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

      // Add active audio track (either mixed mic+screen audio, or mic only)
      const audioTrack = getActiveAudioTrack();
      if (audioTrack) {
        pc.addTrack(audioTrack, localStreamRef.current || new MediaStream([audioTrack]));
      }

      // Add active video track (either screen or camera)
      const videoTrack = getActiveVideoTrack();
      if (videoTrack) {
        pc.addTrack(videoTrack, localStreamRef.current || new MediaStream([videoTrack]));
      }

      // ICE candidate → send to remote
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          socket.emit('ice-candidate', { targetSocketId, candidate });
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[webrtc] ICE state ${targetSocketId}: ${pc.iceConnectionState}`);
        // ICE restart on failure — attempt to re-establish connectivity
        if (pc.iceConnectionState === 'failed') {
          console.warn(`[webrtc] ICE failed with ${targetSocketId}, attempting ICE restart...`);
          try {
            pc.restartIce();
            // After restartIce(), onnegotiationneeded fires automatically
          } catch (err) {
            console.error('[webrtc] ICE restart failed:', err);
          }
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[webrtc] Conn state ${targetSocketId}: ${pc.connectionState}`);
        if (pc.connectionState === 'failed') {
          console.warn(`[webrtc] Connection failed with ${targetSocketId}, attempting recovery...`);
          try {
            pc.restartIce();
          } catch (err) {
            console.error('[webrtc] Recovery restart failed:', err);
          }
        }
      };

      // Renegotiation handler — fires after addTrack, restartIce, etc.
      pc.onnegotiationneeded = async () => {
        if (suppressNegotiationRef.current) return;
        console.log(`[webrtc] Negotiation needed with ${targetSocketId}`);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { targetSocketId, sdp: offer });
        } catch (err) {
          console.error('[webrtc] Renegotiation offer failed:', err);
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
            // Remove old video tracks so we only have 1 active video track
            pStream.getVideoTracks().forEach((oldTrack) => {
              if (oldTrack.id !== track.id) {
                pStream.removeTrack(oldTrack);
              }
            });
          } else if (track.kind === 'audio') {
            // Remove old audio tracks so we only have 1 active audio track
            pStream.getAudioTracks().forEach((oldTrack) => {
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
    [socket, getActiveAudioTrack, getActiveVideoTrack, updateRemoteStream]
  );

  // ── Pre-check media permissions ────────────────────────────────────────────
  // Detects blocked/denied status BEFORE getUserMedia so UI can show instructions
  useEffect(() => {
    if (!enabled) return;

    async function checkPermissions() {
      try {
        // Some browsers (Chrome, Edge) support permissions.query for camera/mic
        if (navigator.permissions?.query) {
          const [cam, mic] = await Promise.allSettled([
            navigator.permissions.query({ name: 'camera' }),
            navigator.permissions.query({ name: 'microphone' }),
          ]);

          const camState = cam.status === 'fulfilled' ? cam.value.state : 'prompt';
          const micState = mic.status === 'fulfilled' ? mic.value.state : 'prompt';

          if (camState === 'denied' && micState === 'denied') {
            setMediaPermissionState('denied');
            setMediaErrorReason('blocked');
            return;
          }
          if (camState === 'denied' || micState === 'denied') {
            // One is denied but the other might work — still try getUserMedia
            console.warn('[webrtc] Partial permission denial detected (cam:', camState, 'mic:', micState, ')');
          }
        }
      } catch (_) {
        // permissions.query not supported — fall through to getUserMedia
      }
    }

    checkPermissions();
  }, [enabled]);

  // ── Init local media with multi-stage mobile fallback ─────────────────────
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    /**
     * Classify getUserMedia errors for UI feedback.
     */
    function classifyMediaError(err) {
      // Brave browser detection: Brave blocks getUserMedia via Shield
      const isBrave = navigator.brave?.isBrave || navigator.userAgent.includes('Brave');

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        if (isBrave) {
          return 'brave-shield';
        }
        return 'not-allowed';
      }
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        return 'not-found';
      }
      if (err.name === 'NotReadableError' || err.name === 'AbortError') {
        return 'blocked'; // Another app is using the camera/mic
      }
      return 'blocked';
    }

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
        setMediaPermissionState('granted');
        setMediaErrorReason('');
        return;
      } catch (err) {
        console.warn('[webrtc] getUserMedia high-res failed, trying basic video+audio:', err);
      }

      // Stage 2: Try basic unconstrained video + audio
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
        setMediaPermissionState('granted');
        setMediaErrorReason('');
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
        setMediaPermissionState('granted');
        setMediaErrorReason('');
      } catch (audioErr) {
        console.error('[webrtc] All getUserMedia fallbacks failed (permissions denied or no devices):', audioErr);

        // Classify the error for specific UI feedback
        const reason = classifyMediaError(audioErr);
        setMediaPermissionState('denied');
        setMediaErrorReason(reason);

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
   * CRITICAL FIX: After adding tracks to existing PCs, trigger renegotiation so the remote
   * side learns about the new tracks. Without this, joining users would have silent/blank feeds.
   */
  useEffect(() => {
    if (!localStream || !socket) return;

    // 1. Attach local tracks to any existing peer connections created before localStream was ready
    //    AND trigger renegotiation for each PC that gets new tracks
    const pcsNeedingRenegotiation = [];

    // Suppress onnegotiationneeded during batch addTrack to avoid multiple simultaneous offers
    suppressNegotiationRef.current = true;

    Object.entries(peerConnectionsRef.current).forEach(([targetSocketId, pc]) => {
      const senders = pc.getSenders();
      const hasVideo = senders.some((s) => s.track?.kind === 'video');
      const hasAudio = senders.some((s) => s.track?.kind === 'audio');

      const videoTrack = getActiveVideoTrack();
      const audioTrack = getActiveAudioTrack();

      let added = false;
      if (!hasAudio && audioTrack) {
        pc.addTrack(audioTrack, localStream);
        added = true;
      }
      if (!hasVideo && videoTrack) {
        pc.addTrack(videoTrack, localStream);
        added = true;
      }

      if (added) {
        pcsNeedingRenegotiation.push({ targetSocketId, pc });
      }
    });

    suppressNegotiationRef.current = false;

    // Trigger renegotiation for PCs that received new tracks
    pcsNeedingRenegotiation.forEach(async ({ targetSocketId, pc }) => {
      try {
        console.log(`[webrtc] Renegotiating with ${targetSocketId} after late track add`);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { targetSocketId, sdp: offer });
      } catch (err) {
        console.error(`[webrtc] Renegotiation failed for ${targetSocketId}:`, err);
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
  }, [localStream, socket, getActiveAudioTrack, getActiveVideoTrack, createPeerConnection]);

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

    // ── offer received: answer immediately ─────────────────────────────────
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

  // ── Toggle camera (Physically releases hardware and turns off webcam light) ─
  const toggleCamera = useCallback(async () => {
    if (cameraEnabled) {
      // Turn OFF: physically stop the camera hardware track so webcam light turns off
      if (localStreamRef.current) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.stop(); // Releases hardware & turns off webcam light
          localStreamRef.current.removeTrack(videoTrack);
        }
      }
      setCameraEnabled(false);
      if (socket) socket.emit('camera-toggle', { cameraOn: false });
    } else {
      // Turn ON: request a new camera stream from the browser
      try {
        let newVideoStream;
        try {
          newVideoStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          });
        } catch (_) {
          newVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        const newVideoTrack = newVideoStream.getVideoTracks()[0];
        if (newVideoTrack) {
          if (!localStreamRef.current) {
            localStreamRef.current = new MediaStream();
          }
          localStreamRef.current.addTrack(newVideoTrack);
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

          // If not currently sharing screen, update video sender on all peer connections
          if (!screenStreamRef.current) {
            Object.values(peerConnectionsRef.current).forEach(async (pc) => {
              const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
              if (videoSender) {
                await videoSender.replaceTrack(newVideoTrack);
              } else {
                pc.addTrack(newVideoTrack, localStreamRef.current);
              }
            });
          }
        }

        setCameraEnabled(true);
        if (socket) socket.emit('camera-toggle', { cameraOn: true });
      } catch (err) {
        console.error('[webrtc] Failed to re-enable camera:', err);
      }
    }
  }, [cameraEnabled, socket]);

  // ── Stop Screen share ─────────────────────────────────────────────────────
  const stopScreenShare = useCallback(() => {
    if (!screenStreamRef.current) return;

    screenStreamRef.current.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsSharingScreen(false);
    setScreenAudioEnabled(false);

    // Clean up audio mixer
    if (audioMixerContextRef.current) {
      audioMixerContextRef.current.close().catch(() => {});
      audioMixerContextRef.current = null;
    }
    mixedAudioTrackRef.current = null;

    // Restore camera video track + mic audio track on all peer connections
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    const micTrack = localStreamRef.current?.getAudioTracks()[0];

    Object.values(peerConnectionsRef.current).forEach(async (pc) => {
      const senders = pc.getSenders();

      // 1. Restore video track
      const videoSender = senders.find((s) => s.track?.kind === 'video');
      if (videoSender && cameraTrack) {
        await videoSender.replaceTrack(cameraTrack);
      }

      // 2. Restore mic audio track
      const audioSender = senders.find((s) => s.track?.kind === 'audio');
      if (audioSender && micTrack) {
        await audioSender.replaceTrack(micTrack);
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

      const screenVideoTrack = stream.getVideoTracks()[0];
      const screenAudioTrack = hasAudio ? stream.getAudioTracks()[0] : null;
      const micAudioTrack = localStreamRef.current?.getAudioTracks()[0];

      // Mix mic audio + screen audio into a unified track
      if (screenAudioTrack && micAudioTrack) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          audioMixerContextRef.current = ctx;

          const micSource = ctx.createMediaStreamSource(new MediaStream([micAudioTrack]));
          const screenSource = ctx.createMediaStreamSource(new MediaStream([screenAudioTrack]));
          const dest = ctx.createMediaStreamDestination();

          micSource.connect(dest);
          screenSource.connect(dest);

          mixedAudioTrackRef.current = dest.stream.getAudioTracks()[0];
        } catch (err) {
          console.warn('[webrtc] Web Audio mixer failed, using screen audio track directly:', err);
          mixedAudioTrackRef.current = screenAudioTrack;
        }
      } else if (screenAudioTrack) {
        mixedAudioTrackRef.current = screenAudioTrack;
      }

      const activeAudioToSend = mixedAudioTrackRef.current || micAudioTrack;

      // Replace video and audio tracks on ALL active peer connections
      const trackUpdatePromises = Object.values(peerConnectionsRef.current).map(async (pc) => {
        const senders = pc.getSenders();

        // 1. Replace video track with screen track
        const videoSender = senders.find((s) => s.track?.kind === 'video');
        if (videoSender && screenVideoTrack) {
          await videoSender.replaceTrack(screenVideoTrack);
        }

        // 2. Replace audio track with mixed (mic + screen) audio
        const audioSender = senders.find((s) => s.track?.kind === 'audio');
        if (audioSender && activeAudioToSend) {
          await audioSender.replaceTrack(activeAudioToSend);
        }
      });

      await Promise.allSettled(trackUpdatePromises);
      socket.emit('start-screen-share');

      // When user stops sharing via native browser bar
      screenVideoTrack.onended = () => {
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
      if (audioMixerContextRef.current) {
        audioMixerContextRef.current.close().catch(() => {});
        audioMixerContextRef.current = null;
      }
      mixedAudioTrackRef.current = null;
      pendingPeersRef.current = [];
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
    mediaPermissionState,
    mediaErrorReason,
  };
}
