/**
 * VideoTile — renders a single video element bound to a MediaStream.
 * When `cameraOn` is false, shows an avatar/initials placeholder overlay.
 * Handles mobile autoplay unlocking and playsInline attributes.
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
    const el = videoRef.current;
    if (!el) return;

    if (stream) {
      el.srcObject = stream;
      el.play().catch((err) => {
        // Unlock on mobile touch if blocked by autoplay policy
        const unlock = () => {
          el.play().catch(() => {});
          window.removeEventListener('touchstart', unlock);
          window.removeEventListener('click', unlock);
        };
        window.addEventListener('touchstart', unlock, { once: true });
        window.addEventListener('click', unlock, { once: true });
      });
    } else {
      el.srcObject = null;
    }
  }, [stream]);

  const initials = getInitials(displayName);

  return (
    <div className={`video-tile ${className} ${isLocal ? 'video-tile--local' : ''} ${!cameraOn ? 'video-tile--cam-off' : ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        webkit-playsinline="true"
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
