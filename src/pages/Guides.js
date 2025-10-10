import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// Tip content data so we can render and also count for placeholders
const CONSUMER_SECTIONS = [
  {
    title: 'Getting started safely',
    tips: [
      'Start low, go slow: 1–2 small puffs; wait 10–15 minutes before more.',
      'Hydrate and have snacks available; avoid mixing with alcohol.',
      'Choose balanced strains (e.g., 1:1 THC:CBD) if new to cannabis.',
      'Know your setting: comfortable, trusted company, no driving.'
    ]
  },
  {
    title: 'Improving your experience',
    tips: [
      'Grind evenly; avoid stems and seeds for smoother burns.',
      'Use fresh papers or wraps; store in a sealed bag to prevent drying.',
      'Consider a filter tip for better airflow and cleaner pulls.',
      'Rotate while lighting; take steady, gentle draws to prevent canoeing.'
    ]
  },
  {
    title: 'Storage & freshness',
    tips: [
      'Use airtight glass jars with humidity packs (55–62% RH).',
      'Keep away from heat and light; avoid fridges/freezers.',
      'Label jars with strain and date; consume within a few months for best flavor.'
    ]
  }
];

const GROWER_SECTIONS = [
  {
    title: 'Environment fundamentals',
    tips: [
      'Veg: 18/6 light, 23–27°C, 55–65% RH. Flower: 12/12 light, 20–26°C, 40–50% RH.',
      'Ensure strong air exchange and gentle circulation to prevent mold.',
      'Use a VPD chart to balance temp and humidity for transpiration.'
    ]
  },
  {
    title: 'Nutrition & watering',
    tips: [
      'pH: 5.8–6.3 (soilless), 6.2–6.8 (soil). Calibrate meters regularly.',
      'Water to runoff; allow media to dry to appropriate weight between waterings.',
      'Start nutrients light (25–50%); watch tips for burn and leaves for deficiency.'
    ]
  },
  {
    title: 'Training, harvest, and curing',
    tips: [
      'Low-stress training (LST) for even canopy; prune lower larf to focus tops.',
      'Harvest based on trichomes (cloudy/amber); avoid only pistil color.',
      'Dry 7–14 days at ~18–20°C and 55–60% RH; then cure in jars burped daily.'
    ],
    footnote: 'Tip: Good drying and curing preserve terpenes and smoothness more than any single grow trick.'
  },
  {
    title: 'IPM (Integrated Pest Management) basics',
    tips: [
      'Quarantine new clones; inspect with a loupe before introducing to the room.',
      'Keep the room clean; remove plant waste; avoid overwatering.',
      'Use sticky traps for monitoring; treat early with safe products as needed.'
    ]
  }
];

export default function Guides(){
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || localStorage.getItem('guides_tab') || 'consumers';
  const [tab, setTab] = useState(initialTab); // 'consumers' | 'growers' | 'rolling'
  const [randomTip, setRandomTip] = useState('');
  const [images, setImages] = useState([]);
  const isAdmin = user?.role === 'admin';
  const [progress, setProgress] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState('');

  // scroll progress bar
  useEffect(()=>{
    function onScroll(){
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      const pct = Math.max(0, Math.min(100, (scrollTop / Math.max(1, scrollHeight - clientHeight)) * 100));
      setProgress(pct);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return ()=> window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    // sync tab to URL and localStorage
    const p = new URLSearchParams(searchParams);
    p.set('tab', tab);
    setSearchParams(p, { replace: true });
    try { localStorage.setItem('guides_tab', tab); } catch(_){}
  }, [tab, setSearchParams, searchParams]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch('/guides/images', { credentials: 'include' });
        if (!mounted) return;
        if (r.ok) {
          const j = await r.json();
          setImages(Array.isArray(j) ? j : []);
        }
      } catch(_){}
    })();
    return () => { mounted = false; };
  }, []);

  function getTipPool(active){
    if (active === 'consumers') return CONSUMER_SECTIONS.flatMap(s=> s.tips);
    if (active === 'growers') return GROWER_SECTIONS.flatMap(s=> s.tips);
    return ROLLING_TIPS;
  }
  function shuffleTip(){
    const pool = getTipPool(tab);
    if (!pool.length) { setRandomTip(''); return; }
    const next = pool[Math.floor(Math.random() * pool.length)];
    setRandomTip(next);
  }

  // Generate section anchors for TOC
  const slug = (s)=> s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  const rollingToc = useMemo(()=> [
    { id: 'rolling-blunt', title: 'Blunt' },
    { id: 'rolling-joints', title: 'Joints' },
  ], []);
  const consumerToc = useMemo(()=> CONSUMER_SECTIONS.map(s=> ({ id: slug(s.title), title: s.title })), []);
  const growerToc = useMemo(()=> GROWER_SECTIONS.map(s=> ({ id: slug(s.title), title: s.title })), []);

  // allocate images sequentially for the active tab's sections
  const imagesPool = images;
  let imgIdx = 0;
  function nextImages(count){
    const out = [];
    for (let i=0; i<count; i++) {
      const img = imagesPool[imgIdx];
      if (img) { out.push(img); imgIdx++; }
      else { out.push(null); }
    }
    return out;
  }

  return (
    <div className='min-h-[calc(100vh-60px)] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-950 via-slate-950 to-slate-950 text-emerald-50 p-4'>
      {/* scroll progress bar */}
      <div className='fixed left-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 shadow-[0_0_10px_rgba(34,197,94,0.6)]' style={{ width: progress + '%' }} />
      <div className='max-w-5xl mx-auto'>
        <div className='mb-6 rounded-2xl border border-emerald-400/10 bg-slate-900/50 backdrop-blur-sm p-4 sm:p-6 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.6)]'>
          <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
            <div>
              <h1 className='text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-200 via-green-200 to-teal-200 bg-clip-text text-transparent'>Guides & Tips</h1>
              <p className='text-emerald-200/70 text-sm'>Rolling tutorials, helpful tips for consumers, and best practices for growers.</p>
            </div>
            <nav className='flex gap-2'>
              <TabButton active={tab==='rolling'} onClick={()=> setTab('rolling')}>Rolling Basics</TabButton>
              <TabButton active={tab==='consumers'} onClick={()=> setTab('consumers')}>For Consumers</TabButton>
              <TabButton active={tab==='growers'} onClick={()=> setTab('growers')}>For Growers</TabButton>
            </nav>
          </div>
          {isAdmin && <AdminUploader onUploaded={(list)=> setImages(list)} />}
          {/* Sticky per-tab TOC */}
          <div className='mt-3 sticky top-16 z-10'>
            {tab==='rolling' && <Toc items={rollingToc} />}
            {tab==='consumers' && <Toc items={consumerToc} />}
            {tab==='growers' && <Toc items={growerToc} />}
          </div>
        </div>

        {/* Random tip bar */}
        <div className='mb-4 rounded-xl border border-emerald-400/10 bg-slate-900/50 p-3 flex items-center gap-3'>
          <span className='text-xl' aria-hidden>💡</span>
          <div className='flex-1 text-sm text-emerald-100'>{randomTip || 'Click the dice for a quick tip from this section.'}</div>
          <button onClick={shuffleTip} className='px-3 py-1.5 rounded-lg text-sm bg-emerald-700/40 hover:bg-emerald-600/50 border border-emerald-400/30'>🎲 I’m feeling lucky</button>
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-3 gap-4'>
          <div className='lg:col-span-2 space-y-4'>
            {tab==='rolling' && <>
              <Callout title='Starter kit' tone='success'>Grinder • Papers / Wraps • Filter tips • Lighter • Rolling tray • Small poker</Callout>
              <RollingBasics nextImages={nextImages} ids={rollingToc.map(i=> i.id)} onOpen={setLightboxUrl} />
            </>}
            {tab==='consumers' && <>
              <Callout title='Dosage reminder' tone='info'>Start with just a couple light puffs. Effects can take several minutes to fully present.</Callout>
              <ConsumerTips sections={CONSUMER_SECTIONS} nextImages={nextImages} ids={consumerToc.map(i=> i.id)} onOpen={setLightboxUrl} />
              <Checklist title='Consumer starter checklist' storageKey='cj_guides_consumer_checklist' items={[
                { id:'kit-grinder', label:'Grinder' },
                { id:'kit-papers', label:'Papers or hemp wraps' },
                { id:'kit-filters', label:'Filter tips' },
                { id:'kit-lighter', label:'Lighter or matches' },
                { id:'kit-tray', label:'Rolling tray' }
              ]} />
              <Accordion items={[
                { q:'Why does my joint canoe?', a:'Usually uneven packing, fast draws, or lighting only one edge. Roll evenly, rotate while lighting, and take steady draws.' },
                { q:'What humidity is best for flower storage?', a:'Aim for 55–62% RH in airtight glass jars with humidity packs to keep aromas and burn quality.' }
              ]} />
            </>}
            {tab==='growers' && <>
              <Callout title='Environment targets' tone='warning'>Veg: 23–27°C, 55–65% RH • Flower: 20–26°C, 40–50% RH • Fresh air exchange and gentle circulation are essential.</Callout>
              <GrowerTips sections={GROWER_SECTIONS} nextImages={nextImages} ids={growerToc.map(i=> i.id)} onOpen={setLightboxUrl} />
              <Checklist title='Grow room checklist' storageKey='cj_guides_grower_checklist' items={[
                { id:'env-meter', label:'Thermo-hygrometer / VPD chart' },
                { id:'ph-meter', label:'Calibrated pH pen' },
                { id:'fans', label:'Oscillating fans + exhaust' },
                { id:'filters', label:'Carbon filter (odor) as needed' }
              ]} />
              <Accordion items={[
                { q:'When to flip to flower?', a:'After plants fill ~70% of the space and you can manage the stretch. Many strains double in height after the flip.' },
                { q:'How long to cure?', a:'Dry 7–14 days, then cure in jars for 2–4+ weeks, burping daily at first. Slower cures preserve terpenes.' }
              ]} />
            </>}
          </div>
          {/* no sidebars; images render under each section */}
        </div>

        <p className='mt-8 text-xs text-emerald-300/50'>Educational content only. Follow local laws and consume responsibly.</p>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div className='fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4' onClick={()=> setLightboxUrl('')}>
          <img src={lightboxUrl} alt='' onClick={(e)=> e.stopPropagation()} className='max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl border border-slate-700 object-contain' />
        </div>
      )}
    </div>
  );
}

function Section({ title, children, id }){
  return (
    <section id={id} className='mb-6'>
      <div className='relative p-[1px] rounded-2xl bg-gradient-to-r from-emerald-600/30 via-teal-500/20 to-cyan-400/30'>
        <div className='group rounded-2xl bg-slate-900/60 border border-emerald-400/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] p-4'>
          <h2 className='text-lg font-semibold mb-2 text-emerald-100 flex items-center gap-2'>
            <a className='opacity-0 group-hover:opacity-100 transition text-emerald-300/60' href={`#${id}`} title='Link to section'>#</a>
            <span>{title}</span>
          </h2>
          <div className='space-y-2 text-[14px] text-emerald-200/90'>{children}</div>
        </div>
      </div>
    </section>
  );
}

function TabButton({ active, onClick, children }){
  return (
    <button onClick={onClick} className={'px-3 py-1.5 rounded-lg border text-sm transition ' + (active ? 'bg-emerald-700/40 border-emerald-400/40 shadow-[0_0_12px_rgba(16,185,129,0.25)]' : 'bg-slate-900/50 border-emerald-400/10 hover:border-emerald-400/30 hover:bg-slate-900/70')}>{children}</button>
  );
}

function ImagePlaceholder({ label }){
  return (
    <div className='rounded-xl border-2 border-dashed border-emerald-400/20 bg-slate-900/40 p-4 text-center'>
      <div className='w-full aspect-video rounded-lg bg-slate-800/40 flex items-center justify-center text-emerald-300/40 text-sm'>Image placeholder</div>
      <div className='mt-2 text-[12px] text-emerald-300/70'>{label}</div>
    </div>
  );
}

function GuideImage({ url, label, onOpen }){
  return (
    <button onClick={()=> onOpen?.(url)} className='group text-left rounded-xl overflow-hidden border border-emerald-400/10 bg-slate-900/40 outline-none focus:ring-2 focus:ring-emerald-500/50 transition'>
      <div className='overflow-hidden'>
        <img src={url} alt={label} className='w-full aspect-video object-cover transform transition duration-300 group-hover:scale-[1.03] group-hover:brightness-110' />
      </div>
      <div className='px-3 py-1 text-[12px] text-emerald-300/70'>{label}</div>
    </button>
  );
}

function RollingBasics({ nextImages, ids=[], onOpen }){
  return (
    <div>
      <Section title='How to roll a blunt' id={ids[0] || 'rolling-blunt'}>
        <ol className='list-decimal pl-5 space-y-1'>
          <li>Grind 0.5–1g of flower (medium-coarse).</li>
          <li>Use a cigarillo wrap or hemp blunt wrap. Moisten the edge slightly for flexibility.</li>
          <li>Optional: Add a filter tip (rolled cardstock) for structure and airflow.</li>
          <li>Fill the wrap evenly. Distribute more toward the center, less at the ends.</li>
          <li>Tuck the edge under the flower, then roll upward to form a cylinder.</li>
          <li>Seal with gentle moisture/pressure along the edge. Smooth out soft spots.</li>
          <li>Pack the ends with a pen tip or poker; twist the tip to close.</li>
          <li>Light evenly and rotate to avoid canoeing. Draw gently; don’t overheat.</li>
        </ol>
        <p className='mt-2 text-emerald-300/80 text-sm'>Tip: Fresh wraps are easier to work with. If cracking, warm the wrap between hands for a few seconds.</p>
        <div className='mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3'>
          {(nextImages ? nextImages(8) : []).map((img, i)=> (
            img?.url ? <GuideImage key={i} url={img.url} label={`Blunt step image ${i+1}`} onOpen={onOpen} /> : <ImagePlaceholder key={i} label={`Blunt step image ${i+1}`} />
          ))}
        </div>
      </Section>
      <Section title='How to roll with rolling papers (joints)' id={ids[1] || 'rolling-joints'}>
        <ol className='list-decimal pl-5 space-y-1'>
          <li>Grind flower fine-to-medium. Papers burn best with uniform grind.</li>
          <li>Create a filter tip: fold a few accordion pleats in a strip of cardstock, then roll.</li>
          <li>Place the filter in one end of the paper, gum side facing away from you.</li>
          <li>Evenly distribute 0.3–0.7g along the trough; shape by gently rocking.</li>
          <li>Tuck the non-gummed edge, then roll up to the gum. Lick lightly and seal.</li>
          <li>Twist the tip. Pack gently from the filter side for a firm, even burn.</li>
          <li>Optional: Use a rolling tray and a rolling machine for consistency.</li>
        </ol>
        <p className='mt-2 text-emerald-300/80 text-sm'>Tip: Thin rice or hemp papers burn cleaner and slower. Practice improves consistency quickly.</p>
        <div className='mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3'>
          {(nextImages ? nextImages(7) : []).map((img, i)=> (
            img?.url ? <GuideImage key={i} url={img.url} label={`Joint step image ${i+1}`} onOpen={onOpen} /> : <ImagePlaceholder key={i} label={`Joint step image ${i+1}`} />
          ))}
        </div>
      </Section>
    </div>
  );
}

// Fun extras: callouts, accordion, and a simple checklist with local persistence
function Callout({ title, tone='info', children }){
  const toneStyles = tone==='success' ? 'bg-emerald-900/40 border-emerald-400/30' : tone==='warning' ? 'bg-amber-900/20 border-amber-300/30' : 'bg-slate-800/40 border-emerald-400/20';
  const emoji = tone==='success' ? '✅' : tone==='warning' ? '⚠️' : '💡';
  return (
    <div className={`p-3 rounded-xl border ${toneStyles} flex items-start gap-2`}>
      <div className='text-xl' aria-hidden>{emoji}</div>
      <div className='text-sm'>
        <div className='font-semibold text-emerald-100 mb-0.5'>{title}</div>
        <div className='text-emerald-200/90'>{children}</div>
      </div>
    </div>
  );
}

function Accordion({ items }){
  const [open, setOpen] = useState(null);
  return (
    <div className='rounded-xl border border-emerald-400/10 divide-y divide-emerald-400/10 bg-slate-900/50'>
      {items.map((it, idx)=>(
        <div key={idx}>
          <button onClick={()=> setOpen(o=> o===idx? null: idx)} className='w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-900/60'>
            <span className='text-sm text-emerald-100'>{it.q}</span>
            <span className='text-emerald-300/60 text-lg'>{open===idx? '−':'+'}</span>
          </button>
          {open===idx && (
            <div className='px-3 pb-3 text-[14px] text-emerald-200/90'>{it.a}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function Checklist({ title, items, storageKey }){
  const [checks, setChecks] = useState({});
  useEffect(()=>{
    try { const raw = localStorage.getItem(storageKey); if (raw) setChecks(JSON.parse(raw)); } catch(_){}
  }, [storageKey]);
  function toggle(id){
    setChecks(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch(_){}
      return next;
    });
  }
  return (
    <div className='p-3 rounded-xl border border-emerald-400/10 bg-slate-900/50'>
      <div className='text-sm font-semibold text-emerald-100 mb-2'>{title}</div>
      <ul className='space-y-1'>
        {items.map(it => (
          <li key={it.id}>
            <label className='inline-flex items-center gap-2 text-[14px] cursor-pointer'>
              <input type='checkbox' checked={Boolean(checks[it.id])} onChange={()=> toggle(it.id)} className='accent-emerald-500' />
              <span className='text-emerald-200/90'>{it.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TipItem({ text }){
  async function share(){
    const shareText = text;
    if (navigator.share){
      try { await navigator.share({ text: shareText }); return; } catch(_){}
    }
    try { await navigator.clipboard.writeText(shareText); alert('Tip copied'); } catch(_) { /* no-op */ }
  }
  async function copy(){
    try { await navigator.clipboard.writeText(text); alert('Tip copied'); } catch(_){}
  }
  return (
    <div className='flex items-start gap-2'>
      <span className='flex-1'>{text}</span>
      <button onClick={copy} title='Copy tip' className='text-[12px] px-2 py-0.5 rounded-md border border-emerald-400/20 hover:bg-slate-800/60'>📋</button>
      <button onClick={share} title='Share tip' className='text-[12px] px-2 py-0.5 rounded-md border border-emerald-400/20 hover:bg-slate-800/60'>🔗</button>
    </div>
  );
}

function ConsumerTips({ sections=CONSUMER_SECTIONS, nextImages, ids=[], onOpen }){
  return (
    <div>
      {sections.map((sec, idx) => (
        <Section key={idx} title={sec.title} id={ids[idx]}>
          <ul className='list-disc pl-5 space-y-1'>
            {sec.tips.map((t,i)=> <li key={i}><TipItem text={t} /></li>)}
          </ul>
          <div className='mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3'>
            {(nextImages ? nextImages(sec.tips.length) : []).map((img, i)=> (
              img?.url ? <GuideImage key={i} url={img.url} label={`Image for tip ${i+1}`} onOpen={onOpen} /> : <ImagePlaceholder key={i} label={`Image for tip ${i+1}`} />
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

function GrowerTips({ sections=GROWER_SECTIONS, nextImages, ids=[], onOpen }){
  return (
    <div>
      {sections.map((sec, idx) => (
        <Section key={idx} title={sec.title} id={ids[idx]}>
          <ul className='list-disc pl-5 space-y-1'>
            {sec.tips.map((t,i)=> <li key={i}><TipItem text={t} /></li>)}
          </ul>
          {sec.footnote && <p className='mt-2 text-emerald-300/80 text-sm'>{sec.footnote}</p>}
          <div className='mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3'>
            {(nextImages ? nextImages(sec.tips.length) : []).map((img, i)=> (
              img?.url ? <GuideImage key={i} url={img.url} label={`Image for tip ${i+1}`} onOpen={onOpen} /> : <ImagePlaceholder key={i} label={`Image for tip ${i+1}`} />
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

// Sticky TOC with scrollspy
function Toc({ items }){
  const [active, setActive] = useState(items?.[0]?.id || null);
  useEffect(()=>{
    if (!items?.length) return;
    const obs = new IntersectionObserver((entries)=>{
      const vis = entries.filter(e=> e.isIntersecting).sort((a,b)=> b.intersectionRatio - a.intersectionRatio);
      if (vis[0]?.target?.id) setActive(vis[0].target.id);
    }, { rootMargin: '-20% 0px -70% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
    items.forEach(it=> { const el = document.getElementById(it.id); if (el) obs.observe(el); });
    return ()=> obs.disconnect();
  }, [items]);
  function scrollTo(id){
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 90; // offset under navbar
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
  return (
    <div className='flex gap-2 overflow-auto no-scrollbar py-1 px-1 rounded-xl bg-slate-900/50 border border-emerald-400/10'>
      {items.map(it => (
        <button key={it.id} onClick={()=> scrollTo(it.id)} className={'px-3 py-1.5 rounded-full text-xs border transition whitespace-nowrap ' + (active===it.id ? 'bg-emerald-700/40 border-emerald-400/40 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.25)]' : 'bg-slate-900/50 border-emerald-400/10 text-emerald-200/80 hover:border-emerald-400/30')}>{it.title}</button>
      ))}
    </div>
  );
}

function AdminUploader({ onUploaded }){
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function handleFiles(e){
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const r = await fetch('/guides/upload', { method: 'POST', credentials: 'include', body: fd });
      if (!r.ok) throw new Error('Upload failed');
      // After upload, refresh full list
      const listRes = await fetch('/guides/images', { credentials: 'include' });
      const list = listRes.ok ? await listRes.json() : [];
      if (onUploaded) onUploaded(Array.isArray(list) ? list : []);
    } catch (e) { setError(e.message || 'Upload failed'); }
    finally { setBusy(false); e.target.value = ''; }
  }
  return (
    <div className='mt-3 p-3 rounded-lg border border-emerald-400/10 bg-slate-900/60'>
      <div className='text-[12px] mb-2 text-emerald-200/80'>Admin: Upload images for Guides sidebar. JPG/PNG up to 10MB each.</div>
      <input type='file' accept='image/*' multiple disabled={busy} onChange={handleFiles} />
      {busy && <span className='ml-2 text-emerald-300/80 text-[12px]'>Uploading…</span>}
      {error && <div className='text-amber-300/80 text-[12px] mt-1'>{error}</div>}
    </div>
  );
}

// Rolling quick-tip pool for the random tip bar
const ROLLING_TIPS = [
  'Warm up dry wraps with your hands to prevent cracking.',
  'Use a filter tip to improve airflow and keep shape.',
  'Pack the tip gently from the filter side for an even burn.',
  'Rotate while lighting to avoid canoeing.',
  'Grind evenly — consistency helps the roll and the burn.'
];
