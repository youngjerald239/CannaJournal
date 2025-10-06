import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/auth/me', { credentials: 'include' });
        if (!mounted) return;
        if (res.ok) {
          const j = await res.json();
          setIsAuthenticated(Boolean(j?.authenticated));
        } else setIsAuthenticated(false);
      } catch (err) {
        setIsAuthenticated(false);
      } finally {
        if (mounted) setChecking(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function loginWithPassword(username, password) {
    const res = await fetch('/auth', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!res.ok) throw new Error('Login failed');
    const j = await res.json();
    // server returns token, but we store cookie so just mark authenticated
    setIsAuthenticated(true);
    return j;
  }

  async function signupWithPassword(username, password) {
    const res = await fetch('/auth/signup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!res.ok) throw new Error('Signup failed');
    const j = await res.json();
    setIsAuthenticated(true);
    return j;
  }

  async function logout() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      // ignore
    }
    setIsAuthenticated(false);
  }

  const value = { isAuthenticated, checking, loginWithPassword, signupWithPassword, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
