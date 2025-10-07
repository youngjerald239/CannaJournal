
import { useState, useEffect, useRef } from 'react';

export default function StrainCard({ strain, onToggleFavorite, onFilterType, isTypeActive }) {
	const STORAGE_KEY = 'cj_last_view_' + strain.id;
	const initialView = (()=>{ try { return localStorage.getItem(STORAGE_KEY) || 'consumer'; } catch(_){ return 'consumer'; }})();
	const [view, setView] = useState(initialView);
	const [animating, setAnimating] = useState(false);
	const [activeButton, setActiveButton] = useState(null);
	const [clicked, setClicked] = useState(false); // fancy click feedback
	const cardRef = useRef(null);
	const list = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '—');

	// respect user reduced-motion setting
	const [reduceMotion, setReduceMotion] = useState(false);
	useEffect(() => {
		try {
			const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
			setReduceMotion(mq.matches);
			function onChange() { setReduceMotion(mq.matches); }
			mq.addEventListener?.('change', onChange);
			return () => mq.removeEventListener?.('change', onChange);
		} catch (e) {
			// ignore
		}
	}, []);

	function handleSwitchView(v) {
		setActiveButton(v);
		if (reduceMotion) {
			setView(v);
			try { localStorage.setItem(STORAGE_KEY, v); } catch(_){ }
			setActiveButton(null);
			return;
		}
		// small animated feedback: highlight and scale the card, then switch content
		setAnimating(true);
		setTimeout(() => {
			setView(v);
			try { localStorage.setItem(STORAGE_KEY, v); } catch(_){ }
			setAnimating(false);
			setActiveButton(null);
		}, 260);
	}

	const effectsList = typeof strain.effects === 'string'
		? strain.effects.split(',').map((s) => s.trim()).filter(Boolean)
		: Array.isArray(strain.effects)
		? strain.effects
		: [];

	// Phase 1: aggregate effect scores + show basic visualization
	const [agg, setAgg] = useState(null);
	useEffect(() => {
		let active = true;
		fetch(`/strains/${strain.id}/aggregate-effects`).then(r=> r.ok ? r.json(): null).then(d=> { if (active) setAgg(d); }).catch(()=>{});
		return () => { active = false; };
	}, [strain.id]);

	function renderMiniEffects() {
		if (!agg || !agg.count) return <span className='text-xs text-gray-400'>No effect data yet</span>;
		const keys = Object.keys(agg.averages || {});
		return (
			<div className='mt-2 grid grid-cols-3 gap-1'>
				{keys.map(k => {
					const v = agg.averages[k];
					const pct = Math.round((v/5)*100);
					return (
						<div key={k} className='flex flex-col group'>
							<span className='text-[10px] uppercase tracking-wide text-gray-400'>{k}</span>
							<div className='h-1.5 w-full bg-gray-800/70 rounded overflow-hidden relative'>
								<div
									style={{width: pct+'%'}}
									className={`h-full transition-all duration-500 ease-out ${typeTheme.badge.includes('amber-') ? 'bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500' : typeTheme.badge.includes('indigo-') ? 'bg-gradient-to-r from-indigo-400 via-purple-500 to-fuchsia-500' : 'bg-gradient-to-r from-emerald-400 via-teal-500 to-sky-500'} shadow-inner`}
								/>
							</div>
						</div>
					);
				})}
				<div className='col-span-3 text-[10px] text-gray-500 mt-1'>Samples: {agg.count}</div>
			</div>
		);
	}

	function renderTerpenes() {
		const t = strain.terpenes || {};
		const entries = Object.entries(t).slice(0,5);
		if (!entries.length) return null;
		return (
			<div className='mt-3'>
				<h4 className='text-xs font-semibold text-green-300 mb-1'>Terpenes</h4>
				<div className='space-y-1'>
					{entries.map(([name,val]) => {
						const pct = Math.min(100, Math.round((val || 0) * 100));
						return (
							<div key={name} className='grid grid-cols-[70px_1fr_32px] items-center gap-2'>
								<span className='text-[10px] uppercase tracking-wide text-gray-400 truncate'>{name}</span>
								<div className='h-1.5 w-full bg-gray-800 rounded overflow-hidden relative'>
									<div style={{width: pct+'%'}} className='h-full bg-gradient-to-r from-green-500 via-emerald-500 to-teal-400 transition-all duration-500 ease-out'></div>
								</div>
								<span className='text-[10px] text-gray-400 text-right tabular-nums'>{pct}</span>
							</div>
						);
					})}
				</div>
			</div>
		);
	}

	// Type-based theming: energetic (Sativa), relaxing (Indica), blended (Hybrid)
	const typeTheme = (() => {
		const glow = '--glow-color';
		const base = 'text-white shadow-[0_0_6px_var(--glow-color)]';
		switch((strain.type||'').toLowerCase()){
			case 'sativa':
				return { badge: `${base} bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 [${glow}:rgba(249,115,22,0.55)]`, ring: 'ring-amber-400/40', border: 'border-amber-400/25 hover:border-amber-300/40', pulse: 'after:from-orange-500/40' };
			case 'indica':
				return { badge: `${base} bg-gradient-to-r from-indigo-700 via-purple-700 to-fuchsia-600 [${glow}:rgba(167,139,250,0.5)]`, ring: 'ring-purple-400/40', border: 'border-purple-400/25 hover:border-purple-300/40', pulse: 'after:from-purple-500/40' };
			case 'hybrid':
			default:
				return { badge: `${base} bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 [${glow}:rgba(16,185,129,0.55)]`, ring: 'ring-emerald-400/40', border: 'border-emerald-400/25 hover:border-emerald-300/40', pulse: 'after:from-emerald-400/40' };
		}
	})();

	const fav = Boolean(strain.favorite);

	function handleCardClick(e){
		if (e.target.closest('button, a')) return; // ignore internal interactive clicks
		if (clicked) return;
		setClicked(true);
		setTimeout(()=> setClicked(false), 600);
	}

	useEffect(()=>{
		if (reduceMotion) return; // skip for users preferring less motion
		const el = cardRef.current;
		if (!el) return;
		function handleMove(e){
			const rect = el.getBoundingClientRect();
			const x = (e.clientX - rect.left) / rect.width;
			const y = (e.clientY - rect.top) / rect.height;
			const rotateY = (x - 0.5) * 10; // max 10deg
			const rotateX = (0.5 - y) * 10;
			el.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(0)`;
			el.style.boxShadow = `0 12px 24px -8px rgba(0,0,0,0.6), 0 4px 12px -4px rgba(0,0,0,0.5)`;
		}
		function handleLeave(){
			el.style.transform = '';
			el.style.boxShadow = '';
		}
		el.addEventListener('mousemove', handleMove);
		el.addEventListener('mouseleave', handleLeave);
		return () => {
			el.removeEventListener('mousemove', handleMove);
			el.removeEventListener('mouseleave', handleLeave);
		};
	},[reduceMotion]);

	return (
			<div ref={cardRef} onClick={handleCardClick} className={`relative overflow-hidden bg-gradient-to-b from-black/60 to-black/30 p-4 rounded-xl shadow-lg text-gray-100 w-full border ${typeTheme.border} will-change-transform transition-all duration-300 flex flex-col ${animating ? `scale-105 ring-2 ${typeTheme.ring} shadow-2xl` : 'hover:shadow-xl'} ${clicked ? 'scale-[1.015]' : ''}`}>
				{/* radial burst effect */}
				{clicked && !reduceMotion && (
					<span aria-hidden='true' className={`pointer-events-none absolute inset-0 after:content-[''] after:absolute after:inset-0 after:bg-radial-gradient after:to-transparent ${typeTheme.pulse} after:via-transparent after:opacity-70 after:rounded-xl animate-ping`} />
				)}
				<img
					src={strain.image ?? 'https://upload.wikimedia.org/wikipedia/commons/1/19/Cannabis_sativa_female_flower_closeup.jpg'}
					alt={strain.name}
					className='w-full h-40 sm:h-36 md:h-44 lg:h-48 object-cover rounded-lg mb-3'
					onError={(e) => {
						// show a generic fallback and avoid infinite loop
						e.target.onerror = null;
						e.target.src = 'https://upload.wikimedia.org/wikipedia/commons/1/19/Cannabis_sativa_female_flower_closeup.jpg';
					}}
				/>
				<div className='flex items-start justify-between gap-4'>
				<div>
					<h2 className='font-semibold text-xl'>{strain.name}</h2>
					<p className='text-sm mt-1 text-green-200'>THC: <strong className='text-white'>{strain.thc ?? '—'}%</strong> | CBD: <strong className='text-white'>{strain.cbd ?? '—'}%</strong></p>
					<p className='text-sm mt-1 text-green-100/80'>{/* summary kept for accessibility, effects shown below as badges */}</p>

					{/* Effects badges */}
					<div className='mt-2 flex flex-wrap gap-2'>
						{effectsList.length ? (
							effectsList.map((ef, i) => (
								<span key={i} className='inline-block text-xs px-2 py-1 rounded-full bg-green-800/70 text-green-100'>{ef}</span>
							))
						) : (
							<span className='inline-block text-xs px-2 py-1 rounded-full bg-gray-800/40 text-gray-200'>—</span>
						)}
					</div>
				</div>

				<div className='text-right flex flex-col items-end gap-2'>
					<button
						title={`Toggle filter for ${strain.type}`}
						onClick={(e)=>{ e.stopPropagation(); onFilterType && onFilterType(strain.type); }}
						className={`text-[11px] px-2.5 py-1 rounded-full font-semibold tracking-wide inline-block transition ${typeTheme.badge} relative ${isTypeActive ? 'ring-2 ring-white/60 scale-105' : 'hover:brightness-110'} focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60`}
						aria-pressed={isTypeActive}
					>
						{strain.type}
						{isTypeActive && <span aria-hidden='true' className='absolute inset-0 rounded-full bg-white/15 mix-blend-overlay' />}
					</button>
					<button
						onClick={(e) => { e.stopPropagation(); onToggleFavorite && onToggleFavorite(strain); }}
						title={fav ? 'Remove from favorites' : 'Add to favorites'}
						className={`text-xs px-2 py-1 rounded-full border transition ${fav ? 'bg-yellow-500/20 border-yellow-400/40 text-yellow-200' : 'bg-white/5 border-white/10 text-gray-300 hover:border-yellow-300/40 hover:text-yellow-200'}`}
						aria-pressed={fav}
					>
						{fav ? '★ Favorite' : '☆ Favorite'}
					</button>
				</div>
			</div>

			<div className='mt-4 flex gap-3' role='tablist' aria-label={`${strain.name} view toggle`}> 
				<button
					role='tab'
					aria-selected={view === 'consumer'}
					aria-controls={`consumer-${strain.id}`}
					onClick={() => handleSwitchView('consumer')}
					className={`text-sm px-3 py-1 rounded-full transition transform duration-150 ${view === 'consumer' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-800/50 text-gray-200'} ${activeButton === 'consumer' ? 'scale-95 animate-pulse' : ''}`}>
					Consumer
					</button>
					<button
					role='tab'
					aria-selected={view === 'grower'}
					aria-controls={`grower-${strain.id}`}
					onClick={() => handleSwitchView('grower')}
					className={`text-sm px-3 py-1 rounded-full transition transform duration-150 ${view === 'grower' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-800/50 text-gray-200'} ${activeButton === 'grower' ? 'scale-95 animate-pulse' : ''}`}>
					Grower
					</button>
				</div>

					{/* content area: crossfade when switching views */}
					{view === 'consumer' ? (
						<div id={`consumer-${strain.id}`} tabIndex='0' role='tabpanel' aria-hidden={view !== 'consumer'} className={`mt-3 text-sm space-y-1 ${reduceMotion ? '' : 'transition-all duration-200'} ${animating ? 'opacity-30 -translate-y-2' : 'opacity-100 translate-y-0'}`} style={{flex: 1}}>
							{strain.description && (
								<p className='text-gray-400 mb-2'>
									{strain.description.length > 200 ? strain.description.slice(0, 200) + '…' : strain.description}
								</p>
							)}
							<p><strong>Flavors:</strong> {list(strain.flavors)}</p>
							<p><strong>Aroma:</strong> {list(strain.aroma)}</p>
							<p><strong>Medical uses:</strong> {list(strain.medicalUses)}</p>
							<p><strong>Recommended use:</strong> {strain.recommendedUse ?? '—'}</p>
								{renderMiniEffects()}
								{renderTerpenes()}
						</div>
					) : (
					<div id={`grower-${strain.id}`} tabIndex='0' role='tabpanel' aria-hidden={view !== 'grower'} className={`mt-3 pt-2 border-t text-sm ${reduceMotion ? '' : 'transition-all duration-200'} ${animating ? 'opacity-30 -translate-y-2' : 'opacity-100 translate-y-0'}`} style={{flex: 1}}>
					<h3 className='font-bold'>Grower info</h3>
					<p><strong>Difficulty:</strong> {strain.grow?.difficulty ?? 'Medium'}</p>
					<p><strong>Flowering time:</strong> {strain.grow?.floweringTime ?? '—'}</p>
					<p><strong>Indoor / Outdoor:</strong> {strain.grow?.indoorOutdoor ?? 'Both'}</p>
					<p><strong>Optimal temp:</strong> {strain.grow?.optimalTemp ?? '18–26°C'}</p>
					<p><strong>Feeding:</strong> {strain.grow?.feeding ?? 'Standard nutrients'}</p>
							{renderMiniEffects()}
				</div>
			)}
		</div>
	);
}