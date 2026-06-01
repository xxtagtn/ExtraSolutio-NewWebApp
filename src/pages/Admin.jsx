import ResourcePage from '../components/Crud/ResourcePage.jsx';
import Badge from '../components/UI/Badge.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useApi } from '../hooks/useApi.js';

const fields = [
  { name: 'name', label: 'Nome', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  {
    name: 'role',
    label: 'Perfil',
    type: 'select',
    defaultValue: 'user',
    options: [
      { value: 'user', label: 'Utilizador' },
      { value: 'admin', label: 'Administrador' },
    ],
  },
  {
    name: 'password',
    label: 'Password',
    type: 'password',
    minLength: 10,
    required: (editing) => !editing,
  },
];

function preparePayload(form, editing) {
  const payload = {
    name: form.name,
    email: form.email,
    role: form.role,
  };

  if (!editing || form.password) {
    payload.password = form.password;
  }

  return payload;
}

export default function Admin() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/users', []);

  if (user?.role !== 'admin') {
    return (
      <div className="page">
        <p className="notice">Acesso reservado a administradores.</p>
      </div>
    );
  }

  return (
    <ResourcePage
      title="Administracao"
      endpoint="/users"
      rows={data}
      loading={loading}
      error={error}
      reload={reload}
      fields={fields}
      preparePayload={preparePayload}
      columns={[
        { key: 'name', label: 'Nome' },
        { key: 'email', label: 'Email' },
        {
          key: 'role',
          label: 'Perfil',
          render: (row) => <Badge tone={row.role === 'admin' ? 'success' : 'info'}>{row.role}</Badge>,
        },
      ]}
      empty="Ainda não há utilizadores para apresentar."
    />
  );
}
