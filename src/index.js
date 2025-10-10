import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Global fetch shim to support split deploys.
// If REACT_APP_API_BASE is set (e.g., https://api.example.com or /api),
// prepend it to relative request paths used by the app (e.g., '/auth', '/feed').
// Absolute URLs (http/https) are left unchanged.
(() => {
	const BASE = process.env.REACT_APP_API_BASE || '';
	if (!BASE) return; // same-origin/Nginx proxy mode
	const normalize = (b) => b.replace(/\/$/, '');
	const base = normalize(BASE);
	const originalFetch = window.fetch.bind(window);
	window.fetch = (input, init) => {
		try {
			const url = typeof input === 'string' ? input : (input && input.url) || '';
			const isAbsolute = /^https?:\/\//i.test(url);
			// Only rewrite app's relative API calls; keep dev websockets and static dev tools intact.
			const shouldRewrite = !isAbsolute && url.startsWith('/') && !url.startsWith('/sockjs-node');
			if (shouldRewrite) {
				const rewritten = base + url;
				if (typeof input === 'string') {
					return originalFetch(rewritten, init);
				} else {
					const req = new Request(rewritten, input);
					return originalFetch(req, init);
				}
			}
		} catch (_) { /* fall through to original */ }
		return originalFetch(input, init);
	};
})();


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);