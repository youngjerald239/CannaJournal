import { useEffect, useState, useRef, useCallback } from 'react';
import Feed from './Feed';

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReduceMotion(mq.matches);
      const onChange = () => setReduceMotion(mq.matches);
      mq.addEventListener?.('change', onChange);
      // small entrance delay so the animation is noticeable
      if (!mq.matches) {
        const id = setTimeout(() => setMounted(true), 80);
        return () => { clearTimeout(id); mq.removeEventListener?.('change', onChange); };
      }
      setMounted(true);
      return () => mq.removeEventListener?.('change', onChange);
    } catch (e) {
      setMounted(true);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('cannajournal.entries');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecent(parsed.slice(0, 3));
      }
    } catch (e) {
      setRecent([]);
    }
  }, []);

  return (
    <main className='p-4'>
      <section className='relative overflow-hidden rounded-lg'>
        <div className='absolute inset-0 bg-gradient-to-r from-emerald-900 via-slate-900 to-emerald-800 opacity-85'></div>
        <div className='relative max-w-6xl mx-auto px-4 py-16 sm:py-24'>
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-8 items-start'>
            <div className={`${mounted && !reduceMotion ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'} transition-all duration-500`}> 
              <h1 className='text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-tight'>Keep a smarter, simpler weed journal</h1>
              <p className='mt-4 text-lg text-green-100/90 max-w-xl'>Save tasting notes, cultivation tips, and strain profiles in one place. Built for growers and consumers — quick to use and easy to browse.</p>

              <div className='mt-6 flex flex-wrap gap-3'>
                <a href='/strains' className='inline-block px-4 py-2 rounded-md bg-green-500 text-white font-semibold shadow hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-300/40' aria-label='Explore strains'>Explore strains</a>
                <a href='/journal' className='inline-block px-4 py-2 rounded-md bg-white/10 text-green-100 font-medium hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-green-300/30' aria-label='Open your journal'>Open your journal</a>
              </div>

              <div className='mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3'>
                <FeatureCard title='Photos' desc='Attach photos to each entry for visual records.' svg={<svg width='28' height='28' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'><rect x='3' y='5' width='18' height='14' rx='2' stroke='white' strokeWidth='1.4' /><circle cx='12' cy='12' r='2.2' fill='white'/></svg>} />
                <FeatureCard title='Profiles' desc='Store THC/CBD, aromas and effects per strain.' svg={<svg width='28' height='28' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'><path d='M12 2v6' stroke='white' strokeWidth='1.4' strokeLinecap='round'/><path d='M5 11h14' stroke='white' strokeWidth='1.4' strokeLinecap='round'/><path d='M7 18h10' stroke='white' strokeWidth='1.4' strokeLinecap='round'/></svg>} />
                <FeatureCard title='Grower tips' desc='Track difficulty, flowering time, and notes.' svg={<svg width='28' height='28' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'><path d='M12 3c1.5 2 3 4 3 6a3 3 0 11-6 0c0-2 1.5-4 3-6z' stroke='white' strokeWidth='1.2' strokeLinecap='round' strokeLinejoin='round'/><path d='M6 20c2-2 4-3 6-3s4 1 6 3' stroke='white' strokeWidth='1.2' strokeLinecap='round' strokeLinejoin='round'/></svg>} />
              </div>
            </div>

            <div className='hidden lg:flex flex-col w-full'>
              <div className='rounded-xl border border-emerald-400/10 bg-slate-950/60 backdrop-blur-sm overflow-hidden shadow-lg h-[520px] flex'>
                <div className='flex-1 flex flex-col'>
                  <div className='px-4 py-3 border-b border-emerald-400/10 flex items-center justify-between'>
                    <h2 className='text-sm font-semibold uppercase tracking-wide text-emerald-200'>Live Feed</h2>
                    <a href='/feed' className='text-[11px] px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-600/50 border border-emerald-400/30'>Open</a>
                  </div>
                  <div className='flex-1 overflow-hidden'>
                    {/* Reuse Feed but constrain height & hide sidebars */}
                    <div className='h-full'>
                      <MiniFeed />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
  {/* Journal recent entries widget */}
        <div className='mt-12 max-w-6xl mx-auto px-4'>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-lg font-semibold text-green-100'>Recent journal entries</h3>
            <a href='/journal' className='text-sm text-green-200 hover:underline'>View all</a>
          </div>
          <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
            {recent.length === 0 ? (
              <div className='col-span-1 sm:col-span-3 bg-black/30 backdrop-blur-sm p-4 rounded border border-green-300/10 text-green-100/70'>No recent entries yet.</div>
            ) : (
              recent.map(r => (
                <div key={r.id} className='bg-black/30 backdrop-blur-sm p-3 rounded flex items-center gap-3 border border-green-300/10 hover:border-green-300/30 transition'>
                  <div className='w-16 h-12 bg-gray-800 rounded overflow-hidden flex items-center justify-center text-xs text-green-100/60'>
                    {r.photoDataUrl ? <img src={r.photoDataUrl} alt='' className='w-full h-full object-cover' /> : 'No photo'}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='font-medium text-green-100 truncate'>{r.strainName || 'Unknown'}</div>
                    <div className='text-xs text-green-100/70 truncate'>Mood: {r.mood || '-'} • Rating: {r.rating ?? '-'}</div>
                    <div className='text-[10px] text-green-100/50'>{r.timestamp ? new Date(r.timestamp).toLocaleDateString() : ''}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Full feed below for small screens (mobile) */}
      <section className='mt-10 max-w-6xl mx-auto px-0 sm:px-2 lg:hidden'>
        <h3 className='sr-only'>Community Feed</h3>
        <div className='rounded-xl border border-emerald-400/10 overflow-hidden shadow-inner'>
          <Feed />
        </div>
      </section>
    </main>
  );
}

function FeatureCard({ title, desc, svg }) {
  return (
    <div className='bg-white/5 rounded-lg p-3 flex flex-col gap-2'>
      <div className='text-2xl'>{svg}</div>
      <h4 className='font-semibold mt-1 text-white'>{title}</h4>
      <p className='text-sm text-green-100/80'>{desc}</p>
    </div>
  );
}

// Lightweight embedded feed (no trending/suggested sidebars) for hero column
function MiniFeed(){
  const [items,setItems] = useState([]);
  const [cursor,setCursor] = useState(null);
  const [loading,setLoading] = useState(false);
  const scRef = useRef(null);
  const load = useCallback(async (reset=false) => {
    if (loading) return; setLoading(true);
    try {
      const qs = new URLSearchParams(); if (cursor && !reset) qs.set('cursor',cursor);
      const r = await fetch('/feed?'+qs.toString(), { credentials:'include' });
      if (r.ok){ const j = await r.json(); setItems(prev=> reset? j.messages : [...prev, ...j.messages]); setCursor(j.nextCursor); }
    } finally { setLoading(false); }
  }, [cursor, loading]);
  // Run initial load only once after mount
  const didInit = useRef(false);
  useEffect(()=>{
    if (didInit.current) return; didInit.current = true;
    load(true);
  }, [load]);
  // Register scroll handler with correct dependencies
  useEffect(()=>{
    const el = scRef.current; if (!el) return;
    function onScroll(){ if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40 && cursor) load(); }
    el.addEventListener('scroll', onScroll); return ()=> el.removeEventListener('scroll', onScroll);
  }, [cursor, load]);
  return (
    <div ref={scRef} className='h-full overflow-y-auto custom-scrollbar text-emerald-50 text-sm'>
      <div className='divide-y divide-emerald-400/10'>
        {items.map(m => (
          <div key={m.id} className='p-3 hover:bg-slate-900/40'>
            <div className='flex items-center gap-2 mb-1'>
              <span className='text-[10px] px-2 py-0.5 rounded bg-slate-800/60 border border-emerald-400/20'>{m.sender_username||'system'}</span>
              <span className='text-[9px] text-emerald-300/50'>{new Date(m.created_at).toLocaleTimeString()}</span>
            </div>
            <div className='text-[13px] leading-relaxed whitespace-pre-wrap break-words line-clamp-5'>{m.content_text}</div>
          </div>
        ))}
        {loading && <div className='p-3 text-[11px] text-emerald-300/50'>Loading...</div>}
        {!loading && items.length===0 && <div className='p-4 text-[11px] text-emerald-300/50'>No posts yet.</div>}
      </div>
      <div className='mt-4 border-t border-emerald-400/10 pt-3'>
        <h4 className='text-[11px] font-semibold uppercase tracking-wide text-emerald-300/60 mb-2'>Guides & Tips</h4>
  <a href='/guides' className='block p-2 rounded-md bg-slate-800/30 hover:bg-slate-800/50 border border-emerald-400/10 hover:border-emerald-400/30 transition text-[12px] text-emerald-100/90'>Visit the Guides hub for rolling tutorials, consumer tips, and grower best practices →</a>
      </div>
    </div>
  );
}