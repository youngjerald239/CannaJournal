export default function StrainCard({ strain }) {
return (
<div className='border p-2 rounded shadow'>
<img src={strain.image} alt={strain.name} className='w-full h-32 object-cover rounded'/>
<h2 className='font-bold'>{strain.name}</h2>
<p>Type: {strain.type}</p>
<p>THC: {strain.thc}% | CBD: {strain.cbd}%</p>
<p>{strain.effects}</p>
</div>
);
}