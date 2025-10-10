import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

export function useChatSocket(enabled=true) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const listenersRef = useRef({});

  useEffect(() => {
    if (!enabled) return;
    const socket = io('/', { withCredentials: true, autoConnect: true });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('auth_ok', (p)=> setAuthUser(p.username));
    const relay = (event) => (payload) => {
      const arr = listenersRef.current[event];
      if (arr) arr.forEach(fn => fn(payload));
    };
    ['conversation_joined','message_new','reactions_update','message_deleted','message_update','blocked_users','error']
      .forEach(ev => socket.on(ev, relay(ev)));
    return () => { socket.disconnect(); };
  }, [enabled]);

  function on(event, fn){
    if (!listenersRef.current[event]) listenersRef.current[event] = [];
    listenersRef.current[event].push(fn);
    return () => { listenersRef.current[event] = listenersRef.current[event].filter(f=>f!==fn); };
  }

  const emit = useCallback((ev, data) => { socketRef.current?.emit(ev, data); }, []);

  return { socket: socketRef.current, emit, on, connected, authUser };
}
