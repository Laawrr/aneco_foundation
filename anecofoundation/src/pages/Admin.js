import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import './Admin.css';

export default function Admin() {
  const [code, setCode] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // Placeholder: replace with real auth flow
    alert(code ? `Code submitted: ${code}` : 'Please enter a code');
  };

  return (
    <div className="admin-container">
      <div className="login-card">
        <h3>Enter code to login</h3>

        <form onSubmit={handleSubmit}>
          <label htmlFor="admin-code">Code</label>
          <input
            id="admin-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter your access code"
            autoComplete="off"
          />

          <a href="#" className="forgot-link" onClick={(e) => e.preventDefault()}>Forgot code?</a>

          <button type="submit" className="login-btn">LOGIN</button>
        </form>

        <p className="back-link">
          <Link to="/">Back to Scanner</Link>
        </p>
      </div>
    </div>
  );
}
