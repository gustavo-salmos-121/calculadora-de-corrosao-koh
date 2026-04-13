import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_DATASET, loadDatasets, saveDatasets, loadActiveId, saveActiveId } from './data.js';
import { parsePDF, getRawText } from './pdfParser.js';

// ─── Helpers ───
function fmt(n, d) {
  if (n == null || isNaN(n)) return '—';
  return d !== undefined ? n.toFixed(d) : String(n);
}

function fmtTime(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return `${hrs} h`;
  return `${hrs}h ${mins}min`;
}

// ═══════════════════════════════════════════
// APP
// ═══════════════════════════════════════════
export default function App() {
  // ─── Dataset state ───
  const [datasets, setDatasets] = useState(() => loadDatasets());
  const [activeId, setActiveId] = useState(() => loadActiveId());
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [rawText, setRawText] = useState('');
  const fileRef = useRef(null);

  const activeDS = datasets.find(d => d.id === activeId) || DEFAULT_DATASET;

  useEffect(() => { saveDatasets(datasets); }, [datasets]);
  useEffect(() => { saveActiveId(activeId); }, [activeId]);

  // ─── Calculator state ───
  const [depth, setDepth] = useState(99.578);
  const [maxTime, setMaxTime] = useState(2);
  const [maxTemp, setMaxTemp] = useState(80);
  const [oxide, setOxide] = useState(0.479);
  const [sortBy, setSortBy] = useState('time');
  const [sortDir, setSortDir] = useState('asc');

  // ─── Data inspection ───
  const [inspTab, setInspTab] = useState('si');
  const [showData, setShowData] = useState(false);

  // ─── Compute selectivity from dataset ───
  function getSelectivity(ds, conc, ti) {
    const si = ds.siEtchRate[conc]?.[ti];
    const sio2 = ds.sio2EtchRate[conc]?.[ti];
    if (!si || !sio2 || sio2 === 0) return NaN;
    return si / sio2;
  }

  // ─── Results ───
  const results = useMemo(() => {
    const ds = activeDS;
    const combos = [];
    for (const conc of ds.concentrations) {
      for (let ti = 0; ti < ds.temperatures.length; ti++) {
        const temp = ds.temperatures[ti];
        if (temp > maxTemp) continue;
        const sr = ds.siEtchRate[conc]?.[ti];
        const or_ = ds.sio2EtchRate[conc]?.[ti];
        if (!sr || !or_) continue;
        const sel = sr / or_;
        const time = depth / sr;
        if (time > maxTime) continue;
        const consumed = or_ * time;
        const remaining = oxide - consumed;
        combos.push({ conc, temp, sr, or: or_, sel, time, tmin: time * 60, consumed, remaining, ok: remaining > 0 });
      }
    }
    combos.sort((a, b) => {
      const k = { time: 'time', selectivity: 'sel', sio2c: 'consumed', sio2r: 'remaining', sirate: 'sr' }[sortBy] || 'time';
      return sortDir === 'asc' ? a[k] - b[k] : b[k] - a[k];
    });
    return combos;
  }, [activeDS, depth, maxTime, maxTemp, oxide, sortBy, sortDir]);

  const best = useMemo(() => {
    const f = results.filter(r => r.ok);
    return f.length ? f.reduce((b, r) => r.time < b.time ? r : b, f[0]) : null;
  }, [results]);

  const feasible = results.filter(r => r.ok).length;

  function doSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }
  function arrow(col) {
    if (sortBy !== col) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  // ─── PDF Upload ───
  const handleFile = useCallback(async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setUploadMsg({ type: 'err', text: 'Selecione um arquivo PDF.' });
      return;
    }

    setUploading(true);
    setUploadMsg(null);
    setShowRawText(false);

    try {
      // Extract raw text for preview
      const raw = await getRawText(file);
      setRawText(raw);

      // Parse the PDF
      const parsed = await parsePDF(file);

      const newDS = {
        id: `upload-${Date.now()}`,
        name: uploadName.trim() || file.name.replace('.pdf', ''),
        source: `Importado de ${file.name} em ${new Date().toLocaleDateString('pt-BR')}`,
        createdAt: new Date().toISOString(),
        isDefault: false,
        temperatures: parsed.temperatures,
        concentrations: parsed.concentrations,
        siEtchRate: parsed.siEtchRate,
        sio2EtchRate: parsed.sio2EtchRate,
      };

      setDatasets(prev => [...prev, newDS]);
      setActiveId(newDS.id);
      setUploadMsg({
        type: 'ok',
        text: `Importado com sucesso: ${parsed.concentrations.length} concentrações × ${parsed.temperatures.length} temperaturas.`
      });
      setUploadName('');
    } catch (err) {
      console.error(err);
      setUploadMsg({ type: 'err', text: err.message || 'Erro ao processar o PDF.' });
    } finally {
      setUploading(false);
    }
  }, [uploadName]);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }

  // ─── Dataset editing ───
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef(null);

  function startEditing(ds) {
    setEditingId(ds.id);
    setEditingName(ds.name);
    setTimeout(() => editInputRef.current?.focus(), 50);
  }

  function commitRename() {
    if (!editingId || !editingName.trim()) { setEditingId(null); return; }
    setDatasets(prev => prev.map(d =>
      d.id === editingId ? { ...d, name: editingName.trim() } : d
    ));
    setEditingId(null);
  }

  function deleteDataset(id) {
    if (id === DEFAULT_DATASET.id) return;
    const ds = datasets.find(d => d.id === id);
    const confirmed = window.confirm(
      `Excluir o dataset "${ds?.name || id}"?\nEssa ação não pode ser desfeita.`
    );
    if (!confirmed) return;
    setDatasets(prev => prev.filter(d => d.id !== id));
    if (activeId === id) setActiveId(DEFAULT_DATASET.id);
  }

  // ─── About modal ───
  const [showAbout, setShowAbout] = useState(false);
  const APP_VERSION = '2.1.0';

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════
  return (
    <>
      {/* HEADER */}
      <header className="header">
        <div className="header__badge">MEMS · Bulk Micromachining</div>
        <h1>Calculadora de Corrosão <span>KOH</span></h1>
        <p>Combinações viáveis de concentração e temperatura para corrosão anisotrópica de Si ⟨100⟩ em KOH.</p>
      </header>

      {/* DATASET MANAGER */}
      <section className="section fade" style={{ animationDelay: '.03s' }}>
        <h2 className="stitle">Conjunto de Dados</h2>
        <div className="card">
          {/* Dataset list */}
          <div className="ds-list">
            {datasets.map(ds => (
              <div
                key={ds.id}
                className={`ds-item ${activeId === ds.id ? 'active' : ''}`}
                onClick={() => setActiveId(ds.id)}
              >
                <div className="radio" />
                <div className="ds-info">
                  {editingId === ds.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                      <input
                        ref={editInputRef}
                        className="ds-edit-input"
                        type="text"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                        onBlur={commitRename}
                      />
                    </div>
                  ) : (
                    <div className="ds-name">
                      {ds.name}
                      {ds.isDefault && <span style={{ marginLeft: 8, fontSize: '.68rem', color: 'var(--brown-light)', fontFamily: 'var(--font-mono)' }}>(padrão)</span>}
                    </div>
                  )}
                  <div className="ds-meta">
                    {ds.concentrations.length} concentrações · {ds.temperatures.length} temperaturas
                    {ds.source && <> · {ds.source}</>}
                  </div>
                </div>
                <div className="ds-actions">
                  {!ds.isDefault && editingId !== ds.id && (
                    <button
                      className="btn btn--s btn--sm"
                      onClick={(e) => { e.stopPropagation(); startEditing(ds); }}
                      title="Renomear dataset"
                    >
                      ✎
                    </button>
                  )}
                  {!ds.isDefault && (
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={(e) => { e.stopPropagation(); deleteDataset(ds.id); }}
                      title="Excluir dataset"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Upload section */}
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--sand)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.72rem', fontWeight: 600, color: 'var(--crimson)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Importar Novo Dataset
            </div>

            <div className="grid" style={{ marginBottom: 12 }}>
              <div className="ig">
                <label>Nome do dataset <span className="u">(opcional)</span></label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={e => setUploadName(e.target.value)}
                  placeholder="ex: Dados do Prof. Silva"
                />
              </div>
            </div>

            <div
              className={`upload-zone ${dragOver ? 'drag' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {uploading ? (
                <>
                  <div className="spinner" style={{ margin: '0 auto 12px' }} />
                  <p>Processando PDF...</p>
                </>
              ) : (
                <>
                  <div className="icon">📄</div>
                  <p><strong>Arraste o PDF aqui</strong> ou clique para selecionar</p>
                  <div className="hint">Formato esperado: tabelas de taxas de corrosão Si/SiO₂ em KOH por concentração</div>
                </>
              )}
            </div>

            {uploadMsg && (
              <div className={`msg msg--${uploadMsg.type}`}>
                <span>{uploadMsg.type === 'ok' ? '✓' : uploadMsg.type === 'err' ? '✕' : 'ℹ'}</span>
                <span>{uploadMsg.text}</span>
              </div>
            )}

            {rawText && (
              <div>
                <button className="btn btn--s btn--sm" onClick={() => setShowRawText(v => !v)} style={{ marginTop: 8 }}>
                  {showRawText ? 'Ocultar texto extraído' : 'Ver texto extraído do PDF'}
                </button>
                {showRawText && <pre className="raw-text">{rawText}</pre>}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* EQUATIONS */}
      <section className="section fade" style={{ animationDelay: '.06s' }}>
        <h2 className="stitle">Equações Utilizadas</h2>
        <div className="card">
          <div className="eqbox">
            <strong>t</strong><sub>corrosão</sub> = d<sub>alvo</sub> / R<sub>Si</sub> &nbsp;&nbsp; [horas]
            <div className="lbl">Tempo de corrosão: profundidade alvo ÷ taxa de corrosão do Si.</div>
          </div>
          <div className="eqbox">
            SiO₂<sub>consumido</sub> = R<sub>SiO₂</sub> × t<sub>corrosão</sub> &nbsp;&nbsp; [μm]
            <div className="lbl">Espessura de SiO₂ consumida durante a imersão em KOH.</div>
          </div>
          <div className="eqbox">
            SiO₂<sub>restante</sub> = x<sub>óxido</sub> − SiO₂<sub>consumido</sub>
            <div className="lbl">Óxido restante após a corrosão. Deve ser &gt; 0 para a máscara sobreviver.</div>
          </div>
          <div className="eqbox">
            S = R<sub>Si</sub> / R<sub>SiO₂</sub>
            <div className="lbl">Seletividade Si/SiO₂: quantas vezes o KOH corrói o Si mais rápido que o óxido.</div>
          </div>
        </div>
      </section>

      {/* INPUTS */}
      <section className="section fade" style={{ animationDelay: '.09s' }}>
        <h2 className="stitle">Parâmetros do Projeto</h2>
        <div className="card card--hl">
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.68rem', color: 'var(--brown-light)', marginBottom: 12 }}>
            DATASET ATIVO: <strong style={{ color: 'var(--crimson)' }}>{activeDS.name}</strong>
          </div>
          <div className="grid">
            <div className="ig">
              <label>Profundidade alvo <span className="u">(μm)</span></label>
              <input type="number" step="0.001" value={depth} onChange={e => setDepth(+e.target.value || 0)} />
            </div>
            <div className="ig">
              <label>Tempo máx. <span className="u">(horas)</span></label>
              <input type="number" step="0.1" value={maxTime} onChange={e => setMaxTime(+e.target.value || 0)} />
            </div>
            <div className="ig">
              <label>Temperatura máx. <span className="u">(°C)</span></label>
              <input type="number" step="10" value={maxTemp} onChange={e => setMaxTemp(+e.target.value || 0)} />
            </div>
            <div className="ig">
              <label>Espessura SiO₂ <span className="u">(μm)</span></label>
              <input type="number" step="0.001" value={oxide} onChange={e => setOxide(+e.target.value || 0)} />
            </div>
          </div>
        </div>
      </section>

      {/* SUMMARY */}
      {results.length > 0 && (
        <section className="section fade" style={{ animationDelay: '.12s' }}>
          <h2 className="stitle">Resumo</h2>
          <div className="stats">
            <div className="sc"><div className="lb">Combinações</div><div className="vl">{results.length}</div></div>
            <div className="sc"><div className="lb">Óxido sobrevive</div><div className="vl" style={{ color: feasible > 0 ? 'var(--green-ok)' : 'var(--crimson)' }}>{feasible}</div></div>
            {best && <>
              <div className="sc"><div className="lb">Menor tempo</div><div className="vl">{fmtTime(best.time)}</div><div className="un">{best.conc}% KOH · {best.temp}°C</div></div>
              <div className="sc"><div className="lb">Seletividade</div><div className="vl">{fmt(best.sel, 1)} <span className="un">: 1</span></div></div>
            </>}
          </div>

          {best && (
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--brown-dark)', marginBottom: 10 }}>
                Cálculo Detalhado — Melhor Opção ({best.conc}% KOH a {best.temp}°C)
              </div>
              <div className="eqbox">
                t = {fmt(depth, 3)} / {fmt(best.sr)} = <b>{fmt(best.time, 4)} hr</b> = <b>{fmt(best.tmin, 1)} min</b>
                <div className="lbl">Tempo de corrosão</div>
              </div>
              <div className="eqbox">
                SiO₂<span className="sub">consumido</span> = {fmt(best.or)} × {fmt(best.time, 4)} = <b>{fmt(best.consumed, 4)} μm</b> = <b>{fmt(best.consumed * 1000, 1)} nm</b>
                <div className="lbl">Óxido consumido no KOH</div>
              </div>
              <div className="eqbox">
                SiO₂<span className="sub">restante</span> = {fmt(oxide, 3)} − {fmt(best.consumed, 4)} = <b>{fmt(best.remaining, 4)} μm</b> = <b>{fmt(best.remaining * 1000, 1)} nm</b>
                <div className="lbl">Reserva de óxido</div>
              </div>
              <div className="eqbox">
                S = {fmt(best.sr)} / {fmt(best.or)} = <b>{fmt(best.sel, 2)} : 1</b>
                <div className="lbl">Seletividade Si / SiO₂</div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* RESULTS TABLE */}
      <section className="section fade" style={{ animationDelay: '.15s' }}>
        <h2 className="stitle">Todas as Combinações Viáveis</h2>
        {results.length === 0 ? (
          <div className="nores"><b>Nenhuma combinação</b> atende às restrições. Ajuste os parâmetros.</div>
        ) : (
          <div className="tw">
            <table>
              <thead><tr>
                <th>#</th><th>%KOH</th><th>T(°C)</th>
                <th className="sortable" onClick={() => doSort('sirate')}>R_Si (μm/hr){arrow('sirate')}</th>
                <th>R_SiO₂ (μm/hr)</th>
                <th className="sortable" onClick={() => doSort('selectivity')}>Seletividade{arrow('selectivity')}</th>
                <th className="sortable" onClick={() => doSort('time')}>Tempo{arrow('time')}</th>
                <th className="sortable" onClick={() => doSort('sio2c')}>SiO₂ consumido{arrow('sio2c')}</th>
                <th className="sortable" onClick={() => doSort('sio2r')}>SiO₂ restante{arrow('sio2r')}</th>
                <th>Status</th>
              </tr></thead>
              <tbody>{results.map((r, i) => {
                const ib = best && r.conc === best.conc && r.temp === best.temp;
                return (
                  <tr key={`${r.conc}-${r.temp}`} className={ib ? 'best' : ''}>
                    <td>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{r.conc}%</td>
                    <td>{r.temp}°C</td>
                    <td>{fmt(r.sr)}</td>
                    <td>{fmt(r.or)}</td>
                    <td>{fmt(r.sel, 2)}</td>
                    <td>{fmtTime(r.time)}<br /><span style={{ fontSize: '.65rem', color: 'var(--brown-light)' }}>({fmt(r.time, 4)}h)</span></td>
                    <td>{fmt(r.consumed * 1000, 1)} nm</td>
                    <td style={{ color: r.ok ? 'var(--green-ok)' : 'var(--crimson)', fontWeight: 600 }}>{fmt(r.remaining * 1000, 1)} nm</td>
                    <td>{ib ? <span className="tag tbest">MELHOR</span> : r.ok ? <span className="tag tok">OK</span> : <span className="tag twarn">insuf.</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      {/* DATA INSPECTION */}
      <section className="section fade" style={{ animationDelay: '.18s' }}>
        <h2 className="stitle">Inspeção dos Dados</h2>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.7rem', color: 'var(--crimson)', fontWeight: 600 }}>EXIBINDO</div>
              <div style={{ fontSize: '.88rem', color: 'var(--brown-dark)', fontWeight: 500, marginTop: 2 }}>{activeDS.name}</div>
            </div>
            <button className={`btn ${showData ? 'btn--p' : 'btn--s'}`} onClick={() => setShowData(v => !v)}>
              {showData ? 'Ocultar Tabelas' : 'Exibir Tabelas'}
            </button>
          </div>

          {showData && (
            <div className="fade">
              <div className="tabs">
                <button className={`tab ${inspTab === 'si' ? 'a' : ''}`} onClick={() => setInspTab('si')}>Taxa Si (μm/hr)</button>
                <button className={`tab ${inspTab === 'sio2' ? 'a' : ''}`} onClick={() => setInspTab('sio2')}>Taxa SiO₂ (μm/hr)</button>
                <button className={`tab ${inspTab === 'sel' ? 'a' : ''}`} onClick={() => setInspTab('sel')}>Seletividade</button>
              </div>
              <div className="tw" style={{ maxHeight: 460, overflowY: 'auto' }}>
                <table style={{ fontSize: '.74rem' }}>
                  <thead><tr>
                    <th style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--brown-dark)' }}>%KOH \ T(°C)</th>
                    {activeDS.temperatures.map(t => <th key={t}>{t}°C</th>)}
                  </tr></thead>
                  <tbody>{activeDS.concentrations.map(conc => {
                    let src;
                    if (inspTab === 'si') src = activeDS.siEtchRate[conc];
                    else if (inspTab === 'sio2') src = activeDS.sio2EtchRate[conc];
                    else src = activeDS.temperatures.map((_, ti) => getSelectivity(activeDS, conc, ti));
                    return (
                      <tr key={conc}>
                        <td style={{ background: 'var(--cream)', fontWeight: 600, color: 'var(--brown-dark)', position: 'sticky', left: 0, zIndex: 1 }}>{conc}%</td>
                        {(src || []).map((v, i) => <td key={i}>{inspTab === 'sel' ? fmt(v, 2) : fmt(v)}</td>)}
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              <p style={{ marginTop: 10, fontSize: '.72rem', color: 'var(--brown-light)', fontStyle: 'italic' }}>
                Valores reproduzidos sem arredondamento ou truncamento.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ABOUT MODAL */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-logo">⬡</div>
              <h3>KOH Etch Calculator</h3>
              <span className="modal-ver">v{APP_VERSION}</span>
            </div>
            <div className="modal-body">
              <p>Ferramenta de cálculo para corrosão anisotrópica de silício em KOH, com suporte a múltiplos datasets e importação de tabelas via PDF.</p>
              <div className="modal-divider" />
              <p className="modal-copy">© {new Date().getFullYear()} SyncField Corporation. Todos os direitos reservados.</p>
              <p className="modal-sub">Desenvolvido para projetos de sensores MEMS — Processos Eletrônicos Avançados (PEA I), FATEC São Paulo.</p>
              <div className="modal-divider" />
              <div className="modal-tech">
                <span>React</span><span>Vite</span><span>pdf.js</span>
              </div>
            </div>
            <button className="btn btn--p" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={() => setShowAbout(false)}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="foot">
        <div className="foot-main">
          <span className="foot-logo">⬡</span>
          <span>© {new Date().getFullYear()} <strong>SyncField Corporation</strong></span>
          <span className="foot-sep">·</span>
          <span>KOH Etch Calculator v{APP_VERSION}</span>
        </div>
        <p style={{ marginTop: 6 }}>Datasets salvos localmente no navegador.</p>
        <button className="foot-about" onClick={() => setShowAbout(true)}>
          Sobre
        </button>
      </footer>
    </>
  );
}
