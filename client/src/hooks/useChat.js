/**
 * useChat — manages realtime chat state.
 * Listens to 'chat-message' socket events and provides a sendMessage function.
 * XSS prevention: messages are rendered via textContent (never innerHTML).
 */

import { useEffect, useState, useCallback } from 'react';

/**
 * @param {import('socket.io-client').Socket | null} socket
 * @returns {{ messages: Array, sendMessage: (text: string) => void }}
 */
export function useChat(socket) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!socket) return;

    const onMessage = (msg) => {
      setMessages((prev) => [...prev, { ...msg, id: `${msg.timestamp}-${msg.fromSocketId}` }]);
    };

    socket.on('chat-message', onMessage);
    return () => socket.off('chat-message', onMessage);
  }, [socket]);

  const sendMessage = useCallback(
    (text) => {
      if (!socket || !text.trim()) return;
      socket.emit('chat-message', { text: text.trim() });
    },
    [socket]
  );

  return { messages, sendMessage };
}
