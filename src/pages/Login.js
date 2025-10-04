import { useState } from 'react';


export default function Login() {
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');


const handleLogin = (e) => {
e.preventDefault();
alert(`Logged in with email: ${email}`);
};


return (
<div className='max-w-md mx-auto mt-20 p-4 border rounded shadow'>
<h1 className='text-xl font-bold mb-4'>Login</h1>
<form onSubmit={handleLogin}>
<input type='email' placeholder='Email' value={email} onChange={e => setEmail(e.target.value)} className='block mb-2 p-2 border rounded w-full'/>
<input type='password' placeholder='Password' value={password} onChange={e => setPassword(e.target.value)} className='block mb-2 p-2 border rounded w-full'/>
<button type='submit' className='bg-green-500 text-white p-2 rounded w-full'>Login</button>
</form>
</div>
);
}