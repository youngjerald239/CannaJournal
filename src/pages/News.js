import { useState, useEffect } from 'react';

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

export default function News(){
  const [tab, setTab] = useState('consumers'); // 'consumers' | 'growers' | 'rolling'
  const [randomTip, setRandomTip] = useState('');

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

  return (
    <div className='min-h-[calc(100vh-60px)] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-950 via-slate-950 to-slate-950 text-emerald-50 p-4'>
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
              <RollingBasics />
            </>}
            {tab==='consumers' && <>
              <Callout title='Dosage reminder' tone='info'>Start with just a couple light puffs. Effects can take several minutes to fully present.</Callout>
              <ConsumerTips sections={CONSUMER_SECTIONS} />
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
              <GrowerTips sections={GROWER_SECTIONS} />
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
          {tab==='consumers' && (
            <aside className='space-y-3'>
              {Array.from({ length: CONSUMER_SECTIONS.reduce((n,s)=> n + s.tips.length, 0) }).map((_,i)=> (
                <ImagePlaceholder key={'cons-'+i} label={`Consumer tip image ${i+1}`} />
              ))}
            </aside>
          )}
          {tab==='growers' && (
            <aside className='space-y-3'>
              {Array.from({ length: GROWER_SECTIONS.reduce((n,s)=> n + s.tips.length, 0) }).map((_,i)=> (
                <ImagePlaceholder key={'grow-'+i} label={`Grower tip image ${i+1}`} />
              ))}
            </aside>
          )}
        </div>

        <p className='mt-8 text-xs text-emerald-300/50'>Educational content only. Follow local laws and consume responsibly.</p>
      </div>
    </div>
  );
}

function Section({ title, children }){
  return (
    <section className='mb-6 p-4 rounded-xl bg-slate-900/60 border border-emerald-400/10 shadow-inner'>
      <h2 className='text-lg font-semibold mb-2 text-emerald-100'>{title}</h2>
      <div className='space-y-2 text-[14px] text-emerald-200/90'>{children}</div>
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

function RollingBasics(){
  return (
    <div>
      <Section title='How to roll a blunt'>
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
      </Section>
      <Section title='How to roll with rolling papers (joints)'>
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
  // load
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

// Rolling quick-tip pool for the random tip bar
const ROLLING_TIPS = [
  'Warm up dry wraps with your hands to prevent cracking.',
  'Use a filter tip to improve airflow and keep shape.',
  'Pack the tip gently from the filter side for an even burn.',
  'Rotate while lighting to avoid canoeing.',
  'Grind evenly — consistency helps the roll and the burn.'
];

function ConsumerTips({ sections=CONSUMER_SECTIONS }){
  return (
    <div>
      {sections.map((sec, idx) => (
        <Section key={idx} title={sec.title}>
          <ul className='list-disc pl-5 space-y-1'>
            {sec.tips.map((t,i)=> <li key={i}>{t}</li>)}
          </ul>
        </Section>
      ))}
    </div>
  );
}

function GrowerTips({ sections=GROWER_SECTIONS }){
  return (
    <div>
      {sections.map((sec, idx) => (
        <Section key={idx} title={sec.title}>
          <ul className='list-disc pl-5 space-y-1'>
            {sec.tips.map((t,i)=> <li key={i}>{t}</li>)}
          </ul>
          {sec.footnote && <p className='mt-2 text-emerald-300/80 text-sm'>{sec.footnote}</p>}
        </Section>
      ))}
    </div>
  );
}