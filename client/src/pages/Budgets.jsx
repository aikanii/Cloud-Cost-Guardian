import { useState } from 'react';
import { api, useApi, fmtMoney, STATUS_TONE } from '../lib/api.js';
import { Card, Loading, ErrorState, Badge, Progress, Modal, Field, Empty } from '../components/ui.jsx';
import { useGlobalFilters, useToast } from '../lib/context.js';

const EMPTY = { name: '', amount: '', period: 'monthly', scope_type: 'all', scope_value: '', threshold_pct: 80 };

export default function Budgets() {
  const budgets = useApi('/budgets');
  const { options } = useGlobalFilters();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (form) => {
    setSaving(true);
    try {
      if (form.id) await api(`/budgets/${form.id}`, { method: 'PUT', body: form });
      else await api('/budgets', { method: 'POST', body: form });
      toast(form.id ? 'Budget updated' : 'Budget created');
      setEditing(null);
      budgets.refetch();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };
  const remove = async (b) => {
    if (!confirm(`Delete budget "${b.name}"?`)) return;
    try { await api(`/budgets/${b.id}`, { method: 'DELETE' }); toast('Budget deleted'); budgets.refetch(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const list = budgets.data || [];
  const totals = { exceeded: list.filter((b) => b.status === 'exceeded').length, warning: list.filter((b) => b.status === 'warning').length, atRisk: list.filter((b) => b.status === 'at-risk').length };

  return (
    <div className="stack">
      <div className="page-header">
        <div><h1>Budgets</h1><p className="muted">{list.length} budgets · {totals.exceeded} exceeded · {totals.warning} at threshold · {totals.atRisk} forecast to exceed</p></div>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>+ New budget</button>
      </div>

      {budgets.loading ? <Loading /> : budgets.error ? <ErrorState error={budgets.error} onRetry={budgets.refetch} /> : list.length === 0 ? (
        <Card><Empty>No budgets yet. Create one to start tracking spend against targets.</Empty></Card>
      ) : (
        <div className="grid grid-2">
          {list.map((b) => (
            <Card key={b.id} title={b.name} subtitle={`${b.scopeLabel} · ${b.period} · ${b.periodStart} → ${b.periodEnd}`}
              actions={<><Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge><button className="btn btn-sm" onClick={() => setEditing({ ...b })}>Edit</button><button className="btn btn-sm btn-danger" onClick={() => remove(b)}>Delete</button></>}>
              <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{fmtMoney(b.spent)} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>of {fmtMoney(b.amount)}</span></div>
              <Progress pct={b.pctUsed} tone={STATUS_TONE[b.status]} marker={b.threshold_pct} />
              <div className="grid grid-3" style={{ marginTop: 14, gap: 8 }}>
                <Stat label="Used" value={`${b.pctUsed}%`} />
                <Stat label="Remaining" value={fmtMoney(b.remaining)} />
                <Stat label="Projected" value={`${fmtMoney(b.projected)} (${b.projectedPct}%)`} />
              </div>
              <p className="muted small" style={{ marginTop: 10 }}>Day {b.daysElapsed} of {b.daysTotal} · alert threshold {b.threshold_pct}%</p>
            </Card>
          ))}
        </div>
      )}

      {editing && <BudgetForm form={editing} setForm={setEditing} options={options} onSave={save} onClose={() => setEditing(null)} saving={saving} />}
    </div>
  );
}

function Stat({ label, value }) {
  return <div><div className="muted small">{label}</div><div style={{ fontWeight: 600 }}>{value}</div></div>;
}

function BudgetForm({ form, setForm, options, onSave, onClose, saving }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = (e) => { e.preventDefault(); onSave({ ...form, amount: Number(form.amount), threshold_pct: Number(form.threshold_pct) }); };
  return (
    <Modal title={form.id ? 'Edit budget' : 'New budget'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="budget-form" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <form id="budget-form" onSubmit={submit} className="stack" style={{ gap: 12 }}>
        <Field label="Name"><input required value={form.name} onChange={set('name')} placeholder="e.g. Production AWS" /></Field>
        <div className="form-grid">
          <Field label="Amount (USD)"><input required type="number" min="1" step="1" value={form.amount} onChange={set('amount')} /></Field>
          <Field label="Period"><select value={form.period} onChange={set('period')}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></Field>
        </div>
        <div className="form-grid">
          <Field label="Scope"><select value={form.scope_type} onChange={(e) => setForm({ ...form, scope_type: e.target.value, scope_value: '' })}><option value="all">All spend</option><option value="account">Account</option><option value="service">Service</option><option value="tag">Tag</option></select></Field>
          {form.scope_type === 'account' && <Field label="Account"><select required value={form.scope_value} onChange={set('scope_value')}><option value="">Select…</option>{(options?.accounts || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          {form.scope_type === 'service' && <Field label="Service"><select required value={form.scope_value} onChange={set('scope_value')}><option value="">Select…</option>{(options?.services || []).map((s) => <option key={s}>{s}</option>)}</select></Field>}
          {form.scope_type === 'tag' && <Field label="Tag (key=value)"><input required value={form.scope_value} onChange={set('scope_value')} placeholder="team=data" list="tag-options" /><datalist id="tag-options">{(options?.tags?.team || []).map((t) => <option key={t} value={`team=${t}`} />)}{(options?.tags?.env || []).map((t) => <option key={t} value={`env=${t}`} />)}</datalist></Field>}
        </div>
        <Field label={`Alert threshold: ${form.threshold_pct}%`} hint="A warning alert fires when spend passes this percentage; a critical one when exceeded.">
          <input type="range" min="10" max="100" step="5" value={form.threshold_pct} onChange={set('threshold_pct')} />
        </Field>
      </form>
    </Modal>
  );
}
