
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './App.css';
import OCRLanding from './OCRLanding';
import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';

function App() {
  return (
    <BrowserRouter>
      {/* <header className="app-header">
        <h1 className="title">ANECO Receipt Scanner</h1>
      </header> */}

      <Routes>
        <Route path="/" element={<OCRLanding />} />
        <Route path="/login" element={<Admin />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
