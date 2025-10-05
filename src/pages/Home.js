import { useEffect, useState } from 'react';

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
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-8 items-center'>
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

            <div className='hidden lg:block'>
              {/* decorative image / placeholder */}
              <div className='w-full h-64 rounded-lg overflow-hidden shadow-lg bg-green-800/20 flex items-center justify-center'>
                <img loading='lazy' src='https://weedrepublic.com/cdn/shop/articles/Blue_dream_marijuana_primary.png?height=932&v=1540321832' alt='Cannabis flower' className='w-full h-full object-cover opacity-90' />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recent entries widget */}
      <section className='mt-8 max-w-6xl mx-auto px-4'>
        <div className='flex items-center justify-between mb-3'>
          <h3 className='text-lg font-semibold'>Recent entries</h3>
          <a href='/journal' className='text-sm text-green-200 hover:underline'>View all</a>
        </div>
        <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
          {recent.length === 0 ? (
            <div className='col-span-1 sm:col-span-3 bg-black/40 p-4 rounded'>No recent entries yet.</div>
          ) : (
            recent.map((r) => (
              <div key={r.id} className='bg-black/30 p-3 rounded flex items-center gap-3'>
                <div className='w-16 h-12 bg-gray-800 rounded overflow-hidden flex items-center justify-center'>
                  {r.photoDataUrl ? <img src={r.photoDataUrl} alt='' className='w-full h-full object-cover'/> : <span className='text-xs text-green-100/60 px-1'>No photo</span>}
                </div>
                <div className='flex-1'>
                  <div className='font-medium'>{r.strainName || 'Unknown'}</div>
                  <div className='text-sm text-green-100/70'>Mood: {r.mood} • Rating: {r.rating}</div>
                  <div className='text-xs text-green-100/60'>{new Date(r.timestamp).toLocaleDateString()}</div>
                </div>
              </div>
            ))
          )}
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