import React from 'react';
import { Link } from 'react-router-dom';

export default function Admin() {
  return (
    <div style={{padding:20}}>
      <h2>Admin</h2>
      <p>Welcome to the admin page. (Placeholder)</p>
      <p>
        <Link to="/">Back to Scanner</Link>
      </p>
    </div>
  );
}
