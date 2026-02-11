import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './ErrorPage.css';

function ErrorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state || {};

  const title = state.title || 'Something went wrong';
  const message = state.message || 'The request could not be completed. Please try again.';
  const details = Array.isArray(state.details) ? state.details : [];

  return (
    <div className="error-page">
      <div className="error-card">
        <div className="error-badge">Error</div>
        <h1>{title}</h1>
        <p className="error-message">{message}</p>

        {details.length > 0 && (
          <ul className="error-details">
            {details.map((detail, index) => (
              <li key={`${detail}-${index}`}>{String(detail)}</li>
            ))}
          </ul>
        )}

        <div className="error-actions">
          <button type="button" className="btn-primary" onClick={() => navigate('/')}>
            Back to Scanner
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorPage;

