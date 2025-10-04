import StrainCard from '../components/StrainCard';


const mockStrains = [
{ id: 1, name: 'Blue Dream', type: 'Hybrid', thc: 18, cbd: 1, effects: 'Relaxed, Happy', image: 'https://upload.wikimedia.org/wikipedia/commons/1/19/Cannabis_sativa_female_flower_closeup.jpg' },
{ id: 2, name: 'Sour Diesel', type: 'Sativa', thc: 20, cbd: 0.5, effects: 'Energetic, Uplifted', image: 'https://upload.wikimedia.org/wikipedia/commons/1/19/Cannabis_sativa_female_flower_closeup.jpg' },
];


export default function Strains() {
return (
<div className='p-4 grid grid-cols-1 md:grid-cols-3 gap-4'>
{mockStrains.map(strain => <StrainCard key={strain.id} strain={strain} />)}
</div>
);
}