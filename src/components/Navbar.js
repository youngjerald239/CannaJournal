import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

export default function Navbar() {
	const [open, setOpen] = useState(false);
	const menuId = 'main-navigation';

	useEffect(() => {
		function onKey(e) {
			if (e.key === 'Escape') setOpen(false);
		}
		if (open) window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open]);

	return (
		<nav className='p-4 bg-slate-900/80 text-green-100 backdrop-blur-sm'>
			<div className='max-w-6xl mx-auto flex items-center justify-between'>
				<div className='flex items-center gap-3'>
					<h1 className='font-bold'>Weed Journal</h1>
				</div>

				{/* hamburger for small screens */}
						<div className='md:hidden'>
							<button
								aria-controls={menuId}
								aria-expanded={open}
								aria-label={open ? 'Close menu' : 'Open menu'}
								onClick={() => setOpen((v) => !v)}
								className='p-2 rounded bg-green-700/20 hover:bg-green-700/30 focus:outline-none focus:ring-2 focus:ring-green-300/40'
							>
						<svg className='w-6 h-6' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
							{open ? <path d='M6 18L18 6M6 6l12 12' /> : <path d='M3 12h18M3 6h18M3 18h18' />}
						</svg>
					</button>
				</div>

								<AuthStatus open={open} menuId={menuId} />
			</div>
		</nav>
	);
}

function AuthStatus({ open, menuId }) {
  const { isAuthenticated, logout } = useAuth();
	return (
			<div id={menuId} className={`mt-3 md:mt-0 md:flex md:items-center md:gap-3 ${open ? 'block' : 'hidden'}`}>
			<Link to='/' className='block md:inline-block px-2 py-1 rounded hover:underline focus:outline-none focus:ring-2 focus:ring-green-300/30'>Home</Link>
			<Link to='/strains' className='block md:inline-block px-2 py-1 rounded hover:underline focus:outline-none focus:ring-2 focus:ring-green-300/30'>Strains</Link>
				{isAuthenticated && <Link to='/admin' className='block md:inline-block px-2 py-1 rounded hover:underline focus:outline-none focus:ring-2 focus:ring-green-300/30'>Admin</Link>}
			<Link to='/journal' className='block md:inline-block px-2 py-1 rounded hover:underline focus:outline-none focus:ring-2 focus:ring-green-300/30'>Journal</Link>
			<Link to='/profile' className='block md:inline-block px-2 py-1 rounded hover:underline focus:outline-none focus:ring-2 focus:ring-green-300/30'>Profile</Link>
			{isAuthenticated ? (
				<button onClick={() => logout()} className='block md:inline-flex px-2 py-1 rounded bg-red-700/20 text-sm'>Logout</button>
			) : (
				<Link to='/login' className='block md:inline-block px-2 py-1 rounded bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-green-300/30'>Login</Link>
			)}
		</div>
	);
}