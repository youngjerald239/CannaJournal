import { useEffect, useState, useRef } from 'react';

const STORAGE_KEY = 'cannajournal.entries';

export default function Journal() {
	const [strains, setStrains] = useState([]);
	const [, setLoadingStrains] = useState(true);

	// form state
	const [strainId, setStrainId] = useState('');
	const [effectsInput, setEffectsInput] = useState('');
	const [effects, setEffects] = useState([]);
	const [mood, setMood] = useState('Relaxed');
	const [rating, setRating] = useState(3);
	const [notes, setNotes] = useState('');
	const [photoDataUrl, setPhotoDataUrl] = useState(null);

	const [entries, setEntries] = useState([]);
	const fileRef = useRef(null);

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
		const raw = localStorage.getItem(STORAGE_KEY);
		try {
			setEntries(raw ? JSON.parse(raw) : []);
		} catch (e) {
			setEntries([]);
		}
	}, []);

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	}, [entries]);

	function addEffectTag() {
		const txt = effectsInput.trim();
		if (!txt) return;
		if (!effects.includes(txt)) setEffects((s) => [...s, txt]);
		setEffectsInput('');
	}

	function removeEffectTag(tag) {
		setEffects((s) => s.filter((t) => t !== tag));
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
		setEffects([]);
		setEffectsInput('');
		setMood('Relaxed');
		setRating(3);
		setNotes('');
		setPhotoDataUrl(null);
		if (fileRef.current) fileRef.current.value = null;
	}

	function saveEntry() {
		const timestamp = new Date().toISOString();
		const strainName = strains.find((s) => String(s.id) === String(strainId))?.name || (strainId ? strainId : 'Unknown');
		const entry = { id: timestamp, timestamp, strainId, strainName, effects, mood, rating, notes, photoDataUrl };
		setEntries((e) => [entry, ...e]);
		clearForm();
	}

	function deleteEntry(id) {
		if (!window.confirm('Delete this entry?')) return;
		setEntries((e) => e.filter((x) => x.id !== id));
	}

	return (
		<div className='p-4'>
			<div className='max-w-4xl mx-auto'>
				<h1 className='text-2xl font-bold mb-3'>Journal</h1>
				<p className='mb-4 text-sm text-green-100/80'>Log how different strains make you feel. Entries are stored locally in your browser.</p>

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

					<div className='mt-3'>
						<div className='text-sm mb-1'>Effects (tags)</div>
						<div className='flex gap-2'>
							<input value={effectsInput} onChange={(e) => setEffectsInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEffectTag(); } }} placeholder='e.g. euphoric, sleepy' className='flex-1 p-2 rounded bg-gray-800' />
							<button onClick={addEffectTag} className='px-3 rounded bg-green-600 text-white'>Add</button>
						</div>
						<div className='mt-2 flex flex-wrap gap-2'>
							{effects.map((t) => (
								<span key={t} className='inline-flex items-center gap-2 bg-green-800/60 text-sm px-2 py-1 rounded'>
									{t}
									<button onClick={() => removeEffectTag(t)} className='text-xs text-red-300 ml-1' aria-label={`Remove ${t}`}>×</button>
								</span>
							))}
						</div>
					</div>

					<div className='mt-3'>
						<div className='text-sm mb-1'>Rating</div>
						<input type='range' min='1' max='5' value={rating} onChange={(e) => setRating(Number(e.target.value))} className='w-full' />
						<div className='text-sm mt-1'>Value: <strong>{rating}</strong></div>
					</div>

					<div className='mt-3'>
						<div className='text-sm mb-1'>Notes</div>
						<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className='w-full p-2 rounded bg-gray-800' />
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
									<button onClick={() => exportJSON(entries)} className='px-3 py-1 bg-blue-600 text-white rounded text-sm'>Export JSON</button>
									<button onClick={() => exportCSV(entries)} className='px-3 py-1 bg-blue-600 text-white rounded text-sm'>Export CSV</button>
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
								<article key={en.id} className='bg-black/40 p-3 rounded-lg'>
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
											<div className='mt-2 text-sm'>Effects: {en.effects.join(', ') || '—'}</div>
											<div className='mt-1 text-sm'>Rating: {en.rating}</div>
											{en.notes && <div className='mt-2 text-sm text-green-100/80'>{en.notes}</div>}
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

		// export helpers
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

		function exportJSON(entries) {
			const content = JSON.stringify(entries, null, 2);
			downloadFile('cannajournal-entries.json', content, 'application/json');
		}

		function exportCSV(entries) {
			// simple CSV without photoDataUrl to keep sizes reasonable
			const header = ['id', 'timestamp', 'strainId', 'strainName', 'effects', 'mood', 'rating', 'notes'];
			const rows = entries.map((e) => [
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
				const raw = localStorage.getItem(STORAGE_KEY);
				const existing = raw ? JSON.parse(raw) : [];
				// prepend new entries (avoid duplicate ids)
				const map = new Map(existing.map((e) => [e.id, e]));
				for (const ne of newEntries) map.set(ne.id, ne);
				const merged = Array.from(map.values()).sort((a, b) => (b.timestamp || b.id).localeCompare(a.timestamp || a.id));
				localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
				// trigger reload: simple approach, reload page to sync state
				window.location.reload();
			} catch (err) {
				alert('Failed to merge imported entries: ' + err.message);
			}
		}