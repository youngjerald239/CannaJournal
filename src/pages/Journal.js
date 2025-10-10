import { useEffect, useState, useRef } from 'react';
import { getAllEntries, putEntries, deleteEntry as dbDeleteEntry } from '../lib/db';
// Static tag list used for suggestions; module-scoped so it's stable and not a missing-deps source
const DEFAULT_TAGS = ['Onset','Flavor','Aroma','Environment','SideEffect','Focus','Relax','Sleep','Creativity'];

export default function Journal() {
	const [strains, setStrains] = useState([]);
	const [, setLoadingStrains] = useState(true);

	// form state
	const [strainId, setStrainId] = useState('');
	// Structured effect sliders (1-5)
	const [effectScores, setEffectScores] = useState({
		relaxation: 3,
		energy: 3,
		focus: 3,
		euphoria: 3,
		body: 3,
		head: 3,
	});
	const [mood, setMood] = useState('Relaxed');
	const [rating, setRating] = useState(3);
	const [notes, setNotes] = useState('');
	// undo/redo stacks for notes (store previous snapshots)
	const [history, setHistory] = useState([]); // array of past note states (used for undo)
	const [future, setFuture] = useState([]);   // array of undone states we can redo
	const notesRef = useRef(null);
	const NOTE_MAX = 1000;
	// Tag personalization & autocomplete
	const [quickTags, setQuickTags] = useState(DEFAULT_TAGS);
	const [caretPos, setCaretPos] = useState(0);
	const [suggestions, setSuggestions] = useState([]); // current filtered tags
	const [showSuggest, setShowSuggest] = useState(false);
	const [activeSuggest, setActiveSuggest] = useState(0);
	const [suggestQuery, setSuggestQuery] = useState('');
	// Stats & sentiment
	const [sentiment, setSentiment] = useState(null); // {score,label}
	const [readStats, setReadStats] = useState({ words:0, ease:null, easeLabel:'', readingTime: '0s' });
	const [photoDataUrl, setPhotoDataUrl] = useState(null);

	const [entries, setEntries] = useState([]);
	const [recs, setRecs] = useState([]);
	const [loadingRecs, setLoadingRecs] = useState(false);
	const fileRef = useRef(null);

	// Load strains from backend once
	useEffect(() => {
		// load strains from backend (best-effort)
		let cancelled = false;
		async function load() {
			setLoadingStrains(true);
			try {
				const res = await fetch('http://localhost:5002/strains');
				if (!res.ok) throw new Error('no-strains');
				const data = await res.json();
				if (!cancelled) setStrains(Array.isArray(data) ? data : []);
			} catch (e) {
				// fallback minimal list
				if (!cancelled) setStrains([{ id: 0, name: 'Unknown / custom' }]);
			} finally {
				if (!cancelled) setLoadingStrains(false);
			}
		}
		load();
		return () => { cancelled = true; };
	}, []);

		useEffect(() => {
			let mounted = true;
			(async () => {
				try {
					// Load local entries and merge with server (best-effort)
					const all = await getAllEntries();
					if (mounted) setEntries(all.sort((a,b)=> (b.timestamp||b.id).localeCompare(a.timestamp||a.id)));
					// Try to refresh from server (credentials included so cookie session is sent)
					try {
						const res = await fetch('/journal', { credentials: 'include' });
						if (res.ok) {
							const data = await res.json();
							// overwrite local view with server entries
							if (mounted && Array.isArray(data)) setEntries(data.sort((a,b)=> (b.timestamp||b.id).localeCompare(a.timestamp||a.id)));
						}
					} catch (err) {
						// ignore
					}
				} catch (e) {
					setEntries([]);
				}
			})();
			return () => { mounted = false; };
		}, []);

	function updateEffect(key, value) {
		setEffectScores((prev) => ({ ...prev, [key]: Number(value) }));
	}

		async function resizeImage(file, maxDim = 1024, quality = 0.75) {
			return new Promise((resolve, reject) => {
				const img = new Image();
				const reader = new FileReader();
				reader.onload = () => {
					img.onload = () => {
						try {
							const canvas = document.createElement('canvas');
							let { width, height } = img;
							if (width > maxDim || height > maxDim) {
								if (width > height) {
									height = Math.round((height * maxDim) / width);
									width = maxDim;
								} else {
									width = Math.round((width * maxDim) / height);
									height = maxDim;
								}
							}
							canvas.width = width;
							canvas.height = height;
							const ctx = canvas.getContext('2d');
							ctx.drawImage(img, 0, 0, width, height);
							const dataUrl = canvas.toDataURL('image/jpeg', quality);
							resolve(dataUrl);
						} catch (err) {
							reject(err);
						}
					};
					img.onerror = (err) => reject(err);
					img.src = String(reader.result);
				};
				reader.onerror = (err) => reject(err);
				reader.readAsDataURL(file);
			});
		}

		async function handleFile(e) {
			const f = e.target.files?.[0];
			if (!f) return;
			try {
				const resized = await resizeImage(f, 1024, 0.75);
				setPhotoDataUrl(resized);
			} catch (err) {
				// fallback to original
				const reader = new FileReader();
				reader.onload = () => setPhotoDataUrl(reader.result?.toString() || null);
				reader.readAsDataURL(f);
			}
		}

	function clearForm() {
		setStrainId('');
		setEffectScores({ relaxation:3, energy:3, focus:3, euphoria:3, body:3, head:3 });
		setMood('Relaxed');
		setRating(3);
		setNotes('');
		setSentiment(null);
		setReadStats({words:0,ease:null,easeLabel:'', readingTime:'0s'});
		setPhotoDataUrl(null);
		if (fileRef.current) fileRef.current.value = null;
	}

	function saveEntry() {
		const timestamp = new Date().toISOString();
		const strainName = strains.find((s) => String(s.id) === String(strainId))?.name || (strainId ? strainId : 'Unknown');
		const entry = { id: timestamp, timestamp, strainId, strainName, mood, rating, notes, photoDataUrl, effectScores };
		(async () => {
			await putEntries([entry]);
			try {
				await fetch('/journal', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([entry]) });
			} catch (err) { /* ignore */ }
			const all = await getAllEntries();
			const sorted = all.sort((a,b)=> (b.timestamp||b.id).localeCompare(a.timestamp||a.id));
			setEntries(sorted);
			if (sorted.length) {
				setLoadingRecs(true);
				fetch('/recommendations', { credentials: 'include' })
					.then(r => r.ok ? r.json() : [])
					.then(d => setRecs(Array.isArray(d)?d:[]))
					.catch(()=>{})
					.finally(()=> setLoadingRecs(false));
			}
		})();
		clearForm();
	}

		// Load personalized tag ordering (DEFAULT_TAGS is static)
		useEffect(()=>{
			try {
				const raw = localStorage.getItem('cj_last_tags');
				if (raw) {
					const arr = JSON.parse(raw);
					if (Array.isArray(arr)) {
						const merged = Array.from(new Set(arr.concat(DEFAULT_TAGS)));
						setQuickTags(merged);
					}
				}
			} catch(_){}
		},[]);

		function recordTag(tag){
			try {
				const raw = localStorage.getItem('cj_last_tags');
				let arr = Array.isArray(JSON.parse(raw||'[]')) ? JSON.parse(raw||'[]') : [];
				arr = [tag, ...arr.filter(t=>t!==tag)].slice(0,25);
				localStorage.setItem('cj_last_tags', JSON.stringify(arr));
				const merged = Array.from(new Set(arr.concat(DEFAULT_TAGS)));
				setQuickTags(merged);
			} catch(_){}
		}

	function deleteEntry(id) {
			if (!window.confirm('Delete this entry?')) return;
			(async () => {
				await dbDeleteEntry(id);
				const all = await getAllEntries();
				const sorted = all.sort((a,b)=> (b.timestamp||b.id).localeCompare(a.timestamp||a.id));
				setEntries(sorted);
				if (sorted.length) {
					setLoadingRecs(true);
					fetch('/recommendations', { credentials: 'include' })
						.then(r => r.ok ? r.json() : [])
						.then(d => setRecs(Array.isArray(d)?d:[]))
						.catch(()=>{})
						.finally(()=> setLoadingRecs(false));
				}
			})();
	}



	// export/import helpers (component scope)
	function downloadFile(filename, content, mime = 'application/json') {
		const blob = new Blob([content], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	function exportJSON() {
		(async () => {
			const all = await getAllEntries();
			const content = JSON.stringify(all, null, 2);
			downloadFile('cannajournal-entries.json', content, 'application/json');
		})();
	}

	function exportCSV() {
		// simple CSV without photoDataUrl to keep sizes reasonable
		const header = ['id', 'timestamp', 'strainId', 'strainName', 'effects', 'mood', 'rating', 'notes'];
		(async () => {
			const all = await getAllEntries();
			const rows = all.map((e) => [
				e.id,
				e.timestamp,
				e.strainId,
				e.strainName,
				'"' + (Array.isArray(e.effects) ? e.effects.join(';') : '') + '"',
				e.mood,
				e.rating,
				'"' + String(e.notes || '').replace(/"/g, '""') + '"',
			].join(','));
			const csv = [header.join(','), ...rows].join('\n');
			downloadFile('cannajournal-entries.csv', csv, 'text/csv');
		})();
	}

	function handleImportFile(e) {
		const f = e.target.files?.[0];
		if (!f) return;
		const reader = new FileReader();
		reader.onload = () => {
			const txt = String(reader.result || '');
			try {
				if (f.name.endsWith('.json')) {
					const data = JSON.parse(txt);
					if (Array.isArray(data)) {
						mergeImported(data);
					}
				} else if (f.name.endsWith('.csv')) {
					const lines = txt.split(/\r?\n/).filter(Boolean);
					const rest = lines.slice(1);
					const entries = rest.map((ln) => {
						const cols = ln.split(',');
						return {
							id: cols[0],
							timestamp: cols[1],
							strainId: cols[2],
							strainName: cols[3],
							effects: cols[4] ? cols[4].replace(/"/g, '').split(';') : [],
							mood: cols[5],
							rating: Number(cols[6] || 0),
							notes: cols[7] ? cols[7].replace(/"/g, '') : '',
						};
					});
					mergeImported(entries);
				}
			} catch (err) {
				alert('Import failed: ' + err.message);
			}
		};
		reader.readAsText(f);
	}

	function mergeImported(newEntries) {
		try {
			(async () => {
				const existing = await getAllEntries();
				const map = new Map(existing.map((e) => [e.id, e]));
				for (const ne of newEntries) map.set(ne.id, ne);
				const merged = Array.from(map.values()).sort((a, b) => (b.timestamp || b.id).localeCompare(a.timestamp || a.id));
				await putEntries(merged);
				// refresh UI by reloading entries
				const all = await getAllEntries();
				setEntries(all.sort((a,b)=> (b.timestamp||b.id).localeCompare(a.timestamp||a.id)));
			})();
		} catch (err) {
			alert('Failed to merge imported entries: ' + err.message);
		}
	}

	// Server sync removed: syncToServer and fetchFromServer are intentionally not present here.

	function insertTag(tag){
		setNotes(n => {
			const before = n.slice(0, caretPos);
			const after = n.slice(caretPos);
			const needsNL = before && !before.endsWith('\n') && !before.endsWith(' ');
			const insertion = (needsNL? '\n' : '') + '#' + tag + ' ';
			const next = (before + insertion + after).slice(0, NOTE_MAX);
			// update caret after insertion
			setTimeout(()=> {
				const pos = Math.min((before + insertion).length, next.length);
				notesRef.current?.setSelectionRange(pos,pos);
				notesRef.current?.focus();
			}, 0);
			setHistory(h => [...h, n].slice(-50));
			setFuture([]);
			return next;
		});
		recordTag(tag);
		setShowSuggest(false); setSuggestQuery('');
	}

	function renderNotes(text){
		// Highlight #Tags, emphasis *word*, linkify URLs, and show inline image previews for direct image links
		const urlRegex = /(https?:\/\/[^\s)]+)/g;
		const parts = text.split(/(#[A-Za-z][A-Za-z0-9_-]*|\*[^*]+\*|https?:\/\/[^\s)]+)/g).filter(Boolean);
		return (
			<div className='space-y-2'>
				<p className='whitespace-pre-wrap break-words'>
					{parts.map((p,i) => {
						if (p.startsWith('#')) return <span key={i} className='text-emerald-300 font-medium'>{p}</span>;
						if (/^https?:\/\//.test(p)) return <a key={i} href={p} target='_blank' rel='noopener noreferrer' className='text-teal-300 hover:underline'>{p}</a>;
						if (p.startsWith('*') && p.endsWith('*') && p.length>2) return <em key={i} className='text-emerald-200 not-italic font-semibold'>{p.slice(1,-1)}</em>;
						return <span key={i}>{p}</span>;
					})}
				</p>
				{/* Inline image previews: look for lines that are just an image URL */}
				<div className='flex flex-wrap gap-2'>
					{Array.from(new Set((text.match(urlRegex)||[])))
						.filter(u => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(u))
						.slice(0,4)
						.map(u => (
							<a key={u} href={u} target='_blank' rel='noopener noreferrer' className='block'>
								<img src={u} alt='' loading='lazy' className='max-h-24 rounded shadow border border-emerald-500/20 hover:border-emerald-400/50 transition' />
							</a>
						))}
				</div>
			</div>
		);
	}

	// Update stats & sentiment when notes change
	useEffect(()=>{
		const text = notes;
		const words = (text.match(/\b[\w'’-]+\b/g)||[]).length; // removed unnecessary escape for hyphen
		const sentences = Math.max(1, (text.match(/[.!?]+/g)||[]).length);
		// naive syllable estimate
		const syllables = (text.toLowerCase().match(/[aeiouy]{1,2}/g)||[]).length;
		// Flesch Reading Ease formula
		const ease = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / Math.max(1, words));
		let easeLabel = 'Easy';
		if (ease < 30) easeLabel='Very Hard'; else if (ease < 50) easeLabel='Hard'; else if (ease < 60) easeLabel='Challenging'; else if (ease < 70) easeLabel='Standard'; else if (ease < 80) easeLabel='Fairly Easy';
		const readingTimeSec = Math.round((words/200)*60); // 200 wpm
		const rt = readingTimeSec < 60 ? readingTimeSec + 's' : (Math.round(readingTimeSec/60) + 'm');
		setReadStats({ words, ease: +ease.toFixed(1), easeLabel, readingTime: rt });
		// sentiment heuristic
		const positives = ['relaxed','calm','happy','euphoric','focused','creative','uplifted','pleasant','smooth','tasty'];
		const negatives = ['anxious','paranoid','dry','headache','dizzy','cough','harsh','nausea','nauseous'];
		let score=0;
		const lc = text.toLowerCase();
		for (const p of positives) if (lc.includes(p)) score++;
		for (const n of negatives) if (lc.includes(n)) score--;
		let label='Neutral';
		if (score>1) label='Positive'; else if (score<-1) label='Negative'; else if (score!==0) label='Mixed';
		setSentiment(text.trim()? {score,label}: null);
	},[notes]);

	// Autocomplete detection on notes change or caret move
	function handleNotesChange(e){
		const val = e.target.value.slice(0, NOTE_MAX);
		setNotes(prev => {
			if (prev !== val){
				setHistory(h => [...h, prev].slice(-50));
				setFuture([]); // clear redo stack when new change made
			}
			return val;
		});
		setCaretPos(e.target.selectionStart || 0);
		setTimeout(()=> computeSuggestions(val, e.target.selectionStart||0),0);
	}

	function undoNotes(){
		setHistory(h => {
			if (!h.length) return h;
			setNotes(current => {
				const prev = h[h.length-1];
				setFuture(f => [current, ...f].slice(0,50));
				return prev;
			});
			return h.slice(0,-1);
		});
	}

	function redoNotes(){
		setFuture(f => {
			if (!f.length) return f;
			setNotes(current => {
				const next = f[0];
				setHistory(h => [...h, current].slice(-50));
				return next;
			});
			return f.slice(1);
		});
	}

	function handleNotesKey(e){
		// undo / redo shortcuts (Ctrl+Z / Ctrl+Y or Cmd on Mac)
		if ((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undoNotes(); return; }
		if ((e.ctrlKey||e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key==='Z'))) { e.preventDefault(); redoNotes(); return; }
		if (showSuggest && suggestions.length){
			if (e.key === 'ArrowDown'){ e.preventDefault(); setActiveSuggest(i => (i+1)%suggestions.length); }
			else if (e.key === 'ArrowUp'){ e.preventDefault(); setActiveSuggest(i => (i-1+suggestions.length)%suggestions.length); }
			else if (e.key === 'Enter'){ e.preventDefault(); applySuggestion(activeSuggest); }
			else if (e.key === 'Tab'){ e.preventDefault(); applySuggestion(activeSuggest); }
			else if (e.key === 'Escape'){ setShowSuggest(false); }
		}
	}

	function computeSuggestions(text, pos){
		try {
			const before = text.slice(0,pos);
			const match = before.match(/(^|\s)(#[A-Za-z0-9_-]*)$/);
			if (!match){ setShowSuggest(false); return; }
			const raw = match[2];
			const q = raw.slice(1); // remove '#'
			setSuggestQuery(q);
			const pool = quickTags;
			const filtered = pool.filter(t => t.toLowerCase().startsWith(q.toLowerCase()));
			setSuggestions(filtered.slice(0,8));
			setActiveSuggest(0);
			setShowSuggest(true);
		} catch(_) { setShowSuggest(false); }
	}


	function applySuggestion(i){
		const chosen = suggestions[i];
		if (!chosen) return;
		// replace current partial token
		setNotes(prev => {
			const before = prev.slice(0, caretPos);
			const after = prev.slice(caretPos);
			const m = before.match(/(^|\s)(#[A-Za-z0-9_-]*)$/);
			if (!m) return prev;
			const start = before.length - m[2].length;
			const updatedBefore = before.slice(0,start) + '#' + chosen + ' ';
			const next = (updatedBefore + after).slice(0,NOTE_MAX);
			setTimeout(()=>{
				const pos = updatedBefore.length;
				notesRef.current?.setSelectionRange(pos,pos);
				notesRef.current?.focus();
			},0);
			recordTag(chosen);
			return next;
		});
		setShowSuggest(false);
	}

	function handleNotesSelect(){
		if (!notesRef.current) return;
		const pos = notesRef.current.selectionStart || 0;
		setCaretPos(pos);
		computeSuggestions(notes, pos);
	}

	function onNotesBlur(){
		// delay hiding to allow click on suggestion
		setTimeout(()=> setShowSuggest(false), 150);
	}

	// Drag & drop text file support
	function handleNotesDrop(e){
		e.preventDefault();
		const file = e.dataTransfer.files?.[0];
		if (!file) return;
		if (!file.type.startsWith('text')) return;
		const reader = new FileReader();
		reader.onload = () => {
			const content = String(reader.result||'');
			setNotes(n => (n + (n? '\n':'') + content).slice(0,NOTE_MAX));
		};
		reader.readAsText(file);
	}
	function handleNotesDragOver(e){ e.preventDefault(); }

	return (
		<div className='p-4'>
			<div className='max-w-4xl mx-auto'>
				<h1 className='text-2xl font-bold mb-3'>Journal</h1>
				<p className='mb-4 text-sm text-green-100/80'>Log how different strains make you feel. Entries are stored locally in your browser.</p>

				{entries.length > 0 && (
					<section className='mb-6 bg-black/30 p-4 rounded-lg border border-green-800/30'>
						<div className='flex items-center justify-between mb-2'>
							<h2 className='font-semibold'>Recommendations</h2>
							{loadingRecs && <span className='text-xs text-green-200/70'>Updating…</span>}
						</div>
						{!loadingRecs && recs.length === 0 && <div className='text-sm text-green-100/60'>Not enough data yet. Log more entries to personalize suggestions.</div>}
						{recs.length > 0 && (
							<ul className='space-y-2 text-sm'>
								{recs.map(r => (
									<li key={r.strainId} className='flex items-center justify-between bg-green-900/20 px-3 py-2 rounded border border-green-700/30'>
										<div>
											<div className='font-medium'>{r.name}</div>
											<div className='text-xs text-green-100/70'>Similarity: {(r.similarity*100).toFixed(1)}% • Samples: {r.sampleSize}</div>
										</div>
										<div className='hidden sm:block text-[10px] text-right text-green-200/70'>
											{Object.entries(r.effects).map(([k,v]) => <span key={k} className='inline-block mr-2'>{k}:{v}</span>)}
										</div>
									</li>
								))}
							</ul>
						)}
					</section>
				)}

				<section className='bg-black/40 p-4 rounded-lg mb-6'>
					<h2 className='font-semibold mb-2'>New entry</h2>

					<div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
						<label className='block'>
							<div className='text-sm'>Strain</div>
							<select value={strainId} onChange={(e) => setStrainId(e.target.value)} className='w-full mt-1 p-2 rounded bg-gray-800'>
								<option value=''>-- pick strain --</option>
								{strains.map((s) => (
									<option key={s.id} value={s.id}>{s.name}</option>
								))}
							</select>
						</label>

						<label className='block'>
							<div className='text-sm'>Mood</div>
							<select value={mood} onChange={(e) => setMood(e.target.value)} className='w-full mt-1 p-2 rounded bg-gray-800'>
								<option>Relaxed</option>
								<option>Energetic</option>
								<option>Creative</option>
								<option>Sleepy</option>
								<option>Anxious</option>
								<option>Neutral</option>
							</select>
						</label>
					</div>

					<div className='mt-4'>
						<h3 className='text-sm font-semibold mb-2'>Effect Ratings (1–5)</h3>
						<div className='grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm'>
							{Object.entries(effectScores).map(([k,v]) => (
								<label key={k} className='flex flex-col gap-1'>
									<span className='capitalize'>{k}</span>
									<input type='range' min='1' max='5' value={v} onChange={(e)=>updateEffect(k,e.target.value)} />
									<div className='text-xs'>Value: {v}</div>
								</label>
							))}
						</div>
					</div>

					<div className='mt-3'>
						<div className='text-sm mb-1'>Rating</div>
						<input type='range' min='1' max='5' value={rating} onChange={(e) => setRating(Number(e.target.value))} className='w-full' />
						<div className='text-sm mt-1'>Value: <strong>{rating}</strong></div>
					</div>

					{/* Notes section (enhanced styling) */}
					<div className='mt-5'>
						<div className='flex items-center justify-between mb-1'>
							<div className='text-sm font-semibold flex items-center gap-2'>
								<span>Notes</span>
								<span className='text-[10px] px-2 py-0.5 rounded-full bg-emerald-700/30 border border-emerald-400/30 text-emerald-200 tracking-wide'>Optional</span>
							</div>
							<div className='text-[11px] text-emerald-200/70'>{notes.length}/{NOTE_MAX}</div>
						</div>
						<div className='flex gap-2 mb-2'>
							<button type='button' disabled={!history.length} onClick={undoNotes} className={`px-2 py-1 rounded text-[11px] border ${history.length ? 'bg-emerald-800/30 border-emerald-500/30 text-emerald-100 hover:bg-emerald-700/40' : 'bg-emerald-900/20 border-emerald-500/10 text-emerald-400/40 cursor-not-allowed'}`}>Undo</button>
							<button type='button' disabled={!future.length} onClick={redoNotes} className={`px-2 py-1 rounded text-[11px] border ${future.length ? 'bg-emerald-800/30 border-emerald-500/30 text-emerald-100 hover:bg-emerald-700/40' : 'bg-emerald-900/20 border-emerald-500/10 text-emerald-400/40 cursor-not-allowed'}`}>Redo</button>
						</div>
						<div className='flex flex-wrap gap-2 mb-2'>
							{quickTags.slice(0,12).map(tag => (
								<button key={tag} type='button' onClick={() => insertTag(tag)} className='px-2 py-1 rounded bg-emerald-900/30 hover:bg-emerald-800/40 text-[11px] text-emerald-200 border border-emerald-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50'>#{tag}</button>
							))}
						</div>
						<div className='relative group'>
							<div aria-hidden='true' className='pointer-events-none absolute inset-0 rounded-lg border border-emerald-400/20 bg-gradient-to-br from-slate-900/70 via-slate-900/60 to-emerald-950/60 shadow-inner overflow-hidden'>
								<div className='absolute inset-0 opacity-[0.15]' style={{backgroundImage:'repeating-linear-gradient(to bottom, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 24px)'}} />
								<div className='absolute left-10 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-emerald-400/40 to-transparent opacity-60' />
							</div>
							<textarea
								ref={notesRef}
								value={notes}
								onChange={handleNotesChange}
								onKeyDown={handleNotesKey}
								onSelect={handleNotesSelect}
								onBlur={onNotesBlur}
								onDrop={handleNotesDrop}
								onDragOver={handleNotesDragOver}
								rows={5}
								placeholder='Describe flavor, onset time, environment, side effects... Use #tags or *emphasis*'
								className='relative w-full resize-y min-h-[140px] font-mono text-[13px] leading-[24px] tracking-tight bg-transparent text-emerald-50 px-4 py-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60'
							/>
							{showSuggest && suggestions.length>0 && (
								<div className='absolute z-20 mt-1 left-4 top-full w-56 rounded-lg border border-emerald-400/30 bg-slate-950/95 backdrop-blur p-1 shadow-xl animate-fade-in text-sm'>
									{suggestions.map((s,i)=>(
										<button key={s} type='button' onMouseDown={(e)=>{e.preventDefault(); applySuggestion(i);}} className={`w-full text-left px-3 py-1 rounded-md transition ${i===activeSuggest ? 'bg-emerald-700/40 text-emerald-100' : 'hover:bg-emerald-800/30 text-emerald-200'}`}>#{s}</button>
									))}
									{suggestQuery && suggestions.length===0 && <div className='px-3 py-1 text-emerald-300/70 text-[12px]'>No matches</div>}
								</div>
							)}
							{/* Stats & sentiment row */}
							<div className='flex flex-wrap items-center gap-3 mt-2 text-[11px] text-emerald-300/70'>
								<span>{readStats.words} words</span>
								<span>· {readStats.readingTime}</span>
								{readStats.ease != null && <span>· Ease: <span className='text-emerald-200'>{readStats.ease} ({readStats.easeLabel})</span></span>}
								{sentiment && <span>· Sentiment: <span className={sentiment.score>1? 'text-green-300': sentiment.score<-1? 'text-red-300':'text-yellow-200'}>{sentiment.label}</span></span>}
								<span className='ml-auto hidden sm:inline text-emerald-400/50'>Drag & drop a .txt file to append</span>
							</div>
							<div className='absolute right-2 bottom-2 text-[10px] text-emerald-300/60 opacity-0 group-hover:opacity-100 transition'>Markdown-lite #tags supported</div>
						</div>
					</div>

					<div className='mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center'>
						<label className='block'>
							<div className='text-sm mb-1'>Photo (optional)</div>
							<input ref={fileRef} type='file' accept='image/*' onChange={handleFile} className='block w-full text-sm' />
						</label>

						<div>
							{photoDataUrl ? <img src={photoDataUrl} alt='preview' className='w-32 h-20 object-cover rounded' /> : <div className='text-sm text-green-100/60'>No photo selected</div>}
						</div>
					</div>

					<div className='mt-4 flex gap-2'>
						<button onClick={saveEntry} className='px-4 py-2 bg-green-600 text-white rounded'>Save entry</button>
						<button onClick={clearForm} className='px-4 py-2 bg-gray-700 text-white rounded'>Clear</button>
					</div>
				</section>



						<section>
							<div className='flex items-center justify-between'>
								<h2 className='font-semibold mb-2'>Entries</h2>
								<div className='flex gap-2 items-center'>
											<button onClick={() => exportJSON()} className='px-3 py-1 bg-blue-600 text-white rounded text-sm'>Export JSON</button>
											<button onClick={() => exportCSV()} className='px-3 py-1 bg-blue-600 text-white rounded text-sm'>Export CSV</button>
											<label className='text-sm px-2 py-1 rounded bg-gray-700 cursor-pointer'>
												Import
												<input type='file' accept='.json,.csv' onChange={handleImportFile} className='hidden' />
											</label>
										</div>
							</div>
					{entries.length === 0 ? (
						<p className='text-sm text-green-100/60'>No entries yet — create your first one above.</p>
					) : (
						<div className='space-y-3'>
								{entries.map((en) => (
									<article key={en.id} className='bg-gradient-to-br from-slate-900/60 via-slate-900/50 to-emerald-950/40 p-3 rounded-xl border border-emerald-400/10 shadow-sm hover:border-emerald-400/30 transition-colors'>
									<div className='flex items-start gap-3'>
										{en.photoDataUrl ? <img src={en.photoDataUrl} alt='' className='w-20 h-16 object-cover rounded' /> : <div className='w-20 h-16 bg-gray-800 rounded flex items-center justify-center text-sm'>No photo</div>}
										<div className='flex-1'>
											<div className='flex items-center justify-between'>
												<div>
													<div className='font-semibold'>{en.strainName}</div>
													<div className='text-sm text-green-100/70'>{new Date(en.timestamp).toLocaleString()}</div>
												</div>
												<div className='text-sm'>Mood: <strong>{en.mood}</strong></div>
											</div>
											<div className='mt-2 text-sm'>Effects: {en.effectScores ? Object.entries(en.effectScores).map(([k,v])=>`${k}:${v}`).join(', ') : '—'}</div>
											<div className='mt-1 text-sm'>Rating: {en.rating}</div>
											{en.notes && (
												<div className='mt-3 text-[13px] leading-relaxed relative pl-3'>
													<div className='absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-emerald-500/50 via-emerald-400/30 to-transparent' />
													{renderNotes(en.notes)}
												</div>
											)}
										</div>
									</div>
									<div className='mt-2 text-right'>
										<button onClick={() => deleteEntry(en.id)} className='text-sm text-red-400'>Delete</button>
									</div>
								</article>
							))}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}

// export helpers moved to component scope to access state