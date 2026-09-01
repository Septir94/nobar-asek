/**
 * Room page — full WebRTC video call experience.
 *
 * Layout modes:
 * - Normal: CSS grid of all video tiles (local + remotes), equal size
 * - Screen share active: screen video large/center + participant thumbnails strip at bottom
 *
 * Phase 3 additions:
 * - Camera toggle (on/off with avatar placeholder)
 * - Window-hint screen share
 * - Sound reactions (👏😮😂❤️🔥) with floating particles
 * - Voice sticker (TTS + floating text badge)
 * - Responsive mobile layout
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSocket, disconnectSocket } from '../services/socket.js';
import { useWebRTC } from '../hooks/useWebRTC.js';
import { useChat } from '../hooks/useChat.js';
import { useReactions } from '../hooks/useReactions.js';
import { useVoiceSticker } from '../hooks/useVoiceSticker.js';
import VideoTile from '../components/VideoTile.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import RoomControls from '../components/RoomControls.jsx';
import ReactionBar from '../components/ReactionBar.jsx';
import FloatingOverlay from '../components/FloatingOverlay.jsx';
import './Room.css';

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();

  // Session data from Phase 1
  const token = sessionStorage.getItem('nobar_token');
  const userId = sessionStorage.getItem('nobar_userId');
  const displayName = sessionStorage.getItem('nobar_displayName') || 'Guest';
  const isHost = sessionStorage.getItem('nobar_isHost') === 'true';

  const [socketReady, setSocketReady] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [activeScreenShare, setActiveScreenShare] = useState(null); // { socketId, isLocal? }
  const screenVideoRef = useRef(null);

  // Socket kept in state so hooks re-render when socket is ready
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);

  // Screen share stream from remote peer
  const [remoteScreenStream, setRemoteScreenStream] = useState(null);

  // setIceConfig arrives after useWebRTC is called — keep in a ref so the
  // socket effect can call it without stale closure issues
  const setIceConfigRef = useRef(null);

  // ── Init socket & join room ─────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      navigate('/', { replace: true });
      return;
    }

    const sock = getSocket(token);
    socketRef.current = sock;
    setSocket(sock);

    const onConnectError = (err) => {
      setJoinError(`Connection failed: ${err.message}`);
    };
    sock.on('connect_error', onConnectError);

    const handleConnect = () => {
      sock.emit('join-room', {}, (res) => {
        if (res?.error) {
          setJoinError(res.error);
          return;
        }
        if (res?.iceServers && setIceConfigRef.current) {
          setIceConfigRef.current(res.iceServers);
        }
        setSocketReady(true);
      });
    };

    if (sock.connected) {
      handleConnect();
    } else {
      sock.once('connect', handleConnect);
    }

    const onStartScreenShare = ({ fromSocketId }) => {
      setActiveScreenShare({ socketId: fromSocketId });
    };
    const onStopScreenShare = () => {
      setActiveScreenShare(null);
      setRemoteScreenStream(null);
    };

    sock.on('start-screen-share', onStartScreenShare);
    sock.on('stop-screen-share', onStopScreenShare);

    return () => {
      sock.off('connect', handleConnect);
      sock.off('connect_error', onConnectError);
      sock.off('start-screen-share', onStartScreenShare);
      sock.off('stop-screen-share', onStopScreenShare);
    };
  }, [token, navigate]);

  // ── WebRTC hook ─────────────────────────────────────────────────────────
  const {
    localStream,
    remoteStreams,
    remoteScreenStreams,  // NEW: dedicated screen share streams per socketId
    micEnabled,
    toggleMic,
    cameraEnabled,
    toggleCamera,
    remoteCameraStates,
    isSharingScreen,
    startScreenShare,
    stopScreenShare,
    setIceConfig,
  } = useWebRTC(socket, socketReady);

  // Sync setIceConfig into the ref so the socket effect can call it
  useEffect(() => {
    setIceConfigRef.current = setIceConfig;
  }, [setIceConfig]);

  // ── Chat hook ───────────────────────────────────────────────────────────
  const { messages, sendMessage } = useChat(socket);

  // ── Reactions hook ──────────────────────────────────────────────────────
  const { particles, sendReaction } = useReactions(socket);

  // ── Voice sticker hook ──────────────────────────────────────────────────
  const { stickers, sendVoiceSticker, MAX_CHARS } = useVoiceSticker(socket);

  // ── Screen share local tracking ─────────────────────────────────────────
  useEffect(() => {
    if (isSharingScreen) {
      setActiveScreenShare({ socketId: socketRef.current?.id, isLocal: true });
    } else {
      setActiveScreenShare((prev) => (prev?.isLocal ? null : prev));
    }
  }, [isSharingScreen]);

  // ── Bind remote screen stream ───────────────────────────────────────────
  // Use dedicated remoteScreenStreams from WebRTC hook (populated via renegotiation
  // + ontrack). Fall back to the camera stream only if no dedicated screen stream
  // is available yet (handles slow renegotiation).
  useEffect(() => {
    if (!activeScreenShare || activeScreenShare.isLocal) return;
    const sid = activeScreenShare.socketId;
    // Prefer dedicated screen stream; fall back to camera stream
    const screenSt = remoteScreenStreams[sid] || remoteStreams[sid]?.stream || null;
    setRemoteScreenStream(screenSt);
  }, [activeScreenShare, remoteScreenStreams, remoteStreams]);

  // ── Bind screen video element ─────────────────────────────────────────────
  // Force a null-then-set cycle to guarantee browser re-reads the srcObject
  // even when the stream object reference is reused.
  useEffect(() => {
    const el = screenVideoRef.current;
    if (!el) return;
    // Force re-bind to trigger browser video reload
    el.srcObject = null;
    el.srcObject = remoteScreenStream || null;
    if (remoteScreenStream) {
      el.play().catch(() => {}); // autoplay might need nudging
    }
  }, [remoteScreenStream]);

  // ── Leave ───────────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    disconnectSocket();
    sessionStorage.clear();
    navigate('/', { replace: true });
  }, [navigate]);

  const handleFullscreen = () => {
    screenVideoRef.current?.requestFullscreen?.();
  };

  const isScreenShareMode = !!activeScreenShare;
  const remoteEntries = Object.entries(remoteStreams);

  // ── Error state ─────────────────────────────────────────────────────────
  if (joinError) {
    return (
      <div className="room room--error">
        <div className="room__error-box">
          <h2>⚠️ Connection Error</h2>
          <p>{joinError}</p>
          <button className="room__error-btn" onClick={handleLeave}>Back to Home</button>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="room">
      {/* Floating emoji reactions + voice sticker badges */}
      <FloatingOverlay particles={particles} stickers={stickers} />

      {/* ── Header ───────────────────────────────────────── */}
      <div className="room__header">
        <div className="room__header-left">
          <span className="room__logo">🎬</span>
          <span className="room__code">{code}</span>
          {isHost && <span className="room__host-badge">Host</span>}
        </div>
        <div className="room__header-right">
          <span className="room__participant-count">
            👥 {1 + remoteEntries.length}
          </span>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────── */}
      <div className={`room__body ${chatOpen ? 'room__body--chat-open' : ''}`}>
        {/* Video area */}
        <div className="room__video-area">
          {!socketReady && (
            <div className="room__connecting">
              <div className="room__spinner" />
              <p>Joining room…</p>
            </div>
          )}

          {socketReady && (
            <>
              {/* ── Screen share layout ── */}
              {isScreenShareMode && (
                <div className="room__screenshare-layout">
                  <div className="room__screen-main">
                    {activeScreenShare?.isLocal ? (
                      <div className="room__screen-video-wrap">
                        <div className="room__screen-label">📺 You are sharing your screen</div>
                      </div>
                    ) : (
                      <div className="room__screen-video-wrap">
                        <video
                          ref={screenVideoRef}
                          autoPlay
                          playsInline
                          className="room__screen-video"
                        />
                        <button
                          className="room__fullscreen-btn"
                          onClick={handleFullscreen}
                          title="Fullscreen"
                        >
                          ⛶
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Thumbnail strip */}
                  <div className="room__thumbnail-strip">
                    {localStream && (
                      <VideoTile
                        stream={localStream}
                        displayName={displayName}
                        muted
                        isLocal
                        cameraOn={cameraEnabled}
                        className="video-tile--thumbnail"
                      />
                    )}
                    {remoteEntries.map(([sid, { stream, displayName: dn }]) => (
                      <VideoTile
                        key={sid}
                        stream={stream}
                        displayName={dn}
                        cameraOn={remoteCameraStates[sid] !== false}
                        className="video-tile--thumbnail"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Normal grid layout ── */}
              {!isScreenShareMode && (
                <div className={`room__grid room__grid--${Math.min(1 + remoteEntries.length, 4)}`}>
                  {localStream && (
                    <VideoTile
                      stream={localStream}
                      displayName={displayName}
                      muted
                      isLocal
                      cameraOn={cameraEnabled}
                    />
                  )}
                  {remoteEntries.map(([sid, { stream, displayName: dn }]) => (
                    <VideoTile
                      key={sid}
                      stream={stream}
                      displayName={dn}
                      cameraOn={remoteCameraStates[sid] !== false}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Chat sidebar */}
        {chatOpen && (
          <div className="room__chat">
            <ChatPanel
              messages={messages}
              onSend={sendMessage}
              currentUserId={userId}
            />
          </div>
        )}
      </div>

      {/* ── Reaction bar ─────────────────────────────────── */}
      <ReactionBar
        onSendReaction={sendReaction}
        onSendVoiceSticker={sendVoiceSticker}
        maxChars={MAX_CHARS}
      />

      {/* ── Controls bar ─────────────────────────────────── */}
      <RoomControls
        micEnabled={micEnabled}
        onToggleMic={toggleMic}
        cameraEnabled={cameraEnabled}
        onToggleCamera={toggleCamera}
        isSharingScreen={isSharingScreen}
        onStartScreenShare={startScreenShare}
        onStopScreenShare={stopScreenShare}
        isHost={isHost}
        onLeave={handleLeave}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((v) => !v)}
      />
    </div>
  );
}
