import { useState } from 'react';
import { api, useApi, fmtMoney } from '../lib/api.js';
import { Card, Loading, ErrorState, ProviderBadge, Modal, Field, Empty } from '../components/ui.jsx';
import { useToast } from '../lib/context.js';

const EMPTY = { name: '', provider: 'aws', external_id: '' };
const ID_HINT = { aws: '12-digit account ID', gcp: 'Project ID', azure: 'Subscription ID (GUID)' };

export default function Accounts() {
  const accounts = useApi('/accounts');
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await api('/accounts', { method: 'POST', body: form }); toast('Account connected'); setForm(null); accounts.refetch(); }
    catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };
  const remove = async (a) => {
    if (!confirm(`Disconnect "${a.name}"? All of its cost data will be removed.`)) return;
    try { await api(`/accounts/${a.id}`, { method: 'DELETE' }); toast('Account removed'); accounts.refetch(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const total = (accounts.data || []).reduce((s, a) => s + a.cost30, 0);

  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Cloud accounts</h1><p className="muted">{accounts.data?.length || 0} connected · {fmtMoney(total)} in the last 30 days</p></div>
        <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}>+ Connect account</button>
      </div>
      <Card>
        {accounts.loading ? <Loading /> : accounts.error ? <ErrorState error={accounts.error} onRetry={accounts.refetch} /> : accounts.data.length === 0 ? <Empty>No accounts connected.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th>Provider</th><th>External ID</th><th>Currency</th><th className="right">Resources</th><th className="right">30d cost</th><th className="right">Share</th><th /></tr></thead>
              <tbody>
                {accounts.data.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.name}</strong><div className="muted small">Connected {new Date(a.created_at + 'Z').toLocaleDateString()}</div></td>
                    <td><ProviderBadge provider={a.provider} /></td>
                    <td className="mono">{a.external_id}</td>
                    <td>{a.currency}</td>
                    <td className="right">{a.resources}</td>
                    <td className="right"><strong>{fmtMoney(a.cost30)}</strong></td>
                    <td className="right">{total ? ((a.cost30 / total) * 100).toFixed(1) : 0}%</td>
                    <td className="right"><button className="btn btn-sm btn-danger" onClick={() => remove(a)}>Disconnect</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Ingesting cost data">
        <p className="muted">Push billing exports into any account via <span className="kbd">POST /api/costs/ingest</span> with a JSON array of <span className="mono">{'{ accountId, date, service, region, cost, tags }'}</span> entries. Demo data can be regenerated from Settings.</p>
      </Card>
      {form && (
        <Modal title="Connect cloud account" onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" type="submit" form="acct-form" disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</button></>}>
          <form id="acct-form" onSubmit={save} className="stack" style={{ gap: 12 }}>
            <Field label="Display name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Production (AWS)" /></Field>
            <div className="form-grid">
              <Field label="Provider"><select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}><option value="aws">AWS</option><option value="gcp">Google Cloud</option><option value="azure">Azure</option></select></Field>
              <Field label={ID_HINT[form.provider]}><input required value={form.external_id} onChange={(e) => setForm({ ...form, external_id: e.target.value })} /></Field>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
