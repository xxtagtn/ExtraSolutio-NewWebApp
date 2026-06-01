import { LogOut, Menu, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';

export default function Header({ onToggleMenu }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button type="button" className="menu-toggle" onClick={onToggleMenu} aria-label="Abrir menu">
          <Menu size={18} />
        </button>
        <div>
          <h1>ExtraSolutio</h1>
          <span className="eyebrow">Staff & Eventos</span>
        </div>
      </div>
      <div className="topbar__actions">
        <Link className="profile-link" to="/profile">
          <UserRound size={17} />
          {user?.name || 'Perfil'}
        </Link>
        <button className="secondary-button" type="button" onClick={handleLogout}>
          <LogOut size={17} />
          Sair
        </button>
      </div>
    </header>
  );
}
