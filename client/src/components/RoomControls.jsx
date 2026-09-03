/**
 * RoomControls — bottom control bar.
 * Buttons: mic, camera, screen share (host only — opens confirmation modal),
 *          chat, leave.
 *
 * Screen share flow: clicking Share opens ScreenShareModal first (handled by Room.jsx).
 * The audio toggle is now inside the modal, not a separate button.
 */
import './RoomControls.css';

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
  screenAudioEnabled,
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

      {/* Screen share — host only, opens confirmation modal or stops sharing */}
      {isHost && (
        <div className="ctrl-btn-group">
          <div className="ctrl-btn-wrap" title={isSharingScreen ? 'Stop sharing' : 'Share a window or app'}>
            <button
              id="ctrl-screenshare"
              className={`ctrl-btn ${isSharingScreen ? 'ctrl-btn--active' : ''}`}
              onClick={isSharingScreen ? onStopScreenShare : onStartScreenShare}
              aria-pressed={isSharingScreen}
            >
              <span className="ctrl-btn__icon">{isSharingScreen ? '🛑' : '🖥️'}</span>
              <span className="ctrl-btn__label">{isSharingScreen ? 'Stop Share' : 'Share'}</span>
            </button>
          </div>

          {/* Live screen audio indicator — only shown while actively sharing */}
          {isSharingScreen && (
            <div
              className={`ctrl-btn ctrl-btn--small ${screenAudioEnabled ? 'ctrl-btn--active' : 'ctrl-btn--muted'}`}
              title={screenAudioEnabled ? 'Screen audio is being shared' : 'No screen audio'}
            >
              <span className="ctrl-btn__icon">{screenAudioEnabled ? '🔊' : '🔈'}</span>
              <span className="ctrl-btn__label">
                {screenAudioEnabled ? 'Audio On' : 'No Audio'}
              </span>
            </div>
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
