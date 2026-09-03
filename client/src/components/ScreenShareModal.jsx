/**
 * ScreenShareModal — confirmation dialog before starting screen share.
 *
 * - Warns about what will be shared (window/tab/screen)
 * - Audio toggle
 * - Mobile Android: warns that entire screen will be shared
 * - Mobile iOS: shows "not available" message
 */
import { useState, useEffect } from 'react';
import './ScreenShareModal.css';

/**
 * Detect device/platform capabilities.
 */
function detectPlatform() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid || /Mobi/.test(ua);

  // getDisplayMedia support check
  const hasGetDisplayMedia = typeof navigator?.mediaDevices?.getDisplayMedia === 'function';

  return { isIOS, isAndroid, isMobile, hasGetDisplayMedia };
}

/**
 * @param {{
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onConfirm: (includeAudio: boolean) => void,
 *   includeAudio: boolean,
 *   onToggleAudio: () => void,
 * }} props
 */
export default function ScreenShareModal({
  isOpen,
  onClose,
  onConfirm,
  includeAudio,
  onToggleAudio,
}) {
  const [platform, setPlatform] = useState(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  if (!isOpen || !platform) return null;

  // iOS: screen share not available
  if (platform.isIOS) {
    return (
      <div className="ss-modal__overlay" onClick={onClose}>
        <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ss-modal__header">
            <span className="ss-modal__icon">📱</span>
            <h3 className="ss-modal__title">Screen Share Not Available</h3>
          </div>
          <div className="ss-modal__body">
            <div className="ss-modal__warning ss-modal__warning--info">
              <span className="ss-modal__warning-icon">ℹ️</span>
              <p>
                Screen sharing is <strong>not supported</strong> on iOS Safari or iOS browsers.
                This is a limitation of iOS — please use a desktop/laptop browser to share your screen.
              </p>
            </div>
          </div>
          <div className="ss-modal__actions">
            <button className="ss-modal__btn ss-modal__btn--secondary" onClick={onClose}>
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Android: can share but with warning
  if (platform.isAndroid && platform.hasGetDisplayMedia) {
    return (
      <div className="ss-modal__overlay" onClick={onClose}>
        <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ss-modal__header">
            <span className="ss-modal__icon">🖥️</span>
            <h3 className="ss-modal__title">Share Your Screen</h3>
          </div>
          <div className="ss-modal__body">
            <div className="ss-modal__warning ss-modal__warning--caution">
              <span className="ss-modal__warning-icon">⚠️</span>
              <p>
                On mobile devices, your <strong>entire screen</strong> will be shared — including notifications,
                status bar, and any app you switch to.
              </p>
            </div>

            <div className="ss-modal__tips">
              <p className="ss-modal__tip">💡 <strong>Tips before sharing:</strong></p>
              <ul>
                <li>Enable <strong>Do Not Disturb</strong> to hide notifications</li>
                <li>Close any sensitive apps or chats</li>
                <li>Everything on your screen will be visible to other participants</li>
              </ul>
            </div>

            <div className="ss-modal__option">
              <label className="ss-modal__toggle">
                <input
                  type="checkbox"
                  checked={includeAudio}
                  onChange={onToggleAudio}
                />
                <span className="ss-modal__toggle-slider" />
                <span className="ss-modal__toggle-label">
                  {includeAudio ? '🔊 Share device audio' : '🔈 No device audio'}
                </span>
              </label>
            </div>
          </div>
          <div className="ss-modal__actions">
            <button className="ss-modal__btn ss-modal__btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="ss-modal__btn ss-modal__btn--primary"
              onClick={() => onConfirm(includeAudio)}
            >
              🖥️ Start Sharing
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Mobile without getDisplayMedia support
  if (platform.isMobile && !platform.hasGetDisplayMedia) {
    return (
      <div className="ss-modal__overlay" onClick={onClose}>
        <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ss-modal__header">
            <span className="ss-modal__icon">📱</span>
            <h3 className="ss-modal__title">Screen Share Not Available</h3>
          </div>
          <div className="ss-modal__body">
            <div className="ss-modal__warning ss-modal__warning--info">
              <span className="ss-modal__warning-icon">ℹ️</span>
              <p>
                Screen sharing is <strong>not supported</strong> on your mobile browser.
                Please use a desktop or laptop browser to share your screen.
              </p>
            </div>
          </div>
          <div className="ss-modal__actions">
            <button className="ss-modal__btn ss-modal__btn--secondary" onClick={onClose}>
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Desktop: normal confirmation
  return (
    <div className="ss-modal__overlay" onClick={onClose}>
      <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ss-modal__header">
          <span className="ss-modal__icon">🖥️</span>
          <h3 className="ss-modal__title">Share Your Screen</h3>
        </div>
        <div className="ss-modal__body">
          <p className="ss-modal__desc">
            You're about to share a window, tab, or your entire screen with everyone in the room.
          </p>

          <div className="ss-modal__warning ss-modal__warning--tip">
            <span className="ss-modal__warning-icon">💡</span>
            <p>
              <strong>Tip:</strong> Choose "Window" or "Chrome Tab" for best privacy —
              sharing your entire screen will show everything including notifications.
            </p>
          </div>

          <div className="ss-modal__option">
            <label className="ss-modal__toggle">
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={onToggleAudio}
              />
              <span className="ss-modal__toggle-slider" />
              <span className="ss-modal__toggle-label">
                {includeAudio ? '🔊 Share system/tab audio' : '🔈 No system audio (mic only)'}
              </span>
            </label>
            <span className="ss-modal__toggle-hint">
              Audio sharing works best when sharing a browser tab
            </span>
          </div>
        </div>
        <div className="ss-modal__actions">
          <button className="ss-modal__btn ss-modal__btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="ss-modal__btn ss-modal__btn--primary"
            onClick={() => onConfirm(includeAudio)}
          >
            🖥️ Start Sharing
          </button>
        </div>
      </div>
    </div>
  );
}
