import { Link } from 'react-router-dom';


export default function Navbar() {
return (
<nav className='p-4 bg-green-600 text-white flex justify-between'>
<h1 className='font-bold'>Weed Journal</h1>
<div className='space-x-4'>
<Link to='/'>Home</Link>
<Link to='/strains'>Strains</Link>
		<Link to='/admin'>Admin</Link>
<Link to='/journal'>Journal</Link>
<Link to='/profile'>Profile</Link>
<Link to='/login'>Login</Link>
</div>
</nav>
);
}