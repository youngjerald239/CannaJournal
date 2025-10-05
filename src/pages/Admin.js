import { useEffect, useState } from 'react';

export default function Admin() {
  const [strains, setStrains] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newStrainName, setNewStrainName] = useState('');
    // Removed mappings state as backend no longer supports mappings
    const [mapFrom, setMapFrom] = useState('');
    const [mapTo, setMapTo] = useState('');

  async function loadAll() {
    setLoading(true);
    try {
      const s = await fetch('http://localhost:5002/strains').then((r) => r.json());
      setStrains(s || []);
    // Removed setMappings as mappings are no longer needed
    } catch (e) {
      setStrains([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function addStrain() {
    if (!newStrainName) return;
    try {
      const body = { name: newStrainName };
      const res = await fetch('http://localhost:5002/strains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        setNewStrainName('');
        loadAll();
      }
    } catch (e) {}
  }

  async function addMapping() {
    // Removed addMapping function as mappings are no longer needed
  }

  async function deleteMapping(from) {
    // Removed deleteMapping function as mappings are no longer needed
  }

  return (
    <div className='p-4'>
      <h1 className='font-bold text-xl mb-2'>Admin</h1>
      {loading && <p>Loading…</p>}

      <section className='mb-6'>
        <h2 className='font-bold'>Strains</h2>
        <div className='mb-2'>
          <input value={newStrainName} onChange={(e) => setNewStrainName(e.target.value)} placeholder='New strain name' className='p-1 mr-2' />
          <button onClick={addStrain} className='px-2 py-1 bg-green-600 text-white rounded'>Add strain</button>
        </div>
        <ul>
          {strains.map((s) => (
            <li key={s.id} className='mb-1'>
              {s.id} — {s.name}
              
              <button className='ml-2 text-red-600' onClick={async () => {
                if (!window.confirm(`Delete strain ${s.name}?`)) return;
                try {
                  const res = await fetch(`http://localhost:5002/strains/${s.id}`, { method: 'DELETE' });
                  if (res.ok) loadAll();
                } catch (e) {}
              }}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
      
    </div>
  );
}
