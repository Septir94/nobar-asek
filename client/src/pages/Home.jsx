import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, joinRoom } from '../services/api';
import ThemeModal from '../components/ThemeModal';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState('');
  const [themeModalOpen, setThemeModalOpen] = useState(false);

  const handleCreate = async () => {
    if (!displayName.trim()) {
      setError('Please enter your display name');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const data = await createRoom(displayName.trim());
      // Store session info
      sessionStorage.setItem('nobar_token', data.token);
      sessionStorage.setItem('nobar_userId', data.userId);
      sessionStorage.setItem('nobar_roomCode', data.roomCode);
      sessionStorage.setItem('nobar_displayName', displayName.trim());
      sessionStorage.setItem('nobar_isHost', 'true');

      setCreatedCode(data.roomCode);
    } catch (err) {
      setError(err.message || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!displayName.trim()) {
      setError('Please enter your display name');
      return;
    }
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const data = await joinRoom(roomCode.trim(), displayName.trim());
      // Store session info
      sessionStorage.setItem('nobar_token', data.token);
      sessionStorage.setItem('nobar_userId', data.userId);
      sessionStorage.setItem('nobar_roomCode', data.roomCode);
      sessionStorage.setItem('nobar_displayName', displayName.trim());
      sessionStorage.setItem('nobar_isHost', 'false');

      navigate(`/room/${data.roomCode}`);
    } catch (err) {
      if (err.status === 404) {
        setError('Room not found. Check your room code.');
      } else if (err.status === 403) {
        setError('Room is full (max 4 members).');
      } else if (err.status === 429) {
        setError('Too many attempts. Please wait a moment.');
      } else {
        setError(err.message || 'Failed to join room');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEnterRoom = () => {
    navigate(`/room/${createdCode}`);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(createdCode);
  };

  return (
    <div className="home">
      {/* Top Navbar / Theme Switcher */}
      <div className="home__top-bar">
        <button
          className="home__theme-btn"
          onClick={() => setThemeModalOpen(true)}
          title="Change Appearance & Theme"
          type="button"
        >
          🎨 <span className="home__theme-btn-text">Theme</span>
        </button>
      </div>

      <div className="home__container">
        {/* Header */}
        <div className="home__header">
          <div className="home__logo">
            <img src="/favicon-2.svg" alt="Nobar Logo" className="home__logo-img" />
            <h1 className="home__title">Nobar</h1>
          </div>
          <p className="home__subtitle">Private video call rooms for you and your friends</p>
        </div>

        {/* Display Name Input */}
        <div className="home__field">
          <label className="home__label" htmlFor="displayName">Your Name</label>
          <input
            id="displayName"
            className="home__input"
            type="text"
            placeholder="Enter your display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={24}
          />
        </div>

        {/* Error Message */}
        {error && <div className="home__error">{error}</div>}

        {/* Created Room Code Display */}
        {createdCode && (
          <div className="home__code-display">
            <p className="home__code-label">Your room code:</p>
            <div className="home__code-value">
              <span>{createdCode}</span>
              <button
                className="home__code-copy"
                onClick={handleCopyCode}
                title="Copy to clipboard"
              >
                📋
              </button>
            </div>
            <p className="home__code-hint">Share this code with your friends</p>
            <button
              className="home__btn home__btn--primary"
              onClick={handleEnterRoom}
            >
              Enter Room →
            </button>
          </div>
        )}

        {/* Action Sections */}
        {!createdCode && (
          <div className="home__actions">
            {/* Create Room */}
            <div className="home__section">
              <button
                className="home__btn home__btn--primary"
                onClick={handleCreate}
                disabled={loading}
              >
                {loading ? 'Creating...' : '+ Create Room'}
              </button>
            </div>

            <div className="home__divider">
              <span>or join an existing room</span>
            </div>

            {/* Join Room */}
            <div className="home__section">
              <div className="home__join-row">
                <input
                  className="home__input home__input--code"
                  type="text"
                  placeholder="Room Code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={6}
                />
                <button
                  className="home__btn home__btn--secondary"
                  onClick={handleJoin}
                  disabled={loading}
                >
                  {loading ? 'Joining...' : 'Join'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Appearance & Theme Modal */}
      <ThemeModal
        isOpen={themeModalOpen}
        onClose={() => setThemeModalOpen(false)}
      />
    </div>
  );
}
