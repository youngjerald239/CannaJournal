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
	const fileInputRef = useRef(null);

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
							<div className="relative group">
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
							<div className="flex items-center gap-3">
								<button disabled={savingProfile} className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium">{savingProfile ? 'Saving…' : 'Save Profile'}</button>
								{saveMsg && <span className="text-xs text-slate-400">{saveMsg}</span>}
							</div>
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
				</div>
			</div>
		</div>
	);
}