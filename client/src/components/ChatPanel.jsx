/**
 * ChatPanel — realtime chat sidebar with emoji picker.
 *
 * XSS safety: message text is rendered as React text nodes (JSX string interpolation),
 * never via dangerouslySetInnerHTML. Emoji picker inserts unicode emoji into the input value.
 */

import { useState, useRef, useEffect } from 'react';
import EmojiPicker from 'emoji-picker-react';
import './ChatPanel.css';

export default function ChatPanel({ messages, onSend, currentUserId }) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    setShowEmoji(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiClick = (emojiData) => {
    const emoji = emojiData.emoji;
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);
    // Restore cursor position after emoji insert
    setTimeout(() => {
      input.selectionStart = start + emoji.length;
      input.selectionEnd = start + emoji.length;
      input.focus();
    }, 0);
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <span className="chat-panel__title">💬 Chat</span>
      </div>

      <div className="chat-panel__messages">
        {messages.length === 0 && (
          <div className="chat-panel__empty">No messages yet. Say hi! 👋</div>
        )}
        {messages.map((msg) => {
          const isOwn = msg.fromUserId === currentUserId;
          return (
            <div
              key={msg.id}
              className={`chat-message ${isOwn ? 'chat-message--own' : ''}`}
            >
              {!isOwn && (
                <div className="chat-message__sender">{msg.fromDisplayName}</div>
              )}
              {/* Text rendered as React text node — safe from XSS */}
              <div className="chat-message__bubble">
                {msg.text}
              </div>
              <div className="chat-message__time">{formatTime(msg.timestamp)}</div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Emoji Picker */}
      {showEmoji && (
        <div className="chat-panel__emoji-picker">
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            theme="dark"
            skinTonesDisabled
            searchDisabled={false}
            height={320}
            width="100%"
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}

      <div className="chat-panel__input-area">
        <button
          className={`chat-panel__emoji-btn ${showEmoji ? 'chat-panel__emoji-btn--active' : ''}`}
          onClick={() => setShowEmoji((v) => !v)}
          title="Emoji picker"
          type="button"
        >
          😊
        </button>
        <textarea
          ref={inputRef}
          className="chat-panel__input"
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={1000}
        />
        <button
          className="chat-panel__send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
          type="button"
          title="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
