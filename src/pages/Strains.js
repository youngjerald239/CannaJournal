import StrainCard from '../components/StrainCard';
import BeeMascot from '../components/BeeMascot';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { FixedSizeList } from 'react-window';
import { useLocation } from 'react-router-dom';

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
  const [selectedTypes, setSelectedTypes] = useState([]); // ['Hybrid','Sativa','Indica']
  const [showFilters, setShowFilters] = useState(true);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const prevCountRef = useRef(0);
  const headerRef = useRef(null);
  const [showDockedSummary, setShowDockedSummary] = useState(false);
  const [useVirtual, setUseVirtual] = useState(false);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);

  // Bee landing state
  const [selectedId, setSelectedId] = useState(null);
  const [beePos, setBeePos] = useState({ x: 24, y: 24 });
  const [beeLanding, setBeeLanding] = useState(false);
  const cardElsRef = useRef(new Map());
  const location = useLocation();
  const searchDebounceRef = useRef(null);
  const landTimerRef = useRef(null);

  // Inject lightweight animation keyframes once
  useEffect(() => {
    if (document.getElementById('strain-anim-styles')) return;
    const style = document.createElement('style');
    style.id = 'strain-anim-styles';
    style.textContent = `@keyframes fadeScaleIn{0%{opacity:0;transform:scale(.94)}100%{opacity:1;transform:scale(1)}}.fade-scale-in{animation:fadeScaleIn .35s ease both}`;
    document.head.appendChild(style);
  }, []);

  function toggleType(t) {
    setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }
  function clearTypeFilters() { setSelectedTypes([]); }

  // Load persisted filter prefs and restore scroll
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cj_filters_v1') || '{}');
      if (Array.isArray(saved.selectedTypes)) setSelectedTypes(saved.selectedTypes);
      if (typeof saved.showFavsOnly === 'boolean') setShowFavsOnly(saved.showFavsOnly);
      if (typeof saved.showFilters === 'boolean') setShowFilters(saved.showFilters);
      if (typeof saved.showShortcutHelp === 'boolean') setShowShortcutHelp(saved.showShortcutHelp);
    } catch (_) { }
    try {
      const savedScroll = parseInt(localStorage.getItem('cj_strains_scrollY') || '0', 10);
      if (!isNaN(savedScroll) && savedScroll > 0) {
        requestAnimationFrame(() => { window.scrollTo(0, savedScroll); });
      }
    } catch (_) { }
  }, []);

  // Persist scroll on unmount
  useEffect(() => {
    return () => { try { localStorage.setItem('cj_strains_scrollY', String(window.scrollY)); } catch (_) { } };
  }, []);

  // Persist filters when they change
  useEffect(() => {
    try { localStorage.setItem('cj_filters_v1', JSON.stringify({ selectedTypes, showFavsOnly, showFilters, showShortcutHelp })); } catch (_) { }
  }, [selectedTypes, showFavsOnly, showFilters, showShortcutHelp]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const tag = e.target.tagName.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'f') setShowFavsOnly(f => !f);
      else if (k === 'h') toggleType('Hybrid');
      else if (k === 's') toggleType('Sativa');
      else if (k === 'i') toggleType('Indica');
      else if (e.key === 'Escape') { setShowFavsOnly(false); clearTypeFilters(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filteredStrains = useMemo(() => {
    return strains
      .filter(s => !showFavsOnly || s.favorite)
      .filter(s => !selectedTypes.length || (s.type && selectedTypes.some(t => t.toLowerCase() === s.type.toLowerCase())));
  }, [strains, showFavsOnly, selectedTypes]);

  // Presence management for non-virtual mode
  const [presentIds, setPresentIds] = useState([]);
  const [exitingIds, setExitingIds] = useState(new Set());
  const [enteringIds, setEnteringIds] = useState(new Set());

  useEffect(() => {
    if (useVirtual) return;
    setPresentIds(prev => {
      const next = filteredStrains.map(s => s.id);
      const toExit = prev.filter(id => !next.includes(id));
      const toEnter = next.filter(id => !prev.includes(id));
      if (toExit.length) {
        setExitingIds(old => new Set([...Array.from(old), ...toExit]));
        setTimeout(() => {
          setExitingIds(old => { const copy = new Set(old); toExit.forEach(id => copy.delete(id)); return copy; });
          setPresentIds(list => list.filter(id => !toExit.includes(id)));
        }, 300);
      }
      if (toEnter.length) {
        setEnteringIds(old => new Set([...Array.from(old), ...toEnter]));
        setTimeout(() => setEnteringIds(old => { const copy = new Set(old); toEnter.forEach(id => copy.delete(id)); return copy; }), 350);
      }
      return Array.from(new Set([...prev, ...toEnter]));
    });
  }, [filteredStrains, useVirtual]);
  useEffect(() => { if (!useVirtual && presentIds.length === 0 && filteredStrains.length) setPresentIds(filteredStrains.map(s => s.id)); }, [useVirtual, presentIds.length, filteredStrains]);

  const anyActiveFilters = showFavsOnly || selectedTypes.length > 0;

  // Determine need for virtualization
  useEffect(() => { setUseVirtual(filteredStrains.length > 48); }, [filteredStrains.length]);

  // Resize observer for responsive column calc
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setContainerWidth(e.contentRect.width); });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const columns = useMemo(() => {
    if (containerWidth >= 1024) return 3;
    if (containerWidth >= 640) return 2;
    return 1;
  }, [containerWidth]);

  const virtualRows = useMemo(() => {
    if (!useVirtual) return [];
    const rows = [];
    for (let i = 0; i < filteredStrains.length; i += columns) rows.push(filteredStrains.slice(i, i + columns));
    return rows;
  }, [filteredStrains, useVirtual, columns]);

  // Register card elements for landing animation
  const registerRef = (id, el) => { cardElsRef.current.set(id, el); };
  const getCardCenter = useCallback((id) => {
    const el = cardElsRef.current.get(id);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // Land slightly right of center so we don't block the top-right Grower button
    const x = rect.left + rect.width * 0.62;
    const y = rect.top + rect.height * 0.5;
    return { x, y };
  }, []);
  const landOn = useCallback((id) => {
    if (!id) return;
    setSelectedId(id);
    const el = cardElsRef.current.get(id);
    if (el) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); } catch (_) { }
      if (landTimerRef.current) clearTimeout(landTimerRef.current);
      landTimerRef.current = setTimeout(() => {
        const center = getCardCenter(id);
        if (center) {
          setBeePos(center);
          setBeeLanding(true);
          setTimeout(() => setBeeLanding(false), 900);
        }
      }, 320);
    }
  }, [getCardCenter]);

  // Select via query param (?q=...)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    if (!q || !strains.length) return;
    const lc = q.toLowerCase();
    const match = strains.find(s => (s.name || '').toLowerCase() === lc) || strains.find(s => (s.name || '').toLowerCase().includes(lc));
    if (!match) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      landOn(match.id);
    }, 220);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [location.search, strains, landOn]);

  // Smooth scroll to top if list shrinks drastically
  useEffect(() => {
    const prev = prevCountRef.current;
    const curr = filteredStrains.length;
    if (prev && curr < prev) {
      const ratio = (prev - curr) / Math.max(prev, 1);
      if (ratio > 0.5 && window.scrollY > 150) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevCountRef.current = curr;
  }, [filteredStrains.length]);

  function handleResetAll() {
    setShowFavsOnly(false);
    clearTypeFilters();
    if (window.scrollY > 60) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Docked summary pill visibility
  useEffect(() => {
    function onScroll() {
      if (!headerRef.current) return;
      const rect = headerRef.current.getBoundingClientRect();
      setShowDockedSummary(rect.bottom < 0);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Build strains list
  useEffect(() => {
    let mounted = true;
    async function buildStrains() {
      setLoading(true);
      try {
        const controller = new AbortController();
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
      } catch (_) {
        // ignore; backend failed and we will build local defaults
      }

      // Fallback to local list
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
        grow: { difficulty: 'Medium', floweringTime: null, indoorOutdoor: 'Both', optimalTemp: null, feeding: null },
      }));
      if (mounted) setStrains(results);
      setLoading(false);
    }
    buildStrains();
    return () => { mounted = false; };
  }, []);

  return (
    <>
      <div className='p-4'>
        <div className='max-w-6xl mx-auto px-4'>
          <div ref={headerRef} className='mb-6 flex flex-col gap-4'>
            {/* Legend / filters */}
            <div className='flex flex-wrap items-center gap-2 text-[11px]'>
              <span className='uppercase tracking-wide text-emerald-300/60 mr-1'>Filter:</span>
              <FilterChip label='All' active={!showFavsOnly} onClick={() => setShowFavsOnly(false)} />
              <FilterChip label='Favorites' active={showFavsOnly} onClick={() => setShowFavsOnly(true)} />
            </div>
            <div className='flex flex-col gap-2'>
              <div className='flex items-center flex-wrap gap-2'>
                <button onClick={() => setShowFilters(o => !o)} className='relative px-3 py-1 rounded-md border border-emerald-400/25 bg-slate-900/50 text-[11px] text-emerald-200/90 hover:bg-slate-800/60 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50' aria-expanded={showFilters}>Filters ({filteredStrains.length}){(showFavsOnly || selectedTypes.length > 0) && (<span className='ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-emerald-600 text-[10px] font-semibold text-white'>{(showFavsOnly ? 1 : 0) + selectedTypes.length}</span>)}</button>
                {anyActiveFilters && (
                  <button onClick={handleResetAll} title='Reset all filters' className='px-3 py-1 rounded-md border border-red-400/30 text-[11px] text-red-200/80 hover:text-red-100 hover:bg-red-900/30 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50'>Reset</button>
                )}
                <button onClick={() => setShowShortcutHelp(o => !o)} className='relative px-3 py-1 rounded-md border border-indigo-400/25 bg-slate-900/40 text-[11px] text-indigo-200/90 hover:bg-slate-800/60 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50' aria-expanded={showShortcutHelp}>Shortcuts</button>
                {(showFavsOnly || selectedTypes.length > 0) && !showFilters && (
                  <div className='flex flex-wrap gap-1 text-[10px]'>
                    {showFavsOnly && <span className='px-2 py-0.5 rounded-full bg-green-700/50 text-green-100 border border-green-400/30'>Favorites</span>}
                    {selectedTypes.map(t => (<span key={t} className='px-2 py-0.5 rounded-full bg-green-800/40 text-emerald-100 border border-emerald-400/30'>{t}</span>))}
                  </div>
                )}
              </div>
              {showFilters && (
                <div className='flex flex-wrap gap-2 text-[11px]'>
                  <TypeChip color='hybrid' label='Hybrid' active={selectedTypes.includes('Hybrid')} onClick={() => toggleType('Hybrid')} />
                  <TypeChip color='sativa' label='Sativa' active={selectedTypes.includes('Sativa')} onClick={() => toggleType('Sativa')} />
                  <TypeChip color='indica' label='Indica' active={selectedTypes.includes('Indica')} onClick={() => toggleType('Indica')} />
                  {selectedTypes.length > 0 && (<button type='button' onClick={clearTypeFilters} className='px-2 py-1 text-[10px] rounded-md border border-emerald-400/30 text-emerald-200/80 hover:text-emerald-100 hover:bg-slate-800/50 transition'>Clear</button>)}
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
              <button onClick={() => setShowFavsOnly(f => !f)} className={`relative px-4 py-2 rounded-lg text-xs font-medium tracking-wide transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 border backdrop-blur-md ${showFavsOnly ? 'text-emerald-100 border-emerald-400/30 bg-gradient-to-br from-emerald-900/70 via-slate-900/60 to-slate-800/50 shadow-[0_2px_10px_-2px_rgba(16,185,129,0.35)]' : 'text-emerald-200/80 border-emerald-400/15 bg-gradient-to-br from-emerald-950/40 via-slate-950/30 to-slate-900/30 hover:from-emerald-900/50 hover:via-slate-900/40 hover:to-slate-800/40'}`} aria-pressed={showFavsOnly}>
                <span className='relative z-10'>{showFavsOnly ? 'Showing Favorites' : 'Show Favorites Only'}</span>
                <span aria-hidden='true' className={`pointer-events-none absolute inset-0 rounded-lg ${showFavsOnly ? 'bg-emerald-400/10' : 'bg-emerald-400/5'}`} />
              </button>
              {showFavsOnly && (<span className='text-[11px] text-emerald-300/70'>Filtering {strains.filter(s => s.favorite).length} favorites</span>)}
            </div>
          </div>
          {loading && <p className='mb-4'>Fetching strain summaries…</p>}
          <div ref={containerRef} className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4'>
            {useVirtual ? (
              <FixedSizeList height={Math.min((typeof window !== 'undefined' ? window.innerHeight : 800) - 160, 900)} itemCount={virtualRows.length} itemSize={columns === 1 ? 520 : 500} width={'100%'} className='col-span-full'>
                {({ index, style }) => {
                  const row = virtualRows[index];
                  return (
                    <div style={style} className='grid gap-3 sm:gap-4'>
                      <div className='grid gap-3 sm:gap-4' style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
                        {row.map(strain => (
                          <StrainCard key={strain.id} strain={strain} onFilterType={(t) => toggleType(t)} isTypeActive={selectedTypes.includes(strain.type)} cardClass='fade-scale-in' onSelect={() => landOn(strain.id)} active={selectedId === strain.id} registerRef={registerRef} onToggleFavorite={async (s) => {
                            if (toggling) return; setToggling(s.id);
                            const isFav = s.favorite;
                            try {
                              const method = isFav ? 'DELETE' : 'POST';
                              const resp = await fetch(`/favorites/${s.id}`, { method, credentials: 'include' });
                              if (resp.ok) { setStrains(prev => prev.map(st => st.id === s.id ? { ...st, favorite: !isFav } : st)); }
                            } catch (_) { }
                            finally { setToggling(null); }
                          }} />
                        ))}
                      </div>
                    </div>
                  );
                }}
              </FixedSizeList>
            ) : (
              presentIds.map(id => {
                const strain = filteredStrains.find(s => s.id === id) || strains.find(s => s.id === id);
                if (!strain) return null;
                const exiting = exitingIds.has(id);
                const entering = enteringIds.has(id);
                return (
                  <StrainCard key={id} strain={strain} onFilterType={(t) => toggleType(t)} isTypeActive={selectedTypes.includes(strain.type)} cardClass={`${entering ? 'fade-scale-in' : ''} ${exiting ? 'opacity-0 scale-95 transition duration-300' : ''}`} onSelect={() => landOn(id)} active={selectedId === id} registerRef={registerRef} onToggleFavorite={async (s) => {
                    if (toggling) return; setToggling(s.id);
                    const isFav = s.favorite;
                    try {
                      const method = isFav ? 'DELETE' : 'POST';
                      const resp = await fetch(`/favorites/${s.id}`, { method, credentials: 'include' });
                      if (resp.ok) { setStrains(prev => prev.map(st => st.id === s.id ? { ...st, favorite: !isFav } : st)); }
                    } catch (_) { }
                    finally { setToggling(null); }
                  }} />
                );
              })
            )}
          </div>
        </div>
      </div>
      {/* Floating Bee overlay */}
      <BeeOverlay pos={beePos} landing={beeLanding} />
      <DockedSummary visible={showDockedSummary && (showFavsOnly || selectedTypes.length > 0)} count={filteredStrains.length} types={selectedTypes} favs={showFavsOnly} onReset={handleResetAll} />
    </>
  );
}

// Docked summary pill component (lightweight inline)
function DockedSummary({ visible, count, types, favs, onReset }) {
  if (!visible) return null;
  return (
    <div className='fixed bottom-4 right-4 z-40 pointer-events-auto'>
      <div className='flex items-center gap-2 px-3 py-2 rounded-xl backdrop-blur-md bg-slate-900/70 border border-emerald-400/20 shadow-lg text-[11px] text-emerald-100 animate-[fadeScaleIn_.35s_ease]'>
        <span className='font-semibold tracking-wide'>{count} shown</span>
        {favs && <span className='px-2 py-0.5 rounded-full bg-emerald-600/30 border border-emerald-400/30'>Favs</span>}
        {types.map(t => <span key={t} className='px-2 py-0.5 rounded-full bg-emerald-800/40 border border-emerald-400/30'>{t}</span>)}
        <button onClick={onReset} className='ml-1 text-red-300/80 hover:text-red-200 font-semibold'>×</button>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button type='button' onClick={onClick} className={`px-3 py-1 rounded-full border text-[11px] transition backdrop-blur-sm ${active ? 'bg-emerald-700/40 border-emerald-400/40 text-emerald-100 shadow-inner' : 'bg-slate-900/40 border-emerald-400/15 text-emerald-300/80 hover:bg-slate-800/50 hover:text-emerald-200'} focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60`} aria-pressed={active}>{label}</button>
  );
}

function TypeChip({ color, label, active = false, onClick }) {
  const styles = {
    sativa: 'from-amber-500 via-orange-500 to-rose-500 text-amber-50',
    indica: 'from-indigo-700 via-purple-700 to-fuchsia-600 text-purple-50',
    hybrid: 'from-emerald-500 via-teal-500 to-sky-500 text-emerald-50'
  };
  return onClick ? (
    <button type='button' onClick={onClick} className={`relative text-[10px] tracking-wide px-3 py-1 rounded-full bg-gradient-to-r ${styles[color] || styles.hybrid} border ${active ? 'border-white/60 ring-2 ring-white/40 shadow-lg scale-105' : 'border-white/10 shadow-[0_0_6px_rgba(255,255,255,0.15)]'} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/60 duration-200 ${active ? 'animate-[pulse_1.2s_ease-in-out]' : 'opacity-90 hover:opacity-100'} `} aria-pressed={active}>
      <span className='relative z-10'>{label}</span>
      {active && <span aria-hidden='true' className='absolute inset-0 rounded-full bg-white/10 mix-blend-overlay' />}
    </button>
  ) : (
    <span className={`text-[10px] tracking-wide px-3 py-1 rounded-full bg-gradient-to-r ${styles[color] || styles.hybrid} shadow-[0_0_6px_rgba(255,255,255,0.15)] border border-white/10`}>{label}</span>
  );
}

// Floating bee overlay that "lands" at a target position
function BeeOverlay({ pos, landing }) {
  if (!pos) return null;
  const size = 40;
  return (
    <div className='pointer-events-none fixed inset-0 z-30' aria-hidden='true'>
      <div style={{ position: 'absolute', left: (pos.x - size / 2) + 'px', top: (pos.y - size / 2) + 'px', transition: 'left 320ms cubic-bezier(.2,.8,.2,1), top 320ms cubic-bezier(.2,.8,.2,1)' }}>
        <div className={`relative ${landing ? 'scale-95' : 'scale-100'} transition-transform duration-300`}>
          <div className={`absolute -inset-3 rounded-full ${landing ? 'ring-4 ring-emerald-300/80 shadow-[0_0_36px_10px_rgba(16,185,129,0.55)] drop-shadow-[0_0_10px_rgba(16,185,129,0.6)]' : 'ring-2 ring-emerald-400/40'}`} />
          <BeeMascot watching={!landing} coverEyes={false} lookRatio={0.5} blink={false} flap={landing} isIdle={!landing} eyeSpeed={3} />
        </div>
      </div>
    </div>
  );
}