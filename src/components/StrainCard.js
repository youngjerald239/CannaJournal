
import { useState } from 'react';

export default function StrainCard({ strain }) {
	const [view, setView] = useState('consumer');
	const [animating, setAnimating] = useState(false);
	const [activeButton, setActiveButton] = useState(null);
	const list = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '—');

	function handleSwitchView(v) {
		// small animated feedback: highlight and scale the card, then switch content
		setActiveButton(v);
		setAnimating(true);
		setTimeout(() => {
			setView(v);
			setAnimating(false);
			setActiveButton(null);
		}, 260);
	}

	const effectsList = typeof strain.effects === 'string'
		? strain.effects.split(',').map((s) => s.trim()).filter(Boolean)
		: Array.isArray(strain.effects)
		? strain.effects
		: [];

	return (
			<div className={`bg-gradient-to-b from-black/60 to-black/30 p-4 rounded-xl shadow-lg text-gray-100 w-full border border-black/40 transform transition-all duration-250 ${animating ? 'scale-105 ring-2 ring-green-400/30 shadow-2xl' : ''}`}>
				<img
					src={strain.image ?? 'https://upload.wikimedia.org/wikipedia/commons/1/19/Cannabis_sativa_female_flower_closeup.jpg'}
					alt={strain.name}
					className='w-full h-40 object-cover rounded-lg mb-3'
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

				<div className='text-right'>
					<span className='text-sm px-2 py-1 rounded bg-green-600 text-white inline-block'>{strain.type}</span>
				</div>
			</div>

			<div className='mt-4 flex gap-3'>
				<button
					onClick={() => handleSwitchView('consumer')}
					className={`text-sm px-3 py-1 rounded-full transition transform duration-150 ${view === 'consumer' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-800/50 text-gray-200'} ${activeButton === 'consumer' ? 'scale-95 animate-pulse' : ''}`}>
					Consumer
				</button>
				<button
					onClick={() => handleSwitchView('grower')}
					className={`text-sm px-3 py-1 rounded-full transition transform duration-150 ${view === 'grower' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-800/50 text-gray-200'} ${activeButton === 'grower' ? 'scale-95 animate-pulse' : ''}`}>
					Grower
				</button>
			</div>

					{/* content area: crossfade when switching views */}
					{view === 'consumer' ? (
						<div className={`mt-3 text-sm space-y-1 transition-all duration-200 ${animating ? 'opacity-30 -translate-y-2' : 'opacity-100 translate-y-0'}`}>
							{strain.description && (
								<p className='text-gray-400 mb-2'>
									{strain.description.length > 200 ? strain.description.slice(0, 200) + '…' : strain.description}
								</p>
							)}
							<p><strong>Flavors:</strong> {list(strain.flavors)}</p>
							<p><strong>Aroma:</strong> {list(strain.aroma)}</p>
							<p><strong>Medical uses:</strong> {list(strain.medicalUses)}</p>
							<p><strong>Recommended use:</strong> {strain.recommendedUse ?? '—'}</p>
						</div>
					) : (
					<div className={`mt-3 pt-2 border-t text-sm transition-all duration-200 ${animating ? 'opacity-30 -translate-y-2' : 'opacity-100 translate-y-0'}`}>
					<h3 className='font-bold'>Grower info</h3>
					<p><strong>Difficulty:</strong> {strain.grow?.difficulty ?? 'Medium'}</p>
					<p><strong>Flowering time:</strong> {strain.grow?.floweringTime ?? '—'}</p>
					<p><strong>Indoor / Outdoor:</strong> {strain.grow?.indoorOutdoor ?? 'Both'}</p>
					<p><strong>Optimal temp:</strong> {strain.grow?.optimalTemp ?? '18–26°C'}</p>
					<p><strong>Feeding:</strong> {strain.grow?.feeding ?? 'Standard nutrients'}</p>
				</div>
			)}
		</div>
	);
}