/**
 * ScreenVideo — dedicated video player component for screen share streams.
 * Handles autoPlay, playsInline, mobile touch unlocking, and srcObject assignment reliably on mount.
 */

import { useEffect, useRef } from 'react';

export default function ScreenVideo({
  stream,
  muted = false,
  className = 'room__screen-video',
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

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      webkit-playsinline="true"
      muted={muted}
      className={className}
    />
  );
}
