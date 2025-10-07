import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../lib/auth';

export default function Navbar() {
	const [open, setOpen] = useState(false);
	const menuId = 'main-navigation';
	const location = useLocation();
	const navigate = useNavigate();

	// global search state
	const [searchQuery, setSearchQuery] = useState('');
	const [searchData, setSearchData] = useState([]); // cached strains
	const [searchResults, setSearchResults] = useState([]);
	const [showSearch, setShowSearch] = useState(false);
	const [activeResult, setActiveResult] = useState(0);
	const [recentSearches, setRecentSearches] = useState([]); // array of strings
	const searchRef = useRef(null);
	const RECENT_KEY = 'cj_recent_searches_v1';

	// Add shadow / stronger background after scrolling a little
	const [scrolled, setScrolled] = useState(false);
	useEffect(() => {
		function onScroll(){
			setScrolled(window.scrollY > 8);
		}
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	}, []);

	useEffect(() => {
		function onKey(e) {
			if (e.key === 'Escape') { setOpen(false); setShowSearch(false); }
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	// Fetch strains once for search suggestions
	useEffect(()=>{
		let cancelled = false;
		(async ()=>{
			try {
				const res = await fetch('http://localhost:5002/strains');
				if (!res.ok) throw new Error('fail');
				const data = await res.json();
				if (!cancelled && Array.isArray(data)) setSearchData(data);
			} catch(_){ /* ignore */ }
		})();
		return ()=>{ cancelled = true; };
	},[]);

	// Load recent searches
	useEffect(()=>{
		try {
			const raw = localStorage.getItem(RECENT_KEY);
			if (raw){
				const arr = JSON.parse(raw);
				if (Array.isArray(arr)) setRecentSearches(arr.slice(0,10));
			}
		} catch(_){/*ignore*/}
	},[]);

	// compute filtered results when query changes
	useEffect(()=>{
		if (!searchQuery.trim()) { setSearchResults([]); return; }
		const q = searchQuery.toLowerCase();
		const filtered = searchData.filter(s=> s.name?.toLowerCase().includes(q)).slice(0,8);
		setSearchResults(filtered);
		setActiveResult(0);
	},[searchQuery, searchData]);

	function handleSearchKey(e){
		if (e.key === 'ArrowDown'){ e.preventDefault(); setActiveResult(i=> (i+1)%Math.max(1,searchResults.length)); }
		else if (e.key === 'ArrowUp'){ e.preventDefault(); setActiveResult(i=> (i-1+Math.max(1,searchResults.length))%Math.max(1,searchResults.length)); }
		else if (e.key === 'Enter'){
			if (searchResults[activeResult]) selectResult(searchResults[activeResult]);
			else if (searchQuery.trim()) submitSearch();
		}
		else if (e.key === 'Escape'){ setShowSearch(false); searchRef.current?.blur(); }
	}

	function submitSearch(){
		// navigate to strains page with query parameter
		navigate(`/strains?q=${encodeURIComponent(searchQuery.trim())}`);
		saveRecent(searchQuery.trim());
		setShowSearch(false);
	}

	function selectResult(item){
		if (!item) return;
		navigate(`/strains?q=${encodeURIComponent(item.name)}`);
		setSearchQuery(item.name);
		saveRecent(item.name);
		setShowSearch(false);
	}

	function clearSearch(){
		setSearchQuery('');
		setSearchResults([]);
		setActiveResult(0);
		searchRef.current?.focus();
	}

	function saveRecent(q){
		if (!q) return;
		setRecentSearches(prev => {
			const next = [q, ...prev.filter(x=> x.toLowerCase()!==q.toLowerCase())].slice(0,10);
			try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch(_){ }
			return next;
		});
	}

	function removeRecent(q){
		setRecentSearches(prev => {
			const next = prev.filter(x=> x!==q);
			try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch(_){ }
			return next;
		});
	}

	useEffect(()=>{
		function handleClickOutside(e){
			if (!searchRef.current) return;
			if (!searchRef.current.parentElement.contains(e.target)) setShowSearch(false);
		}
		if (showSearch) document.addEventListener('mousedown', handleClickOutside);
		return ()=> document.removeEventListener('mousedown', handleClickOutside);
	},[showSearch]);

	return (
		<nav role="navigation" aria-label="Main" className={`sticky top-0 z-40 transition-colors duration-300 ${scrolled ? 'backdrop-blur-xl bg-gradient-to-br from-emerald-950/80 via-slate-950/75 to-slate-900/80 shadow-[0_4px_18px_-6px_rgba(0,0,0,0.55)] border-b border-emerald-400/15' : 'backdrop-blur-md bg-gradient-to-br from-emerald-950/50 via-slate-950/40 to-slate-900/40 border-b border-emerald-400/5'}`}> 
			<div className='max-w-6xl mx-auto px-4 h-14 flex items-center gap-4'>
				<Link to='/' className='flex items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 rounded-md'>
					<LogoLeaf />
					<span className='font-semibold tracking-wide text-sm sm:text-base bg-gradient-to-r from-emerald-300 via-green-200 to-teal-200 bg-clip-text text-transparent'>CannaJournal</span>
				</Link>

				{/* Primary nav (desktop) */}
				<div className='hidden md:flex items-center gap-1'>
					<NavLink to='/' label='Home' active={location.pathname === '/'} />
					<NavLink to='/strains' label='Strains' active={location.pathname.startsWith('/strains')} />
					<NavLink to='/journal' label='Journal' active={location.pathname.startsWith('/journal')} />
					<NavLink to='/profile' label='Profile' active={location.pathname.startsWith('/profile')} />
				</div>

				{/* Global search */}
				<div className='relative flex-1 max-w-xs hidden sm:block'>
					<div className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg border ${showSearch ? 'border-emerald-400/40' : 'border-emerald-400/20'} bg-emerald-900/20 focus-within:ring-2 focus-within:ring-emerald-400/50`}> 
						<svg className='w-4 h-4 text-emerald-300/70' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='11' cy='11' r='7'/><path d='m21 21-4.35-4.35'/></svg>
						<input
							ref={searchRef}
							type='text'
							value={searchQuery}
							onChange={e=>{ setSearchQuery(e.target.value); setShowSearch(true); }}
							onFocus={()=> setShowSearch(true)}
							onKeyDown={handleSearchKey}
							placeholder='Search strains...'
							className='bg-transparent outline-none w-full text-sm placeholder-emerald-300/40 text-emerald-50'
							aria-autocomplete='list'
							aria-controls='global-search-list'
						/>
						{searchQuery && <button type='button' onClick={clearSearch} aria-label='Clear search' className='text-emerald-300/60 hover:text-emerald-200 transition'>×</button>}
					</div>
					{showSearch && (
						<div id='global-search-list' role='listbox' className='absolute z-40 mt-1 w-full rounded-lg border border-emerald-400/30 bg-slate-950/95 backdrop-blur shadow-lg p-1 text-sm max-h-80 overflow-auto'>
							{searchQuery.trim() ? (
								<>
									{searchResults.map((r,i)=>(
										<button
											key={r.id}
											type='button'
											role='option'
											aria-selected={i===activeResult}
											onMouseDown={e=>{ e.preventDefault(); selectResult(r); }}
											className={`w-full text-left px-3 py-1 rounded-md ${i===activeResult ? 'bg-emerald-700/40 text-emerald-100' : 'hover:bg-emerald-800/30 text-emerald-200'} transition`}> 
											<span className='font-medium'>{r.name}</span>
											<span className='ml-2 text-[10px] uppercase tracking-wide text-emerald-300/60'>{r.type}</span>
										</button>
									))}
									{searchResults.length===0 && (
										<div className='px-3 py-1 text-emerald-300/70 text-[12px]'>No matches. Press Enter to search anyway.</div>
									)}
								</>
							) : (
								<>
									{recentSearches.length>0 && (
										<div className='mb-1'>
											<div className='px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-300/50'>Recent</div>
											{recentSearches.map(r => (
												<div key={r} className='flex items-center'>
													<button type='button' onMouseDown={e=>{ e.preventDefault(); setSearchQuery(r); setShowSearch(true); }} className='flex-1 text-left px-3 py-1 rounded-md hover:bg-emerald-800/30 text-emerald-200'>
														<span className='font-medium'>{r}</span>
													</button>
													<button type='button' aria-label='Remove recent search' onMouseDown={e=>{ e.preventDefault(); removeRecent(r); }} className='px-2 text-emerald-300/50 hover:text-emerald-200'>×</button>
												</div>
											))}
										</div>
									)}
									{/* Quick type tags */}
									{['Sativa','Indica','Hybrid'].map(t => (
										<button key={t} type='button' onMouseDown={e=>{ e.preventDefault(); setSearchQuery(t); setShowSearch(true); }} className='inline-block m-1 px-3 py-1 rounded-full text-[12px] bg-emerald-800/30 hover:bg-emerald-700/40 text-emerald-200 border border-emerald-400/20'>#{t}</button>
									))}
									{recentSearches.length===0 && <div className='px-3 py-2 text-emerald-300/60 text-[12px]'>Type to search strains...</div>}
								</>
							)}
						</div>
					)}
				</div>

				<div className='ml-auto flex items-center gap-3'>
					{/* Mobile hamburger */}
					<button
						aria-controls={menuId}
						aria-expanded={open}
						aria-label={open ? 'Close menu' : 'Open menu'}
						onClick={() => setOpen(o=>!o)}
						className='md:hidden p-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 border border-emerald-400/20 transition'
					>
						<svg className='w-6 h-6' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
							{open ? <path d='M6 18L18 6M6 6l12 12' /> : <path d='M3 12h18M3 6h18M3 18h18' />}
						</svg>
					</button>
					<AuthStatus open={open} menuId={menuId} currentPath={location.pathname} onNavigate={() => setOpen(false)} />
				</div>
			</div>
		</nav>
	);
}

function AuthStatus({ open, menuId, currentPath, onNavigate }) {
	const { isAuthenticated, logout } = useAuth();
	const avatar = null; // placeholder
	const initial = 'U';

	return (
		<div id={menuId} className={`md:static absolute left-0 right-0 top-full md:top-auto ${open ? 'block' : 'hidden'} md:block bg-slate-950/90 md:bg-transparent px-4 md:px-0 pb-4 md:pb-0 pt-4 md:pt-0 border-b md:border-0 border-emerald-400/10 md:shadow-none shadow-lg md:rounded-none rounded-b-xl`}> 
			<div className='flex flex-col md:flex-row md:items-center gap-2 md:gap-3'>
				{/* Mobile nav links only */}
				<div className='flex flex-col gap-1 md:hidden'>
					<NavLink mobile to='/' label='Home' active={currentPath === '/'} onClick={onNavigate} />
					<NavLink mobile to='/strains' label='Strains' active={currentPath.startsWith('/strains')} onClick={onNavigate} />
					<NavLink mobile to='/journal' label='Journal' active={currentPath.startsWith('/journal')} onClick={onNavigate} />
					<NavLink mobile to='/profile' label='Profile' active={currentPath.startsWith('/profile')} onClick={onNavigate} />
					{isAuthenticated && <NavLink mobile to='/admin' label='Admin' active={currentPath.startsWith('/admin')} onClick={onNavigate} />}
				</div>
				{/* Auth controls */}
				<div className='flex items-center gap-2 mt-2 md:mt-0'>
					{isAuthenticated ? (
						<>
							<Link to='/profile' onClick={onNavigate} className='group inline-flex items-center gap-2 pl-0 md:pl-2 pr-3 py-1.5 rounded-full bg-emerald-800/20 hover:bg-emerald-700/30 border border-emerald-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 transition'>
								<span className='w-7 h-7 rounded-full ring-1 ring-emerald-400/40 bg-gradient-to-br from-emerald-700 to-emerald-900 flex items-center justify-center text-[11px] font-semibold text-emerald-100'>
									{avatar ? <img src={avatar} alt='Avatar' className='w-full h-full object-cover rounded-full'/> : initial}
								</span>
								<span className='text-[11px] uppercase tracking-wide text-emerald-200 hidden sm:inline'>You</span>
							</Link>
							<button onClick={() => { logout(); onNavigate && onNavigate(); }} className='px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-200 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 transition'>Logout</button>
						</>
					) : (
						<NavLink mobile to='/login' label='Login' active={currentPath.startsWith('/login')} onClick={onNavigate} variant='button' />
					)}
				</div>
			</div>
		</div>
	);
}

function NavLink({ to, label, active, onClick, mobile=false, variant }) {
  const base = 'relative px-3 py-2 rounded-lg text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60';
  const activeStyles = 'text-emerald-200';
  const inactive = 'text-emerald-100/70 hover:text-emerald-100 hover:bg-emerald-800/20';
  const mobileBlock = mobile ? 'w-full md:w-auto' : '';
  const btnVariant = variant === 'button';
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`${base} ${mobileBlock} ${btnVariant ? 'bg-white/5 hover:bg-white/10 text-emerald-100' : (active ? activeStyles + ' bg-emerald-800/30' : inactive)} border border-transparent`}
    >
      <span>{label}</span>
      {active && <span aria-hidden='true' className='absolute left-1.5 right-1.5 -bottom-px h-0.5 rounded bg-gradient-to-r from-emerald-400 via-green-300 to-teal-300 shadow-[0_0_6px_1px_rgba(16,185,129,0.45)]' />}
    </Link>
  );
}

function LogoLeaf(){
  return (
    <svg className='w-6 h-6 text-emerald-300 drop-shadow-[0_0_4px_rgba(16,185,129,0.6)] transition-transform group-hover:rotate-6' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M12 2c4.5 4 7 8 7 11.5A6.5 6.5 0 0 1 12.5 20h-1A6.5 6.5 0 0 1 5 13.5C5 10 7.5 6 12 2Z' />
      <path d='M12 2v18' />
    </svg>
  );
}