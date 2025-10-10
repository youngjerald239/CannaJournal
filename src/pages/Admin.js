import { useEffect, useState } from 'react';

export default function Admin() {
  const [strains, setStrains] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newStrainName, setNewStrainName] = useState('');
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '' });

  async function loadAll() {
    setLoading(true);
    try {
  const s = await fetch('/strains').then((r) => r.json());
      setStrains(s || []);
      try {
        const us = await fetch('/users', { credentials: 'include' }).then((r) => r.json());
        setUsers(us || []);
      } catch (e) {}
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
  const res = await fetch('/strains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        setNewStrainName('');
        loadAll();
      }
    } catch (e) {}
  }

  // mappings removed — no-op placeholders intentionally removed to avoid unused warnings

  return (
    <div className='p-4'>
      <div className='max-w-4xl mx-auto px-4'>
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
                  const res = await fetch(`/strains/${s.id}`, { method: 'DELETE' });
                  if (res.ok) loadAll();
                } catch (e) {}
              }}>Delete</button>
            </li>
          ))}
        </ul>
      </section>

      <section className='mb-6'>
        <h2 className='font-bold'>Users</h2>
        <div className='mb-2'>
          <input value={newUser.username} onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))} placeholder='username (email)' className='p-1 mr-2' />
          <input value={newUser.password} onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))} placeholder='password' type='password' className='p-1 mr-2' />
          <button onClick={async () => {
            if (!newUser.username || !newUser.password) return alert('username & password required');
            try {
              const r = await fetch('/auth/signup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: newUser.username, password: newUser.password }) });
              if (r.ok) {
                setNewUser({ username: '', password: '' });
                loadAll();
              } else {
                alert('Failed to create user');
              }
            } catch (e) { alert('Failed'); }
          }} className='px-2 py-1 bg-blue-600 text-white rounded'>Create user</button>
        </div>
        <ul>
          {users.map((u) => (
            <li key={u.username} className='mb-1'>
              {u.username} {u.oauth ? <em className='ml-2 text-sm'>(OAuth)</em> : null}
              <button className='ml-2 text-red-600' onClick={async () => {
                if (!window.confirm(`Delete user ${u.username}?`)) return;
                try {
                  const res = await fetch(`/auth/users/${encodeURIComponent(u.username)}`, { method: 'DELETE', credentials: 'include' });
                  if (res.ok) loadAll();
                } catch (e) { }
              }}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
      </div>
    </div>
  );
}
