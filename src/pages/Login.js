import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useNavigate } from 'react-router-dom';
import BeeMascot from '../components/BeeMascot';

export default function Login() {
	const [email, setEmail] = useState('');
	const [username, setUsername] = useState(''); // separate username for signup
	const [password, setPassword] = useState('');
		const { loginWithPassword, signupWithPassword, logout, isAuthenticated } = useAuth();
	const navigate = useNavigate();
	const [loading, setLoading] = useState(false);
	const [status, setStatus] = useState(null);
	const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
	// Bee mascot state
	const idRef = useRef(null);
	const passRef = useRef(null);
	const [focusField, setFocusField] = useState(null); // 'id' | 'password' | null
	const [caretRatio, setCaretRatio] = useState(0.5); // 0..1
		const [blink, setBlink] = useState(false);
		const [flap, setFlap] = useState(false);
	useEffect(()=>{
		const t = setInterval(()=> setBlink(b=> !b && Math.random() < 0.12), 1400);
		const c = setInterval(()=> setBlink(false), 160);
		return ()=> { clearInterval(t); clearInterval(c); };
	},[]);
	// Update eye direction based on caret position in the identifier field
	function updateCaretRatio(e){
		try {
			const len = (e.target.value || '').length || 1;
			const pos = e.target.selectionStart ?? len;
			setCaretRatio(Math.max(0, Math.min(1, pos/len)));
		} catch(_){ setCaretRatio(0.5); }
	}
	// Small wing flap on typing in id field
	function triggerFlap(){ setFlap(true); setTimeout(()=> setFlap(false), 150); }
    // OAuth removed (will implement later) – keeping component lean

	// Handle local auth (signin / signup)
	const handleLocalAuth = async (e) => {
		e?.preventDefault();
		setStatus(null);
		setLoading(true);
		try {
			if (mode === 'signup') {
				await signupWithPassword({ username, email, password });
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

		// OAuth handlers removed.

		return (
			<div className='max-w-md mx-auto mt-12 p-6 bg-gradient-to-br from-gray-900/60 to-slate-900/40 rounded-xl shadow-lg border border-slate-800'>
				<div className='flex items-center justify-between mb-2'>
					<h1 className='text-2xl font-bold'>{mode === 'signup' ? 'Create account' : 'Sign in'}</h1>
					<div className='text-sm'>
						<button onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')} className='text-slate-400 underline'>
							{mode === 'signup' ? 'Have an account? Sign in' : "New? Sign up"}
						</button>
					</div>
				</div>

				{/* Bee mascot */}
				<div className='mb-4 flex justify-center'>
					<BeeMascot
						watching={focusField !== 'password'}
						coverEyes={focusField === 'password'}
						lookRatio={caretRatio}
						blink={blink}
						flap={flap}
						isIdle={!focusField}
						colors={{ primary: '#10b981', dark: '#0b0f19', wing: '#e6fff6' }}
						eyeSpeed={2.2}
					/>
				</div>

			<div className='space-y-4'>
				{/* OAuth buttons removed */}

				<div className='flex items-center gap-3'>
					<span className='flex-1 h-px bg-slate-700' />
					<span className='text-sm text-slate-400'>or</span>
					<span className='flex-1 h-px bg-slate-700' />
				</div>

				<p className='text-xs text-slate-400'>Tip: Admins can sign in using their admin username in the "Email or username" field.</p>

				<form onSubmit={handleLocalAuth} className='space-y-3'>
					{mode==='signup' && (
						<input
							type='text'
							placeholder='Username'
							value={username}
							onChange={e => { setUsername(e.target.value); updateCaretRatio(e); triggerFlap(); }}
							className='block mb-2 p-2 border rounded w-full bg-transparent border-slate-700'
							onFocus={()=> setFocusField('id')}
							onBlur={()=> setFocusField(null)}
						/>
					)}
					<input
						required
						type={mode==='signup' ? 'email' : 'text'}
						placeholder={mode==='signup' ? 'Email (used as login id)' : 'Email or username'}
						value={email}
						onChange={e => { setEmail(e.target.value); updateCaretRatio(e); triggerFlap(); }}
						ref={idRef}
						onKeyUp={updateCaretRatio}
						onClick={updateCaretRatio}
						onFocus={()=> setFocusField('id')}
						onBlur={()=> setFocusField(null)}
						className='block mb-2 p-2 border rounded w-full bg-transparent border-slate-700'
					/>
					<input
						type='password'
						placeholder='Password'
						value={password}
						onChange={e => setPassword(e.target.value)}
						ref={passRef}
						onFocus={()=> setFocusField('password')}
						onBlur={()=> setFocusField(null)}
						className='block mb-2 p-2 border rounded w-full bg-transparent border-slate-700'
					/>
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
