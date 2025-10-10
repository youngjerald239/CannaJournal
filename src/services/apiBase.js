// Central API base configuration. In production behind Nginx, default to '/'.
// For split deploy, set REACT_APP_API_BASE to 'https://api.example.com' (no trailing slash).
const RAW = process.env.REACT_APP_API_BASE || '';

export function apiUrl(path) {
  if (!path.startsWith('/')) path = '/' + path;
  // Special case: when using Nginx proxy, API is mounted at /api
  // If REACT_APP_API_BASE is empty, we keep the existing absolute paths the app uses.
  // To preserve current routes that call '/auth', '/feed', etc., treat empty base as ''.
  // If you want to prefix all calls with '/api', set REACT_APP_API_BASE='/api'.
  if (!RAW) return path; // same-origin absolute
  return RAW.replace(/\/$/, '') + path;
}

export async function apiFetch(path, opts = {}) {
  const url = apiUrl(path);
  return fetch(url, { credentials: 'include', ...opts });
}
