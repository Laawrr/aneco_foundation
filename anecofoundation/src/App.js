
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';
import OCRLanding from './OCRLanding';
import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';
import ErrorPage from './pages/ErrorPage';

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
        <Route path="/error" element={<ErrorPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
