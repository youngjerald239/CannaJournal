import { useEffect, useState, useRef, useCallback } from 'react';

export default function Profile() {
	const [me, setMe] = useState(null);
	const [entries, setEntries] = useState([]);
	const [loading, setLoading] = useState(true);
	const [avatar, setAvatar] = useState(null); // server URL
	const [avatarError, setAvatarError] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [bio, setBio] = useState('');
	const [savingProfile, setSavingProfile] = useState(false);
	const [saveMsg, setSaveMsg] = useState('');
	const [uploading, setUploading] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [achievements, setAchievements] = useState([]);
	const [achievementsLoading, setAchievementsLoading] = useState(true);
	const [summary, setSummary] = useState(null);
	const [summaryLoading, setSummaryLoading] = useState(true);
	const [favStrains, setFavStrains] = useState([]); // full strain objects
	const [favIndex, setFavIndex] = useState(0);
	const [removing, setRemoving] = useState(new Set()); // ids being animated out
	const fileInputRef = useRef(null);
	const favCarouselRef = useRef(null);
	const touchStartX = useRef(null);

	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				const r = await fetch('/auth/me', { credentials: 'include' });
				if (r.ok) {
					const j = await r.json();
					const userObj = j.user ? { ...j.user, authenticated: j.authenticated } : j;
					if (mounted) setMe(userObj);
				}
				const profRes = await fetch('/profile', { credentials: 'include' });
				if (profRes.ok) {
					const p = await profRes.json();
					if (mounted) {
						setAvatar(p.avatar || null);
						setDisplayName(p.displayName || '');
						setBio(p.bio || '');
					}
				}
				const eRes = await fetch('/journal', { credentials: 'include' });
				if (eRes.ok) {
					const e = await eRes.json();
					if (mounted && Array.isArray(e)) {
						const sorted = [...e].sort((a, b) => (b.timestamp || b.id).localeCompare(a.timestamp || a.id));
						setEntries(sorted);
					}
				}
			} catch (err) {
				// ignore network errors
			} finally {
				if (mounted) setLoading(false);
			}
		})();
		return () => { mounted = false; };
	}, []);

	useEffect(() => {
		fetch('/achievements', { credentials: 'include' })
			.then(r => r.ok ? r.json() : [])
			.then(d => setAchievements(Array.isArray(d)?d:[]))
			.catch(()=>{})
			.finally(()=> setAchievementsLoading(false));
	}, []);

	useEffect(() => {
		fetch('/stats/summary', { credentials: 'include' })
			.then(r => r.ok ? r.json() : null)
			.then(d => setSummary(d))
			.catch(()=>{})
			.finally(()=> setSummaryLoading(false));
	}, []);

	// Fetch favorites list + strain details (from /strains) to build carousel
	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				const favRes = await fetch('/favorites', { credentials: 'include' });
				const favData = favRes.ok ? await favRes.json() : [];
				if (!mounted) return;
				if (favData.length) {
					const sRes = await fetch('/strains', { credentials: 'include' });
					if (sRes.ok) {
						const all = await sRes.json();
						if (!mounted) return;
						const map = new Map(all.map(s => [String(s.id), s]));
						const enriched = favData
							.slice()
							.sort((a,b) => new Date(b.addedAt||0) - new Date(a.addedAt||0))
							.map(f => ({ ...map.get(String(f.id)), addedAt: f.addedAt } ))
							.filter(x=>x && x.id);
						setFavStrains(enriched);
					}
				}
			} catch (e) { /* ignore */ }
		})();
		return () => { mounted = false; };
	}, []);

	// Remove a favorite (from active card or control) and update local state
	async function handleUnfavorite(id){
		// optimistic remove with exit animation
		setRemoving(prev => {
			const ns = new Set(prev);
			ns.add(String(id));
			return ns;
		});
		try { await fetch(`/favorites/${id}`, { method: 'DELETE', credentials: 'include' }); } catch(_) {}
		// after animation ends, drop from list
		setTimeout(() => {
			setFavStrains(prev => {
				const next = prev.filter(s => String(s.id) !== String(id));
				setFavIndex(i => Math.min(Math.max(0, next.length - 1), i));
				return next;
			});
			setRemoving(prev => { const ns = new Set(prev); ns.delete(String(id)); return ns; });
		}, 280);
	}

	// Keyboard navigation (arrow keys left/right) when carousel focused
	const onCarouselKey = useCallback((e) => {
		if (!favStrains.length) return;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			setFavIndex(i => Math.max(0, i-1));
		}
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			setFavIndex(i => Math.min(favStrains.length -1, i+1));
		}
	}, [favStrains.length]);

	// Touch swipe navigation
	function onTouchStart(e){
		if (e.touches && e.touches.length === 1) {
			touchStartX.current = e.touches[0].clientX;
		}
	}
	function onTouchEnd(e){
		if (touchStartX.current == null) return;
		const endX = (e.changedTouches && e.changedTouches[0]?.clientX) || touchStartX.current;
		const delta = endX - touchStartX.current;
		const threshold = 40; // px
		if (Math.abs(delta) > threshold){
			if (delta > 0) setFavIndex(i => Math.max(0, i-1)); else setFavIndex(i => Math.min(favStrains.length -1, i+1));
		}
		touchStartX.current = null;
	}

	function cardClasses(tier, unlocked){
		const base = 'p-3 rounded-lg border text-sm transition-colors';
		const lockedTint = 'bg-white/5';
		switch(tier){
			case 'bronze': return unlocked ? `${base} border-amber-400/50 bg-amber-900/20` : `${base} border-amber-600/30 ${lockedTint}`;
			case 'silver': return unlocked ? `${base} border-slate-200/50 bg-slate-600/10` : `${base} border-slate-400/30 ${lockedTint}`;
			case 'gold': return unlocked ? `${base} border-yellow-300/60 bg-yellow-900/20` : `${base} border-yellow-600/30 ${lockedTint}`;
			case 'platinum': return unlocked ? `${base} border-cyan-200/60 bg-cyan-900/20` : `${base} border-cyan-600/30 ${lockedTint}`;
			default: return `${base} border-white/10 ${lockedTint}`;
		}
	}

	function progressBarGradient(tier){
		switch(tier){
			case 'bronze': return 'bg-gradient-to-r from-amber-500 to-amber-300';
			case 'silver': return 'bg-gradient-to-r from-slate-200 to-slate-100';
			case 'gold': return 'bg-gradient-to-r from-yellow-400 to-amber-300';
			case 'platinum': return 'bg-gradient-to-r from-cyan-300 via-blue-200 to-indigo-200';
			default: return 'bg-gradient-to-r from-emerald-500 to-green-400';
		}
	}

	function dataUrlFromImage(file, maxSize = 256) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(new Error('Could not read file'));
			reader.onload = () => {
				const img = new Image();
				img.onload = () => {
					const canvas = document.createElement('canvas');
					const ctx = canvas.getContext('2d');
					const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
					canvas.width = Math.round(img.width * scale);
					canvas.height = Math.round(img.height * scale);
					ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
					try {
						const out = canvas.toDataURL('image/webp', 0.85);
						resolve(out);
					} catch (e) {
						resolve(canvas.toDataURL());
					}
				};
				img.onerror = () => reject(new Error('Invalid image'));
				img.src = reader.result;
			};
			reader.readAsDataURL(file);
		});
	}

	async function uploadDataUrl(url) {
		setUploading(true);
		setAvatarError('');
		try {
			const resp = await fetch('/profile/avatar', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ dataUrl: url })
			});
			if (!resp.ok) {
				const j = await resp.json().catch(() => ({}));
				throw new Error(j.error || 'Upload failed');
			}
			const j = await resp.json();
			setAvatar(j.avatar);
		} catch (err) {
			setAvatarError(err.message);
		} finally {
			setUploading(false);
		}
	}

	async function handleAvatarChange(e) {
		setAvatarError('');
		const file = e.target.files && e.target.files[0];
		if (!file) return;
		if (file.size > 2 * 1024 * 1024) { setAvatarError('Image too large (max 2MB).'); return; }
		try {
			const url = await dataUrlFromImage(file, 256);
			await uploadDataUrl(url);
		} catch (err) {
			setAvatarError('Could not load image.');
		}
		if (fileInputRef.current) fileInputRef.current.value = '';
	}

	async function removeAvatar() {
		// Setting empty avatar (send empty dataUrl?) For simplicity we'll just clear locally.
		setAvatar(null);
		// Could implement DELETE /profile/avatar if needed.
	}

	const onDrop = useCallback(async (e) => {
		e.preventDefault();
		if (uploading) return;
		const file = e.dataTransfer.files && e.dataTransfer.files[0];
		if (!file) return;
		if (!file.type.startsWith('image/')) { setAvatarError('Not an image'); return; }
		if (file.size > 2 * 1024 * 1024) { setAvatarError('Image too large (max 2MB).'); return; }
		try {
			const url = await dataUrlFromImage(file, 256);
			await uploadDataUrl(url);
		} catch (_) {
			setAvatarError('Upload failed');
		}
	}, [uploading]);

	const onDragOver = (e) => { e.preventDefault(); };

	async function saveProfile(e) {
		e.preventDefault();
		setSavingProfile(true);
		setSaveMsg('');
		try {
			const resp = await fetch('/profile', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ displayName, bio })
			});
			if (!resp.ok) throw new Error('Save failed');
			setSaveMsg('Saved');
			setTimeout(() => setSaveMsg(''), 2000);
		} catch (err) {
			setSaveMsg('Error');
		} finally {
			setSavingProfile(false);
		}
	}

	async function deleteAccount() {
		if (deleting) return;
		setDeleting(true);
		try {
			const resp = await fetch('/profile', { method: 'DELETE', credentials: 'include' });
			if (!resp.ok) throw new Error('Delete failed');
			// Redirect to home or login after deletion
			window.location.href = '/';
		} catch (err) {
			alert('Account deletion failed: ' + err.message);
		} finally {
			setDeleting(false);
			setConfirmDelete(false);
		}
	}

	const initial = (displayName || me?.username || '?')[0].toUpperCase();

	const Stat = ({ label, value }) => (
		<div className="flex flex-col text-xs bg-white/5 rounded-md p-2 border border-white/10">
			<span className="uppercase tracking-wide text-[10px] text-slate-400">{label}</span>
			<span className="text-sm font-semibold text-emerald-200">{value}</span>
		</div>
	);

	return (
		<div className="p-4">
			<div className="max-w-5xl mx-auto space-y-10">
				<div className="bg-gradient-to-br from-emerald-900/40 via-emerald-800/30 to-emerald-700/30 rounded-2xl p-6 sm:p-8 border border-emerald-500/20 shadow-xl backdrop-blur">
					<div className="flex flex-col sm:flex-row gap-8">
						<div className="flex flex-col items-center gap-3">
							<div className="relative group" onDrop={onDrop} onDragOver={onDragOver}>
								<div className="w-32 h-32 rounded-full overflow-hidden ring-2 ring-emerald-400/60 ring-offset-2 ring-offset-black bg-emerald-950/60 flex items-center justify-center text-4xl font-bold text-emerald-200 select-none">
									{avatar ? <img src={avatar} alt="Avatar" className="w-full h-full object-cover" /> : initial}
								</div>
								<button type="button" onClick={() => fileInputRef.current?.click()} className="absolute -bottom-2 left-1/2 -translate-x-1/2 translate-y-full opacity-90 group-hover:translate-y-2 transition-all bg-black/70 hover:bg-black/90 text-[10px] uppercase tracking-wide px-3 py-1 rounded-full border border-emerald-400/40 backdrop-blur-md">Change</button>
								{avatar && (
									<button type="button" onClick={removeAvatar} className="absolute top-1 right-1 bg-black/50 hover:bg-black/80 text-[10px] px-2 py-0.5 rounded-md border border-red-400/40 text-red-200">×</button>
								)}
								<input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
							</div>
							{avatarError && <div className="text-xs text-red-300 max-w-[8rem] text-center">{avatarError}</div>}
						</div>
						<div className="flex-1 space-y-6">
							<div>
								<h1 className="text-2xl font-bold flex items-center gap-3">
									<span>{me?.username || '—'}</span>
									{me?.role === 'admin' && (
										<span className="text-[10px] px-2 py-1 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-200 uppercase tracking-wide">Admin</span>
									)}
								</h1>
								<p className="text-sm text-slate-300 mt-1">Customize your profile. Avatar & details are stored securely on the server.</p>
							</div>
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
								<Stat label="Authenticated" value={me?.authenticated ? 'Yes' : 'No'} />
								<Stat label="Entries" value={entries.length} />
								<Stat label="Role" value={me?.role || 'user'} />
								<Stat label="Last Updated" value={entries[0] ? new Date(entries[0].timestamp).toLocaleDateString() : '—'} />
							</div>
						</div>
					</div>

						<form onSubmit={saveProfile} className="mt-4 space-y-4">
							<div className="grid sm:grid-cols-2 gap-6">
								<div className="space-y-2">
									<label className="text-xs uppercase tracking-wide text-slate-400">Display Name</label>
									<input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} className="w-full bg-black/40 border border-emerald-500/30 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/60" placeholder="Display name" />
								</div>
								<div className="space-y-2">
									<label className="text-xs uppercase tracking-wide text-slate-400">Bio <span className="text-slate-500">({bio.length}/500)</span></label>
									<textarea value={bio} onChange={e => setBio(e.target.value.slice(0,500))} rows={3} className="w-full bg-black/40 border border-emerald-500/30 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/60 resize-none" placeholder="Tell others about your preferences..." />
								</div>
							</div>
							<div className="flex items-center gap-3 flex-wrap">
								<button disabled={savingProfile} className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium">{savingProfile ? 'Saving…' : 'Save Profile'}</button>
								{saveMsg && <span className="text-xs text-slate-400">{saveMsg}</span>}
								<button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto px-4 py-2 rounded-md bg-red-600/80 hover:bg-red-600 text-sm font-medium border border-red-400/40">Delete Account</button>
							</div>
							{confirmDelete && (
								<div className="mt-4 p-4 rounded-lg border border-red-500/30 bg-red-900/20 space-y-3">
									<p className="text-sm text-red-200 font-medium">This will permanently delete your account and all journal entries. This cannot be undone.</p>
									<div className="flex gap-3">
										<button type="button" disabled={deleting} onClick={deleteAccount} className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-semibold">{deleting ? 'Deleting…' : 'Yes, delete'}</button>
										<button type="button" disabled={deleting} onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-md bg-slate-600/60 hover:bg-slate-500 text-xs font-semibold">Cancel</button>
									</div>
								</div>
							)}
						</form>
				</div>

				<div>
					<div className="flex items-center justify-between mb-3">
						<h2 className="text-lg font-semibold">Journal Entries</h2>
						{!loading && entries.length > 0 && (
							<span className="text-[11px] text-slate-400">Newest first</span>
						)}
					</div>
					{loading ? <div className="text-sm text-slate-400">Loading…</div> : (
						entries.length === 0 ? <div className="text-sm text-slate-500">No entries yet.</div> : (
							<ul className="space-y-3">
								{entries.map((en) => (
									<li key={en.id} className="p-4 rounded-xl bg-gradient-to-br from-black/40 via-slate-900/40 to-emerald-900/20 border border-white/5 hover:border-emerald-500/30 transition-colors">
										<div className="flex flex-wrap items-baseline gap-2">
											<span className="font-semibold text-emerald-200">{en.strainName}</span>
											<span className="text-[11px] text-slate-400">{new Date(en.timestamp).toLocaleString()}</span>
										</div>
										<div className="text-xs mt-1 text-slate-300">Rating: <span className="font-medium text-emerald-300">{en.rating}</span></div>
									</li>
								))}
							</ul>
						)
					)}
					<div className="mt-10">
						{favStrains.length > 0 && (
							<div className="mb-12">
								<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">Favorites <span className="text-[10px] text-slate-500">{favIndex+1}/{favStrains.length}</span></h2>
								<div
									ref={favCarouselRef}
									tabIndex={0}
									role="group"
									aria-label="Favorites carousel. Use left and right arrow keys to navigate."
									onKeyDown={onCarouselKey}
									onTouchStart={onTouchStart}
									onTouchEnd={onTouchEnd}
									className="relative h-64 sm:h-56 md:h-64 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 rounded-xl"
								>
									{favStrains.slice(0,6).map((s, i) => {
										const idx = i;
										const active = idx === favIndex;
										const offset = idx - favIndex; // negative = left, positive = right
										const depth = Math.max(0, Math.min(5, Math.abs(offset)));
										const translateX = offset * 46; // horizontal spread
										const baseScale = active ? 1 : 1 - depth * 0.08;
										const isRemoving = removing.has(String(s.id));
										const scale = isRemoving ? baseScale * 0.75 : baseScale;
										const z = 100 - depth;
										const base = 'absolute inset-0 flex flex-col rounded-2xl overflow-hidden transition-all duration-300 will-change-transform';
										const activeBg = 'bg-gradient-to-br from-emerald-950/95 via-emerald-900/90 to-slate-900/90 border border-emerald-400/50 shadow-2xl';
										const inactiveBg = 'bg-slate-900/85 border border-white/10 shadow-md';
										return (
											<div
												key={s.id}
												className={`${base} ${active ? activeBg : inactiveBg} ${!active ? 'pointer-events-none backdrop-blur-sm' : ''} ${isRemoving ? 'opacity-0' : ''}`}
												style={{ transform: `translateX(${translateX}px) scale(${scale})`, zIndex: z, opacity: depth > 5 ? 0 : (isRemoving ? 0 : 1) }}
												aria-hidden={!active}
											>
												{/* subtle overlay to further dim deeper stacks */}
												{!active && <div className={`absolute inset-0 ${depth>0 ? 'bg-black/40' : ''}`}/>} 
												<div className={`flex flex-col h-full p-4 ${!active ? 'opacity-40 blur-[1px]' : 'opacity-100'}`}>
													<div className="flex justify-between items-start gap-3">
														<h3 className="font-semibold text-lg truncate" title={s.name}>{s.name}</h3>
														<div className="flex items-center gap-1">
															<span className="text-[10px] px-2 py-1 rounded bg-yellow-600/40 text-yellow-100 border border-yellow-400/30">★</span>
															{active && (
																<button onClick={()=> handleUnfavorite(s.id)} title="Remove from favorites" className="text-[10px] px-2 py-1 rounded bg-red-600/30 hover:bg-red-600/50 text-red-100 border border-red-400/30">×</button>
															)}
														</div>
													</div>
													{active && <p className="text-xs text-slate-300 line-clamp-4 mt-1">{s.effects || 'No effect summary'}</p>}
													{active && s.addedAt && (
														<div className="mt-2 text-[10px] text-slate-500">Added {new Date(s.addedAt).toLocaleDateString()}</div>
													)}
													{active && (
														<div className="grid grid-cols-3 gap-2 text-[10px] mt-3">
															<div className="bg-white/5 rounded p-2 flex flex-col"><span className="text-slate-500">THC</span><span className="text-emerald-200 font-medium">{s.thc ?? '—'}%</span></div>
															<div className="bg-white/5 rounded p-2 flex flex-col"><span className="text-slate-500">CBD</span><span className="text-emerald-200 font-medium">{s.cbd ?? '—'}%</span></div>
															<div className="bg-white/5 rounded p-2 flex flex-col"><span className="text-slate-500">Type</span><span className="text-emerald-200 font-medium">{s.type}</span></div>
														</div>
													)}
													{active && (
														<div className="mt-auto flex justify-between items-center pt-4">
															<button disabled={favIndex===0} onClick={()=> setFavIndex(i => Math.max(0, i-1))} className="text-xs px-4 py-1.5 rounded bg-emerald-700/40 hover:bg-emerald-600/50 disabled:opacity-30">Prev</button>
															<button disabled={favIndex===favStrains.length-1} onClick={()=> setFavIndex(i => Math.min(favStrains.length-1, i+1))} className="text-xs px-4 py-1.5 rounded bg-emerald-700/40 hover:bg-emerald-600/50 disabled:opacity-30">Next</button>
														</div>
													)}
												</div>
											</div>
										);
									})}
								</div>
							</div>
						)}
						{summary && (
							<div className="mb-10">
								<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">Weekly Summary {summaryLoading && <span className="text-[10px] text-slate-400">Loading…</span>}</h2>
								{summaryLoading ? (
									<div className="text-xs text-slate-500">Loading…</div>
								) : (
									<div className="grid md:grid-cols-3 gap-4">
										<div className="p-4 rounded-xl bg-gradient-to-br from-black/40 via-slate-900/40 to-emerald-900/20 border border-white/5 space-y-3">
											<div className="text-xs uppercase tracking-wide text-slate-400">Activity (Last 7 Days)</div>
											<div className="flex gap-1 items-end h-16">
												{summary.activityByDay.map(d => {
													const max = Math.max(1, ...summary.activityByDay.map(x=>x.count));
													const h = (d.count / max) * 100;
													return (
														<div key={d.date} className="flex-1 flex flex-col items-center group">
															<div className="w-full bg-emerald-700/30 rounded-t relative" style={{height: Math.max(6,h)+'%'}}>
																<div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] opacity-0 group-hover:opacity-100 transition text-emerald-200">{d.count}</div>
															</div>
															<div className="mt-1 text-[9px] text-slate-500 rotate-45 origin-top-left whitespace-nowrap">{d.date.slice(5)}</div>
														</div>
													);
												})}
											</div>
											<div className="grid grid-cols-2 gap-2 text-[11px]">
												<div className="bg-white/5 rounded p-2 flex flex-col"><span className="text-slate-400 uppercase tracking-wide text-[9px]">Entries</span><span className="font-semibold text-emerald-200">{summary.counts.last7}</span></div>
												<div className="bg-white/5 rounded p-2 flex flex-col"><span className="text-slate-400 uppercase tracking-wide text-[9px]">Unique</span><span className="font-semibold text-emerald-200">{summary.counts.uniqueStrainsLast7}</span></div>
												<div className="bg-white/5 rounded p-2 flex flex-col"><span className="text-slate-400 uppercase tracking-wide text-[9px]">Streak</span><span className="font-semibold text-emerald-200">{summary.streak}</span></div>
												<div className="bg-white/5 rounded p-2 flex flex-col"><span className="text-slate-400 uppercase tracking-wide text-[9px]">Rating Avg</span><span className="font-semibold text-emerald-200">{summary.ratingAverageLast7}</span></div>
											</div>
										</div>
										<div className="p-4 rounded-xl bg-gradient-to-br from-black/40 via-slate-900/40 to-emerald-900/20 border border-white/5 space-y-3">
											<div className="text-xs uppercase tracking-wide text-slate-400">Effect Averages (7d)</div>
											<div className="space-y-2">
												{Object.entries(summary.effectAveragesLast7).map(([k,v]) => (
													<div key={k} className="text-[11px]">
														<div className="flex justify-between"><span className="capitalize text-slate-300">{k}</span><span className="text-emerald-200 font-medium">{v}</span></div>
														<div className="h-1.5 bg-black/40 rounded overflow-hidden mt-1">
															<div className="h-full bg-gradient-to-r from-emerald-500 to-green-400" style={{width: (v/5)*100+'%'}} />
														</div>
													</div>
												))}
											</div>
										</div>
										<div className="p-4 rounded-xl bg-gradient-to-br from-black/40 via-slate-900/40 to-emerald-900/20 border border-white/5 space-y-3">
											<div className="text-xs uppercase tracking-wide text-slate-400">Top Strains (7d)</div>
											{summary.topStrainsLast7.length === 0 && <div className="text-[11px] text-slate-500">No data yet</div>}
											<ul className="space-y-2">
												{summary.topStrainsLast7.map(s => (
													<li key={s.strainId} className="flex justify-between text-[11px] bg-white/5 rounded px-2 py-1">
														<span className="truncate max-w-[9rem]" title={s.name}>{s.name}</span>
														<span className="text-emerald-300">{s.count}× · {s.avgRating}</span>
													</li>
												))}
											</ul>
										</div>
									</div>
								)}
							</div>
						)}
						<h2 className="text-lg font-semibold mb-3">Achievements</h2>
						{achievementsLoading && (
							<div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3" aria-hidden="true">
								{Array.from({length:3}).map((_,i)=>(
									<div key={i} className="p-3 rounded-lg border border-white/10 bg-white/5 animate-pulse space-y-3">
										<div className="h-4 w-1/2 bg-white/10 rounded" />
										<div className="h-3 w-3/4 bg-white/10 rounded" />
										<div className="h-1.5 w-full bg-white/10 rounded" />
									</div>
								))}
							</div>
						)}
						{!achievementsLoading && achievements.length === 0 && (
							<div className="text-sm text-slate-500">No achievements yet. Log entries to start unlocking milestones.</div>
						)}
						{!achievementsLoading && achievements.length > 0 && (
							<div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
								{achievements.map(a => {
									const tier = a.tier || 'bronze';
									const pct = Math.min(100, (a.progress / a.target) * 100);
									return (
										<div key={a.id} className={cardClasses(tier, a.unlocked)}>
											<div className="font-semibold flex items-center gap-2">
												<span>{a.icon && <span className="inline-block mr-1" aria-hidden="true">{a.icon}</span>}{a.name}</span>
												<span className={`text-[9px] px-2 py-0.5 rounded uppercase tracking-wide ${tier === 'bronze' ? 'bg-amber-600/30 text-amber-200' : tier === 'silver' ? 'bg-slate-500/30 text-slate-100' : tier === 'gold' ? 'bg-yellow-600/30 text-yellow-100' : 'bg-cyan-600/30 text-cyan-100'}`}>{tier}</span>
												{a.unlocked && <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white">Unlocked</span>}
											</div>
											<p className="text-xs mt-1 text-slate-300">{a.description}</p>
											<div className="mt-2 group relative" aria-label={`Progress ${a.progress} of ${a.target}`}> 
												<div className="h-1.5 bg-black/40 rounded overflow-hidden">
													<div className={`h-full ${progressBarGradient(tier)}`} style={{width: pct + '%'}} />
												</div>
												<div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 rounded bg-black/80 text-[10px] opacity-0 group-hover:opacity-100 pointer-events-none transition whitespace-nowrap z-10">
													{a.progress}/{a.target} ({pct.toFixed(0)}%)
												</div>
											</div>
											<div className="mt-1 text-[10px] text-slate-400">{a.progress}/{a.target}</div>
										</div>
									);
								})}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}