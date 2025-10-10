import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/auth/me', { credentials: 'include' });
        if (!mounted) return;
        if (res.ok) {
          const j = await res.json();
            if (j?.authenticated){
              setIsAuthenticated(true);
              setUser(j.user);
            } else { setIsAuthenticated(false); setUser(null); }
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
    // username can be either actual username or email identifier; server handles both and admin short-circuit
    const res = await fetch('/auth', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!res.ok) throw new Error('Login failed');
    const j = await res.json();
    // server returns token, but we store cookie so just mark authenticated
  setIsAuthenticated(true);
  if (j.user) setUser(j.user);
    return j;
  }

  async function signupWithPassword({ username, email, password }) {
    const res = await fetch('/auth/signup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) });
    if (!res.ok) throw new Error('Signup failed');
    const j = await res.json();
  setIsAuthenticated(true);
  if (j.user) setUser(j.user);
    return j;
  }

  async function logout() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      // ignore
    }
  setIsAuthenticated(false);
  setUser(null);
  }

  const value = { isAuthenticated, checking, user, loginWithPassword, signupWithPassword, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
