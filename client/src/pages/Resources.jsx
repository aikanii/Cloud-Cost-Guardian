import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { api, useApi, qs, fmtMoney, fmtCompact, fmtDate } from '../lib/api.js';
import { Card, Loading, ErrorState, Badge, Empty, ProviderBadge, Modal, Field, Tooltip, PageHeader } from '../components/ui.jsx';
import { useGlobalFilters, useToast } from '../lib/context.js';

export default function Resources() {
  const { filters, options } = useGlobalFilters();
  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const [sort, setSort] = useState({ key: 'cost30', dir: 'desc' });
  const [selected, setSelected] = useState(null);
  const res = useApi(`/resources${qs({ ...filters, service, q: search })}`);

  const rows = useMemo(() => {
    const r = [...(res.data || [])];
    const dir = sort.dir === 'asc' ? 1 : -1;
    r.sort((a, b) => {
      const av = a[sort.key]; const bv = b[sort.key];
      if (typeof av === 'number' || typeof bv === 'number') return dir * ((av ?? -1) - (bv ?? -1));
      return dir * String(av ?? '').localeCompare(String(bv ?? ''));
    });
    return r;
  }, [res.data, sort]);
  const th = (key, label, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>{label} {sort.key === key && (sort.dir === 'asc' ? '↑' : '↓')}</th>
  );
  const total = rows.reduce((s, r) => s + r.cost30, 0);

  return (
    <div className="stack">
      <PageHeader eyebrow="Inventory" title="Resources" subtitle={<>{rows.length} resources · {fmtMoney(total)} over the last 30 days</>} />
      <div className="toolbar">
        <input placeholder="Search name or ID…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 240 }} />
        <select value={service} onChange={(e) => setService(e.target.value)}><option value="">All services</option>{(options?.services || []).map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <Card>
        {res.loading ? <Loading /> : res.error ? <ErrorState error={res.error} onRetry={res.refetch} /> : rows.length === 0 ? <Empty>No resources match.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr>{th('name', 'Resource')}{th('account', 'Account')}{th('service', 'Service')}{th('region', 'Region')}{th('type', 'Type')}<th>Tags</th>{th('avg_cpu', 'CPU', 'right')}{th('status', 'Status')}{th('cost30', '30d cost', 'right')}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: 'pointer' }}>
                    <td><strong>{r.name}</strong><div className="mono muted">{r.resource_id}</div></td>
                    <td><div className="row"><ProviderBadge provider={r.provider} /><span className="small">{r.account}</span></div></td>
                    <td>{r.service}</td><td className="mono">{r.region}</td><td className="mono">{r.type}</td>
                    <td>{Object.entries(r.tags).map(([k, v]) => <span key={k} className="tag">{k}={v}</span>)}</td>
                    <td className="right">{r.avg_cpu == null ? <span className="muted">—</span> : <span style={{ color: r.avg_cpu < 5 ? 'var(--red)' : r.avg_cpu < 30 ? 'var(--amber)' : 'inherit' }}>{r.avg_cpu}%</span>}</td>
                    <td><Badge tone={r.status === 'running' ? 'green' : r.status === 'unattached' ? 'amber' : 'gray'}>{r.status}</Badge></td>
                    <td className="right"><strong>{fmtMoney(r.cost30)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {selected && <ResourceModal resource={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); res.refetch(); }} />}
    </div>
  );
}

function ResourceModal({ resource, onClose, onSaved }) {
  const costs = useApi(`/resources/${resource.id}/costs?days=30`);
  const toast = useToast();
  const [tagText, setTagText] = useState(Object.entries(resource.tags).map(([k, v]) => `${k}=${v}`).join('\n'));
  const [status, setStatus] = useState(resource.status);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const tags = {};
    for (const line of tagText.split('\n')) { const i = line.indexOf('='); if (i > 0) tags[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    setSaving(true);
    try { await api(`/resources/${resource.id}`, { method: 'PATCH', body: { tags, status } }); toast('Resource updated'); onSaved(); }
    catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={resource.name} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></>}>
      <div className="row muted small"><ProviderBadge provider={resource.provider} /> {resource.account} · {resource.service} · {resource.region} · <span className="mono">{resource.resource_id}</span></div>
      <div className="grid grid-3" style={{ gap: 8 }}>
        <div><div className="muted small">30d cost</div><strong>{fmtMoney(resource.cost30)}</strong></div>
        <div><div className="muted small">Type</div><strong className="mono">{resource.type}</strong></div>
        <div><div className="muted small">Avg CPU</div><strong>{resource.avg_cpu == null ? '—' : `${resource.avg_cpu}%`}</strong></div>
      </div>
      {costs.loading ? <Loading /> : (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={costs.data}><XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10 }} minTickGap={30} /><YAxis tickFormatter={fmtCompact} tick={{ fontSize: 10 }} width={48} /><RTooltip content={<Tooltip />} labelFormatter={fmtDate} /><Area type="monotone" dataKey="cost" name="Cost" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.2} /></AreaChart>
        </ResponsiveContainer>
      )}
      <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="running">running</option><option value="stopped">stopped</option><option value="unattached">unattached</option></select></Field>
      <Field label="Tags (one key=value per line)"><textarea rows={4} value={tagText} onChange={(e) => setTagText(e.target.value)} className="mono" /></Field>
    </Modal>
  );
}
