import { useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { pushReturnPath } from '../utils/pushPermissions.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { DEFAULT_AUTHENTICATED_PATH } from '../utils/navigation.js';

export default function Login() {
  const { authenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = pushReturnPath(location.state?.pushReturnTo) || DEFAULT_AUTHENTICATED_PATH;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (authenticated) {
    return <Navigate to={destination} replace />;
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login(email, password);
      navigate(destination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <span className="brand__mark brand__mark--logo">
          <img src="/logo.png" alt="ExtraSolutio" />
        </span>
        <h1>ExtraSolutio</h1>
        <label>
          Email
          <input
            type="email"
            value={email}
            autoComplete="email"
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="notice">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? 'A entrar...' : 'Entrar'}</button>
      </form>
    </div>
  );
}
