import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Journal from './pages/Journal';
import Strains from './pages/Strains';


function App() {
return (
<Router>
<Navbar />
<Routes>
<Route path='/' element={<Home />} />
<Route path='/login' element={<Login />} />
<Route path='/profile' element={<Profile />} />
<Route path='/journal' element={<Journal />} />
<Route path='/strains' element={<Strains />} />
</Routes>
</Router>
);
}


export default App;