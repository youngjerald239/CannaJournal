import StrainCard from '../components/StrainCard';
import { useEffect, useState, useMemo } from 'react';


// Replace detailed mock data with a simple name list. The page will
// build basic strain objects; external enrichment was removed.
const strainNames = [
	'Blue Dream',
	'Sour Diesel',
	'OG Kush',
	'Girl Scout Cookies',
	'Northern Lights',
];


export default function Strains() {
		const [strains, setStrains] = useState([]);
		const [loading, setLoading] = useState(false);
		const [toggling, setToggling] = useState(null); // strain id while updating
		const [showFavsOnly, setShowFavsOnly] = useState(false);
		const [selectedTypes, setSelectedTypes] = useState([]); // multi-select: ['Hybrid','Sativa','Indica']
		const [showFilters, setShowFilters] = useState(true);
		const [showShortcutHelp, setShowShortcutHelp] = useState(false);

		function toggleType(t){
			setSelectedTypes(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t]);
		}

		function clearTypeFilters(){ setSelectedTypes([]); }

		// Load persisted filter prefs
		useEffect(()=>{
			try {
				const saved = JSON.parse(localStorage.getItem('cj_filters_v1')||'{}');
				if (Array.isArray(saved.selectedTypes)) setSelectedTypes(saved.selectedTypes);
				if (typeof saved.showFavsOnly === 'boolean') setShowFavsOnly(saved.showFavsOnly);
				if (typeof saved.showFilters === 'boolean') setShowFilters(saved.showFilters);
				if (typeof saved.showShortcutHelp === 'boolean') setShowShortcutHelp(saved.showShortcutHelp);
			} catch(_){}
		},[]);

		// Persist when things change
		useEffect(()=>{
			try {
				localStorage.setItem('cj_filters_v1', JSON.stringify({ selectedTypes, showFavsOnly, showFilters, showShortcutHelp }));
			} catch(_){}
		}, [selectedTypes, showFavsOnly, showFilters, showShortcutHelp]);

		// Keyboard shortcuts: F favorites, H Hybrid, S Sativa, I Indica, Esc clear
		useEffect(()=>{
			function onKey(e){
				const tag = e.target.tagName.toLowerCase();
				if (['input','textarea','select'].includes(tag) || e.target.isContentEditable) return;
				const k = e.key.toLowerCase();
				if (k === 'f'){ setShowFavsOnly(f=>!f); }
				else if (k === 'h'){ toggleType('Hybrid'); }
				else if (k === 's'){ toggleType('Sativa'); }
				else if (k === 'i'){ toggleType('Indica'); }
				else if (e.key === 'Escape'){ setShowFavsOnly(false); clearTypeFilters(); }
			}
			window.addEventListener('keydown', onKey);
			return () => window.removeEventListener('keydown', onKey);
		},[]);

		// Memoize filtered list so we can reuse count
		const filteredStrains = useMemo(()=>{
			return strains
				.filter(s => !showFavsOnly || s.favorite)
				.filter(s => !selectedTypes.length || (s.type && selectedTypes.some(t => t.toLowerCase() === s.type.toLowerCase())));
		}, [strains, showFavsOnly, selectedTypes]);

		useEffect(() => {
			let mounted = true;
				async function buildStrains() {
					setLoading(true);

					// Try backend API first
					try {
					const controller = new AbortController();
					// allow a slightly longer timeout for local dev
					const timeout = setTimeout(() => controller.abort(), 5000);
						const res = await fetch('/strains', { signal: controller.signal, credentials: 'include' });
						clearTimeout(timeout);
						if (res.ok) {
							const data = await res.json();
							if (mounted) {
								setStrains(Array.isArray(data) ? data : []);
								setLoading(false);
								return;
							}
						}
					} catch (err) {
						// ignore; backend failed and we will build local defaults
					}

					// Backend not available or failed -> build from strainNames without external enrichment
					setLoading(true);
					const results = strainNames.map((name, idx) => ({
						id: idx + 1,
						name,
						type: 'Hybrid',
						thc: null,
						cbd: null,
						effects: 'Unknown',
						image: 'https://upload.wikimedia.org/wikipedia/commons/1/19/Cannabis_sativa_female_flower_closeup.jpg',
						flavors: [],
						aroma: [],
						medicalUses: [],
						recommendedUse: null,
						grow: {
							difficulty: 'Medium',
							floweringTime: null,
							indoorOutdoor: 'Both',
							optimalTemp: null,
							feeding: null,
						},
					}));
					if (mounted) setStrains(results);
					setLoading(false);
				}
				buildStrains();
			return () => {
				mounted = false;
			};
		}, []);

    return (
        <div className='p-4'>
            <div className='max-w-6xl mx-auto px-4'>
			<div className='mb-6 flex flex-col gap-4'>
				{/* Legend / filters */}
				<div className='flex flex-wrap items-center gap-2 text-[11px]'>
					<span className='uppercase tracking-wide text-emerald-300/60 mr-1'>Filter:</span>
					<FilterChip label='All' active={!showFavsOnly} onClick={()=> setShowFavsOnly(false)} />
					<FilterChip label='Favorites' active={showFavsOnly} onClick={()=> setShowFavsOnly(true)} />
				</div>
				<div className='flex flex-col gap-2'>
					<div className='flex items-center flex-wrap gap-2'>
						<button
							onClick={()=> setShowFilters(o=>!o)}
							className='relative px-3 py-1 rounded-md border border-emerald-400/25 bg-slate-900/50 text-[11px] text-emerald-200/90 hover:bg-slate-800/60 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50'
							aria-expanded={showFilters}
						>
							Filters ({filteredStrains.length})
							{(showFavsOnly || selectedTypes.length>0) && (
								<span className='ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-emerald-600 text-[10px] font-semibold text-white'>{(showFavsOnly?1:0)+selectedTypes.length}</span>
							)}
						</button>
						<button
							onClick={()=> setShowShortcutHelp(o=>!o)}
							className='relative px-3 py-1 rounded-md border border-indigo-400/25 bg-slate-900/40 text-[11px] text-indigo-200/90 hover:bg-slate-800/60 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50'
							aria-expanded={showShortcutHelp}
						>
							Shortcuts
						</button>
						{(showFavsOnly || selectedTypes.length>0) && !showFilters && (
							<div className='flex flex-wrap gap-1 text-[10px]'>
								{showFavsOnly && <span className='px-2 py-0.5 rounded-full bg-green-700/50 text-green-100 border border-green-400/30'>Favorites</span>}
								{selectedTypes.map(t => (
									<span key={t} className='px-2 py-0.5 rounded-full bg-green-800/40 text-emerald-100 border border-emerald-400/30'>{t}</span>
								))}
							</div>
						)}
					</div>
					{showFilters && (
						<div className='flex flex-wrap gap-2 text-[11px]'>
							<TypeChip
								color='hybrid'
								label='Hybrid'
								active={selectedTypes.includes('Hybrid')}
								onClick={() => toggleType('Hybrid')}
							/>
							<TypeChip
								color='sativa'
								label='Sativa'
								active={selectedTypes.includes('Sativa')}
								onClick={() => toggleType('Sativa')}
							/>
							<TypeChip
								color='indica'
								label='Indica'
								active={selectedTypes.includes('Indica')}
								onClick={() => toggleType('Indica')}
							/>
							{(selectedTypes.length>0) && (
								<button
									type='button'
									onClick={clearTypeFilters}
									className='px-2 py-1 text-[10px] rounded-md border border-emerald-400/30 text-emerald-200/80 hover:text-emerald-100 hover:bg-slate-800/50 transition'
								>
									Clear
								</button>
							)}
						</div>
					)}
					{showShortcutHelp && (
						<div className='text-[10px] text-emerald-300/60 mt-1 space-y-1 bg-slate-900/40 rounded-md p-2 border border-emerald-400/15'>
							<p className='font-semibold tracking-wide text-emerald-200/80'>Keyboard Shortcuts</p>
							<ul className='list-none space-y-0.5'>
								<li><span className='text-emerald-100 font-mono'>H</span> Toggle Hybrid</li>
								<li><span className='text-emerald-100 font-mono'>S</span> Toggle Sativa</li>
								<li><span className='text-emerald-100 font-mono'>I</span> Toggle Indica</li>
								<li><span className='text-emerald-100 font-mono'>F</span> Toggle Favorites Only</li>
								<li><span className='text-emerald-100 font-mono'>Esc</span> Clear All Filters</li>
							</ul>
						</div>
					)}
				</div>
				<div className='flex gap-4 items-center flex-wrap'>
				<button
					onClick={() => setShowFavsOnly(f=>!f)}
					className={`relative px-4 py-2 rounded-lg text-xs font-medium tracking-wide transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 border backdrop-blur-md
					${showFavsOnly
						? 'text-emerald-100 border-emerald-400/30 bg-gradient-to-br from-emerald-900/70 via-slate-900/60 to-slate-800/50 shadow-[0_2px_10px_-2px_rgba(16,185,129,0.35)]'
						: 'text-emerald-200/80 border-emerald-400/15 bg-gradient-to-br from-emerald-950/40 via-slate-950/30 to-slate-900/30 hover:from-emerald-900/50 hover:via-slate-900/40 hover:to-slate-800/40'}
					`}
					aria-pressed={showFavsOnly}
				>
					<span className='relative z-10'>{showFavsOnly ? 'Showing Favorites' : 'Show Favorites Only'}</span>
					{/* subtle glowing border overlay */}
					<span aria-hidden='true' className={`pointer-events-none absolute inset-0 rounded-lg ${showFavsOnly ? 'bg-emerald-400/10' : 'bg-emerald-400/5'}`} />
				</button>
				{showFavsOnly && (
					<span className='text-[11px] text-emerald-300/70'>Filtering {strains.filter(s=>s.favorite).length} favorites</span>
				)}
				</div>
			</div>
			{loading && <p className='mb-4'>Fetching strain summaries…</p>}
                <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4'>
				{filteredStrains.map((strain) => (
					<StrainCard
						key={strain.id}
						strain={strain}
						onFilterType={(t)=> toggleType(t)}
						isTypeActive={selectedTypes.includes(strain.type)}
						onToggleFavorite={async (s) => {
							if (toggling) return; // prevent rapid double clicks
							setToggling(s.id);
							const isFav = s.favorite;
							try {
								const method = isFav ? 'DELETE' : 'POST';
								const resp = await fetch(`/favorites/${s.id}`, { method, credentials: 'include' });
								if (resp.ok) {
									setStrains(prev => prev.map(st => st.id === s.id ? { ...st, favorite: !isFav } : st));
								}
							} catch(e) { /* ignore */ }
							finally { setToggling(null); }
						}}
					/>
				))}
			</div>
            </div>
		</div>
	);
}

function FilterChip({ label, active, onClick }) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={`px-3 py-1 rounded-full border text-[11px] transition backdrop-blur-sm ${active ? 'bg-emerald-700/40 border-emerald-400/40 text-emerald-100 shadow-inner' : 'bg-slate-900/40 border-emerald-400/15 text-emerald-300/80 hover:bg-slate-800/50 hover:text-emerald-200'} focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60`}
			aria-pressed={active}
		>{label}</button>
	);
}

function TypeChip({ color, label, active=false, onClick }) {
	const styles = {
		sativa: 'from-amber-500 via-orange-500 to-rose-500 text-amber-50',
		indica: 'from-indigo-700 via-purple-700 to-fuchsia-600 text-purple-50',
		hybrid: 'from-emerald-500 via-teal-500 to-sky-500 text-emerald-50'
	};
	return onClick ? (
		<button
			type='button'
			onClick={onClick}
			className={`relative text-[10px] tracking-wide px-3 py-1 rounded-full bg-gradient-to-r ${styles[color]||styles.hybrid} border ${active ? 'border-white/60 ring-2 ring-white/40 shadow-lg scale-105' : 'border-white/10 shadow-[0_0_6px_rgba(255,255,255,0.15)]'} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/60 duration-200 ${active ? 'animate-[pulse_1.2s_ease-in-out]' : 'opacity-90 hover:opacity-100'} `}
			aria-pressed={active}
		>
			<span className='relative z-10'>{label}</span>
			{active && <span aria-hidden='true' className='absolute inset-0 rounded-full bg-white/10 mix-blend-overlay' />}
		</button>
	) : (
		<span className={`text-[10px] tracking-wide px-3 py-1 rounded-full bg-gradient-to-r ${styles[color]||styles.hybrid} shadow-[0_0_6px_rgba(255,255,255,0.15)] border border-white/10`}>{label}</span>
	);
}