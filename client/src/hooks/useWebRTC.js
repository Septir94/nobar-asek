/**
 * useWebRTC — custom hook managing the full WebRTC mesh lifecycle.
 *
 * Responsibilities:
 * - Acquire local camera/mic via getUserMedia
 * - On 'existing-users': initiate RTCPeerConnection + offer to each existing peer
 * - On 'user-joined': wait for their offer
 * - Forward offer/answer/ICE through socket
 * - Handle ontrack to surface remote streams
 * - Toggle mic mute
 * - Screen share (replaceTrack, no renegotiation)
 *
 * Returns refs and state that Room.jsx binds to <video> elements.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const ICE_CONFIG_FALLBACK = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
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

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // socketId → { stream, displayName, userId }
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

      // Remote track arrived → update state
      pc.ontrack = ({ streams }) => {
        if (streams[0]) {
          updateRemoteStream(targetSocketId, {
            stream: streams[0],
            displayName,
            userId,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
          console.log(`[webrtc] Peer ${targetSocketId} state: ${pc.connectionState}`);
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
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (err) {
        console.error('[webrtc] getUserMedia failed:', err);
      }
    }

    initMedia();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // ── Socket event handlers ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !enabled || !localStream) return;

    // ── existing-users: we are the new joiner, initiate offers to each ────
    const onExistingUsers = async (users) => {
      for (const { socketId, displayName, userId } of users) {
        const pc = createPeerConnection(socketId, displayName, userId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { targetSocketId: socketId, sdp: offer });
      }
    };

    // ── user-joined: a new user connected, wait for their offer ───────────
    const onUserJoined = ({ socketId, displayName, userId }) => {
      // Pre-create the PC so it's ready when offer arrives
      createPeerConnection(socketId, displayName, userId);
    };

    // ── offer received: answer it ──────────────────────────────────────────
    const onOffer = async ({ fromSocketId, fromDisplayName, fromUserId, sdp }) => {
      let pc = peerConnectionsRef.current[fromSocketId];
      if (!pc) {
        pc = createPeerConnection(fromSocketId, fromDisplayName, fromUserId);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      // Flush any ICE candidates that arrived before the remote description
      const queued = pendingCandidatesRef.current[fromSocketId] || [];
      delete pendingCandidatesRef.current[fromSocketId];
      for (const c of queued) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { targetSocketId: fromSocketId, sdp: answer });
    };

    // ── answer received ────────────────────────────────────────────────────
    const onAnswer = async ({ fromSocketId, sdp }) => {
      const pc = peerConnectionsRef.current[fromSocketId];
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      // Flush any ICE candidates that arrived before the answer
      const queued = pendingCandidatesRef.current[fromSocketId] || [];
      delete pendingCandidatesRef.current[fromSocketId];
      for (const c of queued) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
      }
    };

    // ── ICE candidate received ─────────────────────────────────────────────
    const onIceCandidate = async ({ fromSocketId, candidate }) => {
      const pc = peerConnectionsRef.current[fromSocketId];
      if (!pc) return;
      // If remote description not set yet, buffer the candidate
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
    };

    // ── camera-toggle from remote peer ──────────────────────────────────────
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
  }, [socket, enabled, localStream, createPeerConnection, removeRemoteStream]);

  // ── Store TURN ice config when join-room callback provides it ─────────────
  const setIceConfig = useCallback((iceServers) => {
    // iceServers is an array from the server — spread it alongside the STUN fallback
    iceConfigRef.current = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        ...(Array.isArray(iceServers) ? iceServers : [iceServers]),
      ],
    };
  }, []);

  // ── Toggle mic ────────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setMicEnabled(audioTrack.enabled);
  }, []);

  // ── Toggle camera ────────────────────────────────────────────────────────────
  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;
    // Disable, not stop — so permission is retained and can be re-enabled
    videoTrack.enabled = !videoTrack.enabled;
    const newState = videoTrack.enabled;
    setCameraEnabled(newState);
    // Notify peers so they can show/hide the avatar placeholder
    if (socket) socket.emit('camera-toggle', { cameraOn: newState });
  }, [socket]);

  // ── Screen share ────────────────────────────────────────────────────────────────
  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // Hint: prefer a single window over the entire desktop.
          // Browser may still offer other options — user has final choice.
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

      // Replace video track in ALL peer connections (no renegotiation needed)
      Object.values(peerConnectionsRef.current).forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      // Notify others
      socket.emit('start-screen-share');

      // When user stops sharing via browser UI
      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error('[webrtc] getDisplayMedia failed:', err);
    }
  }, [socket]);

  const stopScreenShare = useCallback(() => {
    if (!screenStreamRef.current) return;

    screenStreamRef.current.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsSharingScreen(false);

    // Restore camera track in all peer connections
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraTrack) {
      Object.values(peerConnectionsRef.current).forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(cameraTrack);
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
    startScreenShare,
    stopScreenShare,
    setIceConfig,
  };
}
