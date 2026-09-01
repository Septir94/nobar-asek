/**
 * RoomControls — bottom control bar.
 * Buttons: mic, camera, screen share (host only + getDisplayMedia check), chat, leave.
 */
import './RoomControls.css';

const canShareScreen = typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getDisplayMedia === 'function';

export default function RoomControls({
  micEnabled,
  onToggleMic,
  cameraEnabled,
  onToggleCamera,
  isSharingScreen,
  onStartScreenShare,
  onStopScreenShare,
  isHost,
  onLeave,
  chatOpen,
  onToggleChat,
}) {
  return (
    <div className="room-controls">
      {/* Mic toggle */}
      <button
        id="ctrl-mic"
        className={`ctrl-btn ${!micEnabled ? 'ctrl-btn--danger' : ''}`}
        onClick={onToggleMic}
        title={micEnabled ? 'Mute mic' : 'Unmute mic'}
        aria-pressed={!micEnabled}
      >
        <span className="ctrl-btn__icon">{micEnabled ? '🎙️' : '🔇'}</span>
        <span className="ctrl-btn__label">{micEnabled ? 'Mute' : 'Unmute'}</span>
      </button>

      {/* Camera toggle */}
      <button
        id="ctrl-camera"
        className={`ctrl-btn ${!cameraEnabled ? 'ctrl-btn--danger' : ''}`}
        onClick={onToggleCamera}
        title={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
        aria-pressed={!cameraEnabled}
      >
        <span className="ctrl-btn__icon">{cameraEnabled ? '📷' : '📵'}</span>
        <span className="ctrl-btn__label">{cameraEnabled ? 'Camera' : 'Cam Off'}</span>
      </button>

      {/* Screen share — host only */}
      {isHost && (
        <div className="ctrl-btn-wrap" title={!canShareScreen ? 'Screen share not available on this device' : (isSharingScreen ? 'Stop sharing' : 'Share a window or app (browser may also offer full screen)')}>
          <button
            id="ctrl-screenshare"
            className={`ctrl-btn ${isSharingScreen ? 'ctrl-btn--active' : ''}`}
            onClick={isSharingScreen ? onStopScreenShare : onStartScreenShare}
            disabled={!canShareScreen}
            aria-pressed={isSharingScreen}
          >
            <span className="ctrl-btn__icon">{isSharingScreen ? '🛑' : '🖥️'}</span>
            <span className="ctrl-btn__label">{isSharingScreen ? 'Stop Share' : 'Share'}</span>
          </button>
          {!isSharingScreen && canShareScreen && (
            <span className="ctrl-btn__hint">Window recommended</span>
          )}
        </div>
      )}

      {/* Chat toggle */}
      <button
        id="ctrl-chat"
        className={`ctrl-btn ${chatOpen ? 'ctrl-btn--active' : ''}`}
        onClick={onToggleChat}
        title="Toggle chat"
        aria-pressed={chatOpen}
      >
        <span className="ctrl-btn__icon">💬</span>
        <span className="ctrl-btn__label">Chat</span>
      </button>

      {/* Leave */}
      <button
        id="ctrl-leave"
        className="ctrl-btn ctrl-btn--leave"
        onClick={onLeave}
        title="Leave room"
      >
        <span className="ctrl-btn__icon">📵</span>
        <span className="ctrl-btn__label">Leave</span>
      </button>
    </div>
  );
}
