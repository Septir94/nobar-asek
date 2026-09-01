/**
 * VideoTile — renders a single video element bound to a MediaStream.
 * When `cameraOn` is false, shows an avatar/initials placeholder overlay.
 */

import { useEffect, useRef } from 'react';
import './VideoTile.css';

/** Get initials (up to 2 chars) from a display name. */
function getInitials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function VideoTile({
  stream,
  displayName,
  muted = false,
  isLocal = false,
  cameraOn = true,
  className = '',
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const initials = getInitials(displayName);

  return (
    <div className={`video-tile ${className} ${isLocal ? 'video-tile--local' : ''} ${!cameraOn ? 'video-tile--cam-off' : ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="video-tile__video"
      />

      {/* Avatar overlay shown when camera is off */}
      {!cameraOn && (
        <div className="video-tile__avatar" aria-label={`${displayName} camera off`}>
          <div className="video-tile__avatar-circle">
            {initials || '?'}
          </div>
          <span className="video-tile__cam-off-badge">📷 Off</span>
        </div>
      )}

      <div className="video-tile__label">
        {displayName}
        {isLocal && <span className="video-tile__you"> (You)</span>}
        {!cameraOn && <span className="video-tile__cam-indicator"> 📷</span>}
      </div>
    </div>
  );
}
