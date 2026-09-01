/**
 * ScreenVideo — dedicated video player component for screen share streams.
 * Handles autoPlay, playsInline, and srcObject assignment reliably on mount.
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
        console.warn('[ScreenVideo] play error:', err);
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
      muted={muted}
      className={className}
    />
  );
}
