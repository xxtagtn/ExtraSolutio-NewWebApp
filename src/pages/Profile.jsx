import { Save, Upload, X } from 'lucide-react';
import { useState } from 'react';
import Card from '../components/UI/Card.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../utils/api.js';
import { createImageThumbnailDataUrl } from '../utils/imageThumbnails.js';
import { userInitials } from '../utils/userProfile.js';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [photo, setPhoto] = useState(user?.photo || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [error, setError] = useState('');

  async function saveProfile(event) {
    event.preventDefault();
    setError('');
    setProfileMessage('');

    try {
      const result = await api('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, photo: photo || null }),
      });
      updateUser(result.user);
      setProfileMessage('Perfil atualizado.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function onPhotoSelected(file) {
    if (!file) return;
    try {
      const nextPhoto = await createImageThumbnailDataUrl(file, { maxSize: 240, quality: 0.8 });
      setPhoto(nextPhoto);
    } catch {
      setError('Não foi possível carregar a fotografia.');
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setError('');
    setPasswordMessage('');

    if (newPassword !== confirmPassword) {
      setError('A confirmação da password não coincide.');
      return;
    }

    try {
      const result = await api('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage(result.message);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="grid grid--two">
        <Card title="Perfil">
          <form className="resource-form profile-form" onSubmit={saveProfile}>
            <section className="profile-photo-editor">
              <span className="user-avatar user-avatar--large">
                {photo ? <img src={photo} alt={`Foto de ${name || 'utilizador'}`} /> : <span>{userInitials(name)}</span>}
              </span>
              <div>
                <strong>{name || 'Utilizador'}</strong>
                <span>{user?.email || ''}</span>
                <div className="profile-photo-editor__actions">
                  <label className="button button--ghost">
                    <Upload size={16} />
                    Escolher foto
                    <input type="file" accept="image/*" hidden onChange={(event) => onPhotoSelected(event.target.files?.[0])} />
                  </label>
                  {photo ? (
                    <button type="button" className="button button--ghost button--danger" onClick={() => setPhoto('')}>
                      <X size={16} />
                      Remover
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
            <label>
              Nome
              <input value={name} required onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Email
              <input value={user?.email || ''} disabled />
            </label>
            <label>
              Perfil
              <input value={user?.role || ''} disabled />
            </label>
            {profileMessage && <p className="success-note">{profileMessage}</p>}
            <button className="command-button" type="submit">
              <Save size={17} />
              Guardar perfil
            </button>
          </form>
        </Card>

        <Card title="Alterar password">
          <form className="resource-form profile-form" onSubmit={changePassword}>
            <label>
              Password atual
              <input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                required
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              Nova password
              <input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                minLength={10}
                required
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirmar nova password
              <input
                type="password"
                value={confirmPassword}
                autoComplete="new-password"
                minLength={10}
                required
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {error && <p className="notice">{error}</p>}
            {passwordMessage && <p className="success-note">{passwordMessage}</p>}
            <button className="command-button" type="submit">
              <Save size={17} />
              Alterar password
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
