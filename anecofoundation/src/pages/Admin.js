import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import './Admin.css';

const ADMIN_AUTH_KEY = 'adminAuthed';
const ADMIN_SESSION_KEY = 'adminSessionId';

export default function Admin() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const clearAdminAuth = () => {
    localStorage.removeItem(ADMIN_AUTH_KEY);
    localStorage.removeItem(ADMIN_SESSION_KEY);
  };

  // Redirect authenticated users away from login page
  useEffect(() => {
    let active = true;

    const validateExistingSession = async () => {
      const authed = localStorage.getItem(ADMIN_AUTH_KEY) === 'true';
      const storedSessionId = localStorage.getItem(ADMIN_SESSION_KEY);

      if (!authed || !storedSessionId) {
        clearAdminAuth();
        return;
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/session-status`);
        const data = await res.json().catch(() => ({}));

        if (!active) return;

        if (res.ok && data.ok && data.sessionId && data.sessionId === storedSessionId) {
          navigate('/dashboard', { replace: true });
          return;
        }

        clearAdminAuth();
      } catch (err) {
        // If server is unavailable or restarted, force fresh login.
        clearAdminAuth();
      }
    };

    validateExistingSession();

    return () => {
      active = false;
    };
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

      const res = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setError(data.error || 'Invalid code');
        setCode('');
        // Clear any auth data on failed login attempt for security
        clearAdminAuth();
        return;
      }

      if (!data.sessionId) {
        setError('Login failed. Please try again.');
        setCode('');
        clearAdminAuth();
        return;
      }

      // Mark user as authenticated for this session
      localStorage.setItem(ADMIN_AUTH_KEY, 'true');
      localStorage.setItem(ADMIN_SESSION_KEY, data.sessionId);
      navigate('/dashboard');
    } catch (err) {
      console.error('Login error:', err);
      setError('Unable to login. Please try again.');
      // Clear any auth data on network/connection error for security
      clearAdminAuth();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-container">
      <div className="login-card">
        <div className="logo-wrap">
          <img 
            src="/aneco2.png" 
            alt="ANECO logo" 
            className="login-logo"
            loading="eager"
            onLoad={(e) => {
              // Ensure image maintains aspect ratio after load
              e.target.style.width = 'auto';
            }}
          />
        </div>
        <h3>Enter code to login</h3>

        <form onSubmit={handleSubmit}>
          <label htmlFor="admin-code">Code</label>
          <input
            id="admin-code"
            type="text"
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
