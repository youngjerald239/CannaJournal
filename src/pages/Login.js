import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useNavigate } from 'react-router-dom';

export default function Login() {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
		const { loginWithPassword, signupWithPassword, logout, isAuthenticated } = useAuth();
	const navigate = useNavigate();
	const [loading, setLoading] = useState(false);
	const [status, setStatus] = useState(null);
	const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
	const [providers, setProviders] = useState({ google: false, linkedin: false });
	const [provLoaded, setProvLoaded] = useState(false);

	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				const r = await fetch('/auth/providers');
				if (r.ok) {
					const j = await r.json();
					if (mounted) setProviders(j);
				}
			} catch (e) { /* ignore */ }
			finally { if (mounted) setProvLoaded(true); }
		})();
		return () => { mounted = false; };
	}, []);

	// Handle local auth (signin / signup)
	const handleLocalAuth = async (e) => {
		e?.preventDefault();
		setStatus(null);
		setLoading(true);
		try {
			if (mode === 'signup') {
				await signupWithPassword(email, password);
			} else {
				await loginWithPassword(email, password);
			}
			navigate('/journal');
		} catch (err) {
			setStatus(err.message || (mode === 'signup' ? 'Signup failed' : 'Login failed'));
		} finally {
			setLoading(false);
		}
	};

		// Attempt to start OAuth with the backend; fallback to demo login when not available
		async function startOAuth(provider) {
		setStatus(null);
		setLoading(true);
		try {
			// If provider not advertised, block early
			if (!providers[provider]) {
				setStatus('Provider not configured');
				setLoading(false);
				return;
			}
			const search = mode === 'signup' ? '?action=signup' : '';
			const res = await fetch(`/auth/${provider}/start${search}`, { method: 'GET' });
			if (res.ok) {
				const json = await res.json().catch(() => null);
				if (json && json.url) {
					window.location.href = json.url;
					return; // redirecting
				}
			}
			setStatus('OAuth start failed (check provider config)');
		} catch (err) {
			setStatus('OAuth error: ' + (err.message || 'unknown'));
		} finally {
			setLoading(false);
		}
	}

		return (
			<div className='max-w-md mx-auto mt-12 p-6 bg-gradient-to-br from-gray-900/60 to-slate-900/40 rounded-xl shadow-lg border border-slate-800'>
				<div className='flex items-center justify-between mb-4'>
					<h1 className='text-2xl font-bold'>{mode === 'signup' ? 'Create account' : 'Sign in'}</h1>
					<div className='text-sm'>
						<button onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')} className='text-slate-400 underline'>
							{mode === 'signup' ? 'Have an account? Sign in' : "New? Sign up"}
						</button>
					</div>
				</div>

			<div className='space-y-4'>
				{provLoaded && (providers.google || providers.linkedin) && (
				<div className='flex flex-col gap-3'>
					{providers.google && <button onClick={() => startOAuth('google')} disabled={loading} className='flex items-center justify-center gap-3 w-full px-4 py-2 bg-white text-slate-900 rounded shadow-sm hover:brightness-95'>
						<svg width='18' height='18' viewBox='0 0 48 48' xmlns='http://www.w3.org/2000/svg' aria-hidden>
							<path fill='#EA4335' d='M24 9.5c3.9 0 7 1.4 9.4 3.3l7-7C36.6 2 30.7 0 24 0 14.6 0 6.9 4.8 3 12l8.2 6.3C13.7 13 18.3 9.5 24 9.5z' />
							<path fill='#34A853' d='M46.5 24c0-1.6-.1-2.7-.4-3.9H24v7.4h12.8c-.6 3.3-2.6 6-5.6 7.8l8.6 6.6C44.6 37.3 46.5 31.1 46.5 24z' />
							<path fill='#4A90E2' d='M11.2 28.3A14.5 14.5 0 0 1 10 24c0-1.3.2-2.5.5-3.7L3 13.9C1.1 16.8 0 20.3 0 24c0 3.7 1.1 7.2 3 10.1l8.2-6.6z' />
							<path fill='#FBBC05' d='M24 48c6.9 0 12.8-2.3 17.1-6.2l-8.6-6.6C29.8 35.8 27.1 36.8 24 36.8c-5.7 0-10.3-3.5-12.8-8.7L3 35.9C6.9 43.2 14.6 48 24 48z' />
						</svg>
						Continue with Google
					</button>}

					{providers.linkedin && <button onClick={() => startOAuth('linkedin')} disabled={loading} className='flex items-center justify-center gap-3 w-full px-4 py-2 bg-blue-700 text-white rounded shadow-sm hover:brightness-110'>
						<svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden>
							<path d='M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1 4.98 2.12 4.98 3.5zM.5 8.98h4V24h-4V8.98zM9.5 8.98h3.84v2.04h.06c.54-1.02 1.86-2.04 3.84-2.04 4.11 0 4.86 2.7 4.86 6.21V24h-4v-7.22c0-1.72-.03-3.93-2.4-3.93-2.4 0-2.76 1.87-2.76 3.79V24h-4V8.98z'/>
						</svg>
						Continue with LinkedIn
					</button>}
				</div>)}

				<div className='flex items-center gap-3'>
					<span className='flex-1 h-px bg-slate-700' />
					<span className='text-sm text-slate-400'>or</span>
					<span className='flex-1 h-px bg-slate-700' />
				</div>

				<form onSubmit={handleLocalAuth} className='space-y-3'>
					<input type='email' placeholder='Email' value={email} onChange={e => setEmail(e.target.value)} className='block mb-2 p-2 border rounded w-full bg-transparent border-slate-700' />
					<input type='password' placeholder='Password' value={password} onChange={e => setPassword(e.target.value)} className='block mb-2 p-2 border rounded w-full bg-transparent border-slate-700' />
					<button type='submit' disabled={loading} className='w-full py-2 px-4 bg-emerald-600 rounded text-white'>
						{loading ? (mode === 'signup' ? 'Creating…' : 'Signing in…') : (mode === 'signup' ? 'Create account' : 'Sign in')}
					</button>
				</form>

				{isAuthenticated && (
					<div className='text-center'>
						<button onClick={() => { logout(); navigate('/'); }} className='px-3 py-2 bg-red-600 text-white rounded'>Logout</button>
					</div>
				)}

				{status && <div className='text-sm text-rose-400 mt-2 text-center'>{status}</div>}
			</div>
		</div>
	);
}