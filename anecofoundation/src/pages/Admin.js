import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Admin.css';

export default function Admin() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // If already authenticated, go straight to dashboard
  useEffect(() => {
    const authed = localStorage.getItem('adminAuthed') === 'true';
    if (authed) {
      navigate('/dashboard');
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!code) {
      setError('Please enter a code');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const res = await fetch('http://localhost:3001/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setError(data.error || 'Invalid code');
        setCode('');
        return;
      }

      // Mark user as authenticated for this session
      localStorage.setItem('adminAuthed', 'true');
      navigate('/dashboard');
    } catch (err) {
      console.error('Login error:', err);
      setError('Unable to login. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-container">
      <div className="login-card">
        <div className="logo-wrap">
          <img src="/aneco2.png" alt="ANECO logo" className="login-logo" />
        </div>
        <h3>Enter code to login</h3>

        <form onSubmit={handleSubmit}>
          <label htmlFor="admin-code">Code</label>
          <input
            id="admin-code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter your access code"
            autoComplete="off"
          />

          {error && <div style={{ color: 'red', fontSize: 12, marginBottom: 8 }}>{error}</div>}

          <a href="#" className="forgot-link" onClick={(e) => e.preventDefault()}>Forgot code?</a>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Checking...' : 'LOGIN'}
          </button>
        </form>

        <p className="back-link">
          <Link to="/">Back to Scanner</Link>
        </p>
      </div>
    </div>
  );
}
