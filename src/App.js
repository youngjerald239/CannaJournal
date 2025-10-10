import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Journal from './pages/Journal';
import Strains from './pages/Strains';
import Admin from './pages/Admin';
import Chat from './pages/Chat';
import Feed from './pages/Feed';
import Guides from './pages/Guides';
import './App.css';
import { AuthProvider } from './lib/auth';
import { useAuth } from './lib/auth';
import { Navigate } from 'react-router-dom';


function App() {
	function RequireAuth({ children }) {
		const { isAuthenticated, checking } = useAuth();
		if (checking) return null; // or a spinner
		return isAuthenticated ? children : <Navigate to='/login' />;
	}
return (
<Router>
<AuthProvider>
<Navbar />
<Routes>
<Route path='/' element={<Home />} />
<Route path='/login' element={<Login />} />
<Route path='/profile' element={<RequireAuth><Profile /></RequireAuth>} />
<Route path='/journal' element={<RequireAuth><Journal /></RequireAuth>} />
<Route path='/strains' element={<Strains />} />
				<Route path='/admin' element={<RequireAuth><Admin /></RequireAuth>} />
				<Route path='/chat' element={<RequireAuth><Chat /></RequireAuth>} />
				<Route path='/feed' element={<Feed />} />
				<Route path='/guides' element={<Guides />} />
</Routes>
</AuthProvider>
</Router>
);
}


export default App;