/**
 * RoomControls — bottom control bar.
 * Buttons: mic, camera, screen share (host only + getDisplayMedia check),
 *          screen audio toggle, chat, leave.
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
  includeScreenAudio,
  onToggleScreenAudio,
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

      {/* Screen share — host only */}
      {isHost && (
        <div className="ctrl-btn-group">
          <div className="ctrl-btn-wrap" title={!canShareScreen ? 'Screen share not available on this device' : (isSharingScreen ? 'Stop sharing' : 'Share a window or app')}>
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
          </div>

          {/* Screen audio toggle — shown next to share button */}
          <button
            id="ctrl-screen-audio"
            className={`ctrl-btn ctrl-btn--small ${includeScreenAudio ? 'ctrl-btn--active' : 'ctrl-btn--muted'}`}
            onClick={onToggleScreenAudio}
            disabled={isSharingScreen}
            title={
              isSharingScreen
                ? (screenAudioEnabled ? 'Screen audio is being shared' : 'Screen audio not available — restart share to change')
                : (includeScreenAudio ? 'Screen audio will be shared (click to disable)' : 'Screen audio will NOT be shared (click to enable)')
            }
          >
            <span className="ctrl-btn__icon">{includeScreenAudio ? '🔊' : '🔈'}</span>
            <span className="ctrl-btn__label">
              {isSharingScreen
                ? (screenAudioEnabled ? 'Audio On' : 'No Audio')
                : (includeScreenAudio ? 'Audio' : 'No Audio')
              }
            </span>
          </button>
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
