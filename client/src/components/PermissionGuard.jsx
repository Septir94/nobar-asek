/**
 * PermissionGuard — shows actionable permission banners when camera/mic
 * access is blocked or unavailable.
 *
 * Detects browser type (Brave, Chrome, Firefox, Safari) and provides
 * specific step-by-step instructions for unblocking permissions.
 */
import { useState, useCallback } from 'react';
import './PermissionGuard.css';

/**
 * Detect the user's browser for tailored instructions.
 */
function detectBrowser() {
  const ua = navigator.userAgent;
  // Brave sets navigator.brave (async) — check UA fallback too
  if (navigator.brave?.isBrave || ua.includes('Brave')) return 'brave';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  if (ua.includes('Chrome')) return 'chrome';
  return 'unknown';
}

/**
 * Get browser-specific instructions for re-enabling camera/mic.
 */
function getInstructions(browser, errorReason) {
  if (errorReason === 'not-found') {
    return {
      title: '📷 No Camera or Microphone Detected',
      icon: '🔌',
      steps: [
        'Make sure your camera and microphone are properly connected.',
        'Try unplugging and re-plugging your webcam or headset.',
        'Check if another app is currently using the camera (close Zoom, Discord, etc.).',
        'Restart your browser and try again.',
      ],
    };
  }

  if (errorReason === 'brave-shield' || browser === 'brave') {
    return {
      title: '🛡️ Brave Shield is Blocking Camera & Mic',
      icon: '🦁',
      steps: [
        'Click the Brave Shield icon (🛡️) in the address bar.',
        'Click "Advanced controls" at the bottom.',
        'Set "Block fingerprinting" to "Allow fingerprinting".',
        'Or: Click the lock icon 🔒 next to the URL → Site settings → Allow Camera & Microphone.',
        'Reload this page after changing settings.',
      ],
    };
  }

  if (browser === 'chrome' || browser === 'edge') {
    return {
      title: '🔒 Camera & Microphone Blocked',
      icon: '🔓',
      steps: [
        'Click the lock icon 🔒 (or tune icon 🎛️) next to the URL in the address bar.',
        'Find "Camera" and "Microphone" → set both to "Allow".',
        'Click "Reset permissions" if the options are grayed out.',
        'Reload this page after changing settings.',
      ],
    };
  }

  if (browser === 'firefox') {
    return {
      title: '🔒 Camera & Microphone Blocked',
      icon: '🔓',
      steps: [
        'Click the lock icon 🔒 next to the URL.',
        'Click "Connection secure" → "More Information".',
        'Go to "Permissions" tab → find "Use the Camera" and "Use the Microphone".',
        'Uncheck "Use Default" and select "Allow".',
        'Reload this page.',
      ],
    };
  }

  if (browser === 'safari') {
    return {
      title: '🔒 Camera & Microphone Blocked',
      icon: '🔓',
      steps: [
        'Go to Safari menu → Settings (or Preferences).',
        'Click "Websites" tab.',
        'Select "Camera" and "Microphone" in the sidebar.',
        'Find this site and set both to "Allow".',
        'Reload this page.',
      ],
    };
  }

  // Generic fallback
  return {
    title: '🔒 Camera & Microphone Access Required',
    icon: '🔓',
    steps: [
      'Click the lock or settings icon next to the URL in your browser.',
      'Find "Camera" and "Microphone" permissions.',
      'Change both to "Allow".',
      'Reload the page and try again.',
    ],
  };
}

/**
 * @param {{ permissionState: string, errorReason: string }} props
 */
export default function PermissionGuard({ permissionState, errorReason }) {
  const [dismissed, setDismissed] = useState(false);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  // Don't show if granted, checking, or dismissed
  if (permissionState === 'granted' || permissionState === 'checking' || dismissed) {
    return null;
  }

  const browser = detectBrowser();
  const info = getInstructions(browser, errorReason);

  return (
    <div className="perm-guard">
      <div className="perm-guard__card">
        <div className="perm-guard__header">
          <span className="perm-guard__icon">{info.icon}</span>
          <h3 className="perm-guard__title">{info.title}</h3>
          <button
            className="perm-guard__dismiss"
            onClick={() => setDismissed(true)}
            title="Dismiss"
            type="button"
          >
            ✕
          </button>
        </div>

        <p className="perm-guard__desc">
          {errorReason === 'not-found'
            ? 'We couldn\'t find any camera or microphone on your device.'
            : 'Your browser is blocking access to your camera and microphone. Follow these steps to fix it:'}
        </p>

        <ol className="perm-guard__steps">
          {info.steps.map((step, i) => (
            <li key={i} className="perm-guard__step">{step}</li>
          ))}
        </ol>

        <div className="perm-guard__actions">
          <button className="perm-guard__reload-btn" onClick={handleReload} type="button">
            🔄 Reload Page
          </button>
          <button
            className="perm-guard__dismiss-btn"
            onClick={() => setDismissed(true)}
            type="button"
          >
            Continue without mic/camera
          </button>
        </div>
      </div>
    </div>
  );
}
