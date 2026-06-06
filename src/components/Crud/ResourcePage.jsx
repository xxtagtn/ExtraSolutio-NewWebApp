import { Edit2, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import Card from '../UI/Card.jsx';
import IconButton from '../UI/IconButton.jsx';
import Modal from '../UI/Modal.jsx';
import Table from '../UI/Table.jsx';
import { api } from '../../utils/api.js';

function emptyRecord(fields) {
  return fields.reduce((record, field) => ({
    ...record,
    [field.name]: field.defaultValue ?? (field.type === 'checkbox-group' ? [] : ''),
  }), {});
}

function valueForInput(value, type) {
  if (type === 'checkbox-group') return Array.isArray(value) ? value : [];
  if (!value) return '';
  if (type === 'date') return String(value).slice(0, 10);
  return value;
}

export default function ResourcePage({
  title,
  endpoint,
  rows,
  columns,
  fields,
  loading,
  error,
  reload,
  preparePayload,
  empty,
  beforeTable,
  createLabel = 'Novo',
  onFormChange,
}) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => emptyRecord(fields));
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const tableColumns = [
    ...columns,
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div className="row-actions">
          <IconButton label="Editar" onClick={() => openForm(row)}><Edit2 size={16} /></IconButton>
          <IconButton label="Eliminar" tone="danger" onClick={() => remove(row)}><Trash2 size={16} /></IconButton>
        </div>
      ),
    },
  ];

  function openForm(row = null) {
    setEditing(row);
    setForm(row ? fields.reduce((record, field) => ({
      ...record,
      [field.name]: valueForInput(field.valueFromRow ? field.valueFromRow(row) : row[field.name], field.type),
    }), {}) : emptyRecord(fields));
    setFormError('');
    setFormOpen(true);
  }

  function closeForm() {
    setEditing(null);
    setForm(emptyRecord(fields));
    setFormError('');
    setFormOpen(false);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = preparePayload ? preparePayload(form, editing) : form;
      await api(`${endpoint}${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      closeForm();
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    if (!window.confirm(`Eliminar "${row.name || row.number || row.description || `#${row.id}`}"?`)) return;
    await api(`${endpoint}/${row.id}`, { method: 'DELETE' });
    reload();
  }

  function updateForm(name, value) {
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      return onFormChange ? onFormChange(next, { name, value, editing }) : next;
    });
  }

  return (
    <div className="page">
      <Card
        title={title}
        action={<button className="command-button" type="button" onClick={() => openForm()}><Plus size={17} />{createLabel}</button>}
      >
        {beforeTable}
        {error && <p className="notice">{error}</p>}
        <Table rows={loading ? [] : rows} columns={tableColumns} empty={empty} />
      </Card>

      {formOpen ? (
        <Modal title={editing ? `Editar ${title}` : `Novo ${title}`} onClose={closeForm}>
          <form className="resource-form" onSubmit={submit}>
            <div className="form-grid">
              {fields.filter((field) => !field.hidden?.(editing, form)).map((field) => (
                <label key={field.name} className={field.span === 2 ? 'span-2' : ''}>
                  {field.label}
                  {field.type === 'select' ? (
                    <select
                      value={form[field.name] ?? ''}
                      disabled={field.disabled?.(editing, form)}
                      required={typeof field.required === 'function' ? field.required(editing, form) : field.required}
                      onChange={(event) => updateForm(field.name, event.target.value)}
                    >
                      <option value="">Selecionar</option>
                      {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : field.type === 'checkbox-group' ? (
                    <div className="checkbox-group">
                      {field.options.map((option) => {
                        const selected = (form[field.name] ?? []).includes(option.value);
                        return (
                          <label className="checkbox-item" key={option.value}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) => {
                                const current = form[field.name] ?? [];
                                const next = event.target.checked
                                  ? [...current, option.value]
                                  : current.filter((value) => value !== option.value);
                                updateForm(field.name, next);
                              }}
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={form[field.name] ?? ''}
                      readOnly={field.readOnly}
                      disabled={field.disabled?.(editing, form)}
                      required={typeof field.required === 'function' ? field.required(editing, form) : field.required}
                      onChange={(event) => updateForm(field.name, event.target.value)}
                    />
                  ) : (
                    <input
                      type={field.type || 'text'}
                      step={field.step}
                      minLength={field.minLength}
                      placeholder={field.placeholder}
                      value={form[field.name] ?? ''}
                      readOnly={field.readOnly}
                      disabled={field.disabled?.(editing, form)}
                      required={typeof field.required === 'function' ? field.required(editing, form) : field.required}
                      onChange={(event) => updateForm(field.name, event.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            {formError && <p className="notice">{formError}</p>}
            <footer className="form-actions">
              <button className="command-button" type="submit" disabled={saving}><Save size={17} />Guardar</button>
              <button className="secondary-button" type="button" onClick={closeForm}>Cancelar</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
