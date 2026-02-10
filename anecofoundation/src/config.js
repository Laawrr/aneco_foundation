// API Configuration
// Use REACT_APP_API_BASE_URL environment variable or default to network IP for same-network development
// For production, set REACT_APP_API_BASE_URL in your .env file
// Example: REACT_APP_API_BASE_URL=http://192.168.1.155:3001
// To use localhost instead, set: REACT_APP_API_BASE_URL=http://localhost:3001
export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://192.168.1.155:3001';

