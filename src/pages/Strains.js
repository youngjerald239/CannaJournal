import StrainCard from '../components/StrainCard';
import { useEffect, useState } from 'react';


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

		useEffect(() => {
			let mounted = true;
				async function buildStrains() {
					setLoading(true);

					// Try backend API first
					try {
					const controller = new AbortController();
					// allow a slightly longer timeout for local dev
					const timeout = setTimeout(() => controller.abort(), 5000);
						const res = await fetch('http://localhost:5002/strains', { signal: controller.signal });
						clearTimeout(timeout);
						if (res.ok) {
							const data = await res.json();
							if (mounted) {
								setStrains(Array.isArray(data) ? data : []);
								setLoading(false);
								return;
							}
						}
					} catch (err) {
						// ignore; backend failed and we will build local defaults
					}

					// Backend not available or failed -> build from strainNames without external enrichment
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
						grow: {
							difficulty: 'Medium',
							floweringTime: null,
							indoorOutdoor: 'Both',
							optimalTemp: null,
							feeding: null,
						},
					}));
					if (mounted) setStrains(results);
					setLoading(false);
				}
				buildStrains();
			return () => {
				mounted = false;
			};
		}, []);

    return (
        <div className='p-4'>
            <div className='max-w-6xl mx-auto px-4'>
			<div className='mb-4'>
				<button onClick={() => { setLoading(true); fetch('http://localhost:5002/strains').then(r=>r.json()).then(d=>{setStrains(d);setLoading(false)}).catch(()=>setLoading(false)) }} className='px-2 py-1 bg-blue-600 text-white rounded'>Refresh strains</button>
			</div>
			{loading && <p className='mb-4'>Fetching strain summaries…</p>}
                <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4'>
				{strains.map((strain) => (
					<StrainCard key={strain.id} strain={strain} />
				))}
			</div>
            </div>
		</div>
	);
}