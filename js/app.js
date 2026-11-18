/* WS Monitor: ponto de entrada. Porta serial -> separação dos pacotes -> validação e decodificação ->
   Dashboard / Tabela / Texto, log técnico e gravação em arquivo. */
import { APP_VERSION, BAUD_RATES, DEFAULT_BAUD, DEFAULT_RX, DEV_PASSWORD_SHA256, HISTORY_POINTS, MAX_RECORDS, STALE_FACTOR } from './config.js';
import { DEFAULT_FACTORS, FIELDS, FrameSplitter, PERIOD_S, assess, cardinal, checkFrame, crc8, decode, encodeRaw, parseHexBytes, rawFromValues, splitBurst, sum8, toHex } from './wh24c.js';
import { CSV_STYLES, STATUS_LABEL, SOURCE_LABEL, csvHeader, csvRow, compactLine, detailLines, metaLines } from './format.js';
import { Dashboard, renderTable, textClass, textFor } from './views.js';
import { SerialLink } from './serial.js';
import { Recorder } from './recorder.js';
import { LogSink } from './logsink.js';
import { Term, confirmDialog, expandCard, initCollapsibleCards, passwordDialog, splash, startClock } from './ui.js';
import { $, copyText, downloadText, el, escapeHtml, fmtBytes, fmtDateTime, fmtDuration, fmtNum, fmtTime, hex2, isoLocal, sha256Hex, stampForFile, store, tzOffset } from './util.js';

const splashDone = splash();
startClock();

const link = new SerialLink();
const sink = new LogSink();
const log = new Term($('log'), { onText: (t) => sink.push(t) });
const txt = new Term($('txtOut'), { maxChars: 600_000 });
const recorder = new Recorder();

export const ctx = {
  link, log, recorder,
  tab: 'dash',
  factors: { ...DEFAULT_FACTORS, ...store.get('factors', {}) },
  rx: { ...DEFAULT_RX, ...store.get('rx', {}) },
  records: [],
  seq: 0,
  stats: null,
  hist: null,
  mm: null,
  rainRef: null,
  last: null,
  sim: null,
  recOpts: null,
  tableDirty: true,
  started: false,
};

const splitter = new FrameSplitter({ gapMs: ctx.rx.gapMs, onBurst: (b, t0, timeAt) => handleBurst(b, t0, 'serial', timeAt) });
const baud = () => Number($('baud').value) || DEFAULT_BAUD;

/* ------------------------------------------------------------------ */
/* Sessão: contadores, mín./máx. e mini-séries */
function newSession() {
  ctx.stats = { ok: 0, crc: 0, sum: 0, junk: 0, missed: 0, readErrors: 0, since: Date.now(), lastT: null, intervals: [], lastId: null, ids: new Set(), hasPressure: false, lowBattery: false, staleLogged: false };
  ctx.hist = Object.fromEntries(FIELDS.map((f) => [f.key, []]));
  ctx.mm = {};
  ctx.rainRef = null;
  ctx.last = null;
  ctx.records = [];
  ctx.tableDirty = true;
  txt.clear();
  dash?.clear();
  $('dashEmpty').classList.remove('hide');
  $('dashBat').classList.add('hide');
  $('dashAge').textContent = '';
  if (ctx.tab === 'table') renderTableNow();
  renderStation();
}

/* ------------------------------------------------------------------ */
/* Recepção */
function onSerialData(chunk) {
  if (ctx.rx.logChunks) log.line(`RX ${chunk.length} B: ${toHex(chunk)}`, 'm');
  splitter.push(chunk);
}

/* Uma rajada de bytes (porta serial após o silêncio, simulador ou pacote manual). timeAt(offset) dá a
   hora de chegada de cada pacote da rajada (porta serial); sem ele, todos recebem t. */
export function handleBurst(bytes, t, source, timeAt = null) {
  for (const part of splitBurst(bytes)) {
    if (part.kind === 'frame') { processFrame(part.bytes, timeAt ? timeAt(part.offset) : t, source); continue; }
    ctx.stats.junk += part.bytes.length;
    if (recorder.active && ctx.recStats) ctx.recStats.junk += part.bytes.length;
    const msg = `Bytes descartados (${part.bytes.length}${source !== 'serial' ? ', ' + SOURCE_LABEL[source] : ''}): ${toHex(part.bytes.slice(0, 64))}${part.bytes.length > 64 ? ' …' : ''}`;
    log.line(msg, 'w');
    txt.append(`${fmtTime(new Date(t))} ${msg}\n`, 'w', { silent: true });
  }
  renderStation();
}

function processFrame(bytes, t, source) {
  const s = ctx.stats;
  const check = checkFrame(bytes);
  const status = check.crcOk ? (check.sumOk ? 'ok' : 'sum') : 'crc';
  const accepted = status === 'ok' || (status === 'sum' && ctx.rx.acceptBadSum);
  const r = { seq: ++ctx.seq, t, source, bytes, hex: toHex(bytes), check, status, accepted, dec: null, asm: null, alerts: [], factors: { ...ctx.factors } };
  s[status]++;
  if (accepted) {
    const d = (r.dec = decode(bytes, ctx.factors));
    r.asm = assess(d);
    for (const fd of FIELDS) { const a = r.asm[fd.key]; if (a.st === 'warn' || a.st === 'err') r.alerts.push(`${fd.label} ${a.msg}`); }
    if (d.lowBattery) r.alerts.push('bateria baixa');
    if (!d.fixOk) r.alerts.push('bits fixos do byte 3 diferentes de 11');
    if (status === 'sum') r.alerts.push('aceito com checksum errado (Modo Desenvolvedor)');
    if (s.lastId !== null && d.id !== s.lastId) r.alerts.push(`ID mudou de ${hex2(s.lastId)} para ${hex2(d.id)}: estação reiniciada ou outra estação na linha`);
    if (s.lastT !== null) {
      const dt = t - s.lastT;
      s.intervals.push(dt);
      if (s.intervals.length > 30) s.intervals.shift();
      if (source === 'serial' && dt > PERIOD_S * 1500) s.missed += Math.round(dt / (PERIOD_S * 1000)) - 1;
    }
    if (s.staleLogged) { log.line('Pacotes voltaram a chegar.', 'i'); s.staleLogged = false; }
    s.lastT = t;
    s.lastId = d.id;
    s.ids.add(d.id);
    s.hasPressure = d.hasPressure;
    s.lowBattery = d.lowBattery;
    if (ctx.rainRef === null) ctx.rainRef = d.raw.rain;
    for (const fd of FIELDS) {
      const v = d.values[fd.key];
      const h = ctx.hist[fd.key];
      h.push({ t, v: r.asm[fd.key].st === 'err' || r.asm[fd.key].st === 'none' ? null : v });
      if (h.length > HISTORY_POINTS) h.shift();
      if (v !== null && r.asm[fd.key].st !== 'err' && r.asm[fd.key].st !== 'none') {
        const m = ctx.mm[fd.key];
        ctx.mm[fd.key] = m ? { min: Math.min(m.min, v), max: Math.max(m.max, v) } : { min: v, max: v };
      }
    }
    ctx.last = r;
    dash.update(r, ctx.hist, ctx.mm, ctx.rainRef);
    $('dashEmpty').classList.add('hide');
    $('dashBat').classList.toggle('hide', !d.lowBattery);
    resetNextBar();
    flashPill();
  }
  ctx.records.push(r);
  if (ctx.records.length > MAX_RECORDS) ctx.records.shift();

  /* Log técnico: o pacote bruto e o resultado da validação */
  const tagSrc = source !== 'serial' ? ` [${SOURCE_LABEL[source]}]` : '';
  log.line(`#${r.seq}${tagSrc} ${bytes.length} B ${STATUS_LABEL[status]}${status === 'ok' ? '' : ` (CRC ${hex2(check.crcRx ?? 0)}/${hex2(check.crcCalc ?? 0)}, checksum ${hex2(check.sumRx ?? 0)}/${hex2(check.sumCalc ?? 0)} recebido/calculado)`}: ${r.hex}`, status === 'ok' ? '' : 'e');
  for (const a of r.alerts) log.line(`#${r.seq} alerta: ${a}`, 'w');

  txt.append(textFor(r, textOpts()), textClass(r), { silent: true });
  ctx.tableDirty = true;
  if (ctx.tab === 'table') renderTableNow();

  if (recorder.active) trackRec(r);
  if (recorder.active && (accepted || ctx.recOpts.includeInvalid)) {
    recorder.append(ctx.recOpts.fmt === 'csv' ? csvRow(r, ctx.recOpts.style) : compactLine(r, { date: true, hex: true }) + '\r\n');
  }
}

/* ------------------------------------------------------------------ */
/* Estação: situação da comunicação (atualizada a cada segundo) */
function renderStation() {
  const s = ctx.stats;
  const now = Date.now();
  const open = link.isOpen;
  const live = open || !!ctx.sim;
  const age = s.lastT !== null ? now - s.lastT : null;
  const stale = live && (age === null ? now - (ctx.liveSince ?? now) > STALE_FACTOR * PERIOD_S * 1000 : age > STALE_FACTOR * PERIOD_S * 1000);
  const tag = $('stTag');
  if (!live) { tag.className = 'tag'; tag.textContent = 'Desconectado'; }
  else if (stale) { tag.className = 'tag warn'; tag.textContent = age === null ? 'Nenhum pacote' : `Sem dados há ${fmtDuration(age)}`; }
  else if (age === null) { tag.className = 'tag acc'; tag.textContent = 'Aguardando pacote'; }
  else { tag.className = 'tag ok'; tag.textContent = 'Recebendo'; }
  if (stale && !s.staleLogged) {
    s.staleLogged = true;
    log.line(age === null ? `Nenhum pacote válido em ${fmtDuration(now - ctx.liveSince)}: confira a alimentação da estação, os fios A/B do RS-485 e o baudrate.` : `Sem pacotes válidos há ${fmtDuration(age)}.`, 'w');
  }

  const d = ctx.last?.dec;
  const avg = s.intervals.length ? s.intervals.reduce((a, b) => a + b, 0) / s.intervals.length : null;
  const rows = [
    ['Conexão', open ? `${escapeHtml(link.portLabel())} <small>· ${link.baud} bps 8N1</small>` : ctx.sim ? 'simulador' : '<span class="muted">desconectado</span>'],
    ['ID da estação', d ? `<span class="mono">${hex2(d.id)}</span> <small>(${d.id})</small>${s.ids.size > 1 ? ` <span class="warn" title="IDs vistos nesta sessão: ${[...s.ids].map(hex2).join(', ')}">· ${s.ids.size} IDs</span>` : ''}` : '—'],
    ['Pacote', d ? (d.hasPressure ? '20 bytes <small>(com barômetro)</small>' : '17 bytes') : '—'],
    ['Bateria', d ? (d.lowBattery ? '<span class="warn">Baixa</span>' : '<span class="ok">OK</span>') : '—'],
    ['Último pacote', s.lastT !== null ? `${fmtTime(new Date(s.lastT))} <small>· há ${fmtDuration(age)}</small>` : '—'],
    ['Intervalo', s.intervals.length ? `${fmtNum(s.intervals[s.intervals.length - 1] / 1000, 1)} s <small>· média ${fmtNum(avg / 1000, 1)} s</small>` : `— <small>· esperado ${PERIOD_S} s</small>`],
    ['Pacotes válidos', String(s.ok), 'sep'],
    ['Erros de CRC', s.crc ? `<span class="err">${s.crc}</span>` : '0'],
    ['Erros de checksum', s.sum ? `<span class="err">${s.sum}</span>` : '0'],
    ['Perdidos (estimado)', s.missed ? `<span class="warn">${s.missed}</span>` : '0'],
    ['Bytes descartados', s.junk ? `<span class="warn">${s.junk}</span>` : '0'],
    ['Sessão', `${fmtTime(new Date(s.since))} <small>· ${fmtDuration(now - s.since)}</small>`],
  ];
  $('stInfo').innerHTML = `<dl class="kv">${rows.map(([k, v, c]) => `<dt${c ? ` class="${c}"` : ''}>${k}</dt><dd${c ? ` class="${c}"` : ''}>${v}</dd>`).join('')}</dl>`;

  const bar = $('stNext');
  const period = ctx.sim ? ctx.sim.every * 1000 : PERIOD_S * 1000;
  bar.classList.toggle('idle', !live || age === null);
  bar.classList.toggle('late', age !== null && age > period * 1.25);
  if (live && age !== null) bar.firstElementChild.style.width = Math.min(100, ((age + 1000) / period) * 100) + '%';
  $('dashAge').textContent = s.lastT !== null ? `Atualizado às ${fmtTime(new Date(s.lastT))} · há ${fmtDuration(age)}` : '';
  renderRecInfo();
}
function resetNextBar() {
  const i = $('stNext').firstElementChild;
  i.style.transition = 'none';
  i.style.width = '0%';
  void i.offsetWidth;
  i.style.transition = '';
}
function flashPill() {
  const p = $('portPill');
  p.classList.remove('rx');
  void p.offsetWidth;
  p.classList.add('rx');
}

/* ------------------------------------------------------------------ */
/* Tabela e Texto */
const tableOpts = () => ({ hex: $('tblHex').checked, onlyErr: $('tblOnlyErr').checked, pressure: ctx.records.some((r) => r.dec?.hasPressure) });
function renderTableNow() { renderTable(ctx.records, tableOpts()); ctx.tableDirty = false; }
const textOpts = () => ({ time: $('txtTime').checked, hex: $('txtHex').checked, detail: $('txtDetail').checked });
function renderTextAll() {
  txt.clear();
  const o = textOpts();
  for (const r of ctx.records) txt.append(textFor(r, o), textClass(r), { silent: true });
}

/* ------------------------------------------------------------------ */
/* Gravação de medições */
const recFmt = () => $('recFmt').querySelector('.on').dataset.fmt;
function factorsText(f = ctx.factors) {
  const custom = Object.keys(DEFAULT_FACTORS).some((k) => f[k] !== DEFAULT_FACTORS[k]);
  const br = (x) => String(x).replace('.', ',');
  return `vento ${br(f.wind)} m/s (÷8) · rajada ${br(f.gust)} m/s · curva do coletor ${f.curve ? 'ligada' : 'desligada'} · chuva ${br(f.rain)} mm · luz ${br(f.light)} lux${custom ? ' (PERSONALIZADOS)' : ' (padrão do firmware do coletor)'}`;
}
function recMeta(fmt, style) {
  const now = new Date();
  return {
    'Registro de medições': 'estação meteorológica WH24C (RS-485)',
    Software: `WS Monitor v${APP_VERSION}`,
    'Início': `${isoLocal(now)} (UTC${tzOffset(now)})`,
    'Porta serial': link.isOpen ? `${link.portLabel()} · ${link.baud} bps 8N1` : 'não conectada no início',
    Operador: $('recOperator').value.trim(),
    'Equipamento / nº de série': $('recDevice').value.trim(),
    'Observações': $('recNotes').value.trim(),
    'Fatores de conversão': factorsText(),
    'Validação': 'CRC-8 (polinômio 0x31) dos bytes 0 a 14 e checksum (soma) dos bytes 0 a 15',
    'Pacotes com erro': $('recInvalid').checked ? 'incluídos (coluna status)' : 'não incluídos',
    'Padrão do CSV': fmt === 'csv' ? CSV_STYLES[style].label : undefined,
  };
}
async function startRec() {
  const fmt = recFmt();
  const style = $('recStyle').value;
  const meta = recMeta(fmt, style);
  let header;
  if (fmt === 'csv') {
    header = ($('recHeader').checked ? metaLines(meta).map((l) => '# ' + l).join('\r\n') + '\r\n' : '') + csvHeader(style);
  } else {
    header = `WS Monitor - registro de medições da estação WH24C\r\n${'='.repeat(48)}\r\n${metaLines(meta).join('\r\n')}\r\n${'-'.repeat(48)}\r\n` +
      'Uma linha por pacote: data/hora, sequência, status, ID e valores; após "|", o pacote bruto em hexadecimal.\r\n\r\n';
  }
  const slug = $('recDevice').value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const name = `wh24c_${slug ? slug + '_' : ''}${stampForFile()}.${fmt}`;
  try {
    await recorder.start({ format: fmt, suggestedName: name, header });
  } catch (e) {
    if (e?.name === 'AbortError') return;
    log.line('Não foi possível criar o arquivo de gravação: ' + (e?.message || e), 'e');
    return;
  }
  ctx.recOpts = { fmt, style, includeInvalid: $('recInvalid').checked, header: $('recHeader').checked, meta };
  ctx.recStats = newRecStats();
  log.line(`Gravação iniciada: ${recorder.name} (${fmt.toUpperCase()}${fmt === 'csv' ? ', ' + CSV_STYLES[style].label : ''}${Recorder.direct ? '' : ', será baixado ao parar'}). Fatores: ${factorsText()}.`, 's');
  renderRec();
}
async function stopRec() {
  const fmt = ctx.recOpts.fmt;
  const end = `Fim: ${isoLocal()} · ${recorder.rows} pacote(s) gravado(s)`;
  const trailer = fmt === 'txt' ? `\r\n${end}\r\n` : ctx.recOpts.header ? `# ${end}\r\n` : '';
  $('recStop').disabled = true;
  try {
    const hash = await recorder.stop(trailer);
    ctx.recStats.end = recorder.stoppedAt;
    log.line(`Gravação encerrada: ${recorder.name} · ${recorder.rows} pacote(s) · ${fmtBytes(recorder.size)} · SHA-256 ${hash}`, 's');
  } catch (e) {
    log.line('Erro ao encerrar a gravação: ' + (e?.message || e), 'e');
  } finally {
    $('recStop').disabled = false;
    renderRec();
  }
}
function renderRec() {
  const on = recorder.active;
  $('recStart').classList.toggle('hide', on);
  $('recStop').classList.toggle('hide', !on);
  $('recReport').classList.toggle('hide', on || !recorder.hash || !ctx.recStats);
  $('recPill').classList.toggle('hide', !on);
  $('recCard').classList.toggle('recording', on);
  const tag = $('recTag');
  tag.className = on ? 'tag rec' : recorder.hash ? 'tag ok' : 'tag';
  tag.textContent = on ? 'Gravando' : recorder.hash ? 'Concluída' : 'Parada';
  for (const n of document.querySelectorAll('[data-reclock]')) n.disabled = on;
  for (const b of $('recFmt').querySelectorAll('button')) b.disabled = on;
  renderRecInfo();
}
function renderRecInfo() {
  const box = $('recInfo');
  if (!recorder.name) { box.innerHTML = ''; return; }
  const on = recorder.active;
  const end = on ? Date.now() : recorder.stoppedAt;
  const rows = [
    ['Arquivo', `<span class="mono">${escapeHtml(recorder.name)}</span>`],
    ['Início', fmtDateTime(new Date(recorder.startedAt))],
    ['Duração', fmtDuration(end - recorder.startedAt)],
    ['Pacotes gravados', String(recorder.rows)],
    ['Tamanho', fmtBytes(recorder.size)],
  ];
  let html = `<div class="recbox"><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  if (!on && recorder.hash) html += `<div class="hash" title="SHA-256 do arquivo gravado: confira depois com Get-FileHash (Windows) para provar que o arquivo não foi alterado"><code>SHA-256 ${recorder.hash}</code><button class="btn ghost sm" id="recHashCopy" type="button">Copiar</button></div>`;
  html += '</div>';
  if (recorder.error) html += `<p class="note err">Erro ao gravar no arquivo: ${escapeHtml(recorder.error.message || recorder.error)}. Pare e inicie uma nova gravação.</p>`;
  if (on && !Recorder.direct) html += '<p class="note warn">Este navegador não grava direto no disco: o arquivo será baixado ao parar.</p>';
  if (box.dataset.html === html) return;
  box.dataset.html = html;
  box.innerHTML = html;
  $('recHashCopy')?.addEventListener('click', (e) => copyText(recorder.hash, e.currentTarget));
}
function renderRecFmt() {
  const csv = recFmt() === 'csv';
  $('recStyleRow').classList.toggle('hide', !csv);
  $('recHeaderRow').classList.toggle('hide', !csv);
}

/* ------------------------------------------------------------------ */
/* Relatório do monitoramento: estatística dos pacotes recebidos durante a gravação */
function newRecStats() {
  return {
    start: Date.now(), end: null, ok: 0, crc: 0, sum: 0, junk: 0, missed: 0, alerted: 0, lowBat: 0,
    firstT: null, lastT: null, intSum: 0, intN: 0, ids: new Set(), rainPrev: null, rainCounts: 0, rainMm: 0,
    nonSerial: 0, factorChanges: [],
    f: Object.fromEntries(FIELDS.map((fd) => [fd.key, { n: 0, inv: 0, warn: 0, min: Infinity, max: -Infinity, sum: 0, sx: 0, cy: 0 }])),
  };
}
function trackRec(r) {
  const R = ctx.recStats;
  if (!R) return;
  /* Pacotes do simulador ou digitados no Desenvolvedor vão para o arquivo (coluna origem), mas não
     entram na estatística do relatório: ela descreve só a estação ligada na porta serial. */
  if (r.source !== 'serial') { R.nonSerial++; return; }
  R[r.status]++;
  if (!r.accepted) return;
  const d = r.dec;
  if (R.lastT !== null) {
    const dt = r.t - R.lastT;
    R.intSum += dt;
    R.intN++;
    if (r.source === 'serial' && dt > PERIOD_S * 1500) R.missed += Math.round(dt / (PERIOD_S * 1000)) - 1;
  }
  if (R.firstT === null) R.firstT = r.t;
  R.lastT = r.t;
  R.ids.add(d.id);
  if (d.lowBattery) R.lowBat++;
  if (r.alerts.length) R.alerted++;
  /* Chuva: soma as basculadas pacote a pacote. Contador menor que o anterior = volta do contador
     (perto de 65535) ou estação reiniciada (contador recomeça do zero). */
  const c = d.raw.rain;
  if (R.rainPrev !== null) {
    const inc = c >= R.rainPrev ? c - R.rainPrev : R.rainPrev > 0xff00 ? c + 0x10000 - R.rainPrev : c;
    R.rainCounts += inc;
    R.rainMm += inc * r.factors.rain;  // fator vigente em cada pacote
  }
  R.rainPrev = c;
  for (const fd of FIELDS) {
    const a = r.asm[fd.key], v = d.values[fd.key], S = R.f[fd.key];
    if (a.st === 'none') continue;
    if (a.st === 'err' || v === null) { S.inv++; continue; }
    if (a.st === 'warn') S.warn++;
    S.n++;
    S.sum += v;
    S.min = Math.min(S.min, v);
    S.max = Math.max(S.max, v);
    if (fd.key === 'dir') { S.sx += Math.sin((v * Math.PI) / 180); S.cy += Math.cos((v * Math.PI) / 180); }
  }
}
function buildReport() {
  const R = ctx.recStats, o = ctx.recOpts, m = o.meta;
  const L = [];
  const line = (k, v) => L.push(`  ${(k + ' ').padEnd(34, '.')} ${v}`);
  const n = (v, dec) => fmtNum(v, dec);
  const dt = (t) => (t ? `${isoLocal(new Date(t))} (UTC${tzOffset(new Date(t))})` : '—');
  L.push('WS Monitor - relatório de monitoramento da estação WH24C', '='.repeat(60), '');
  L.push('IDENTIFICAÇÃO');
  line('Operador', m.Operador || '—');
  line('Equipamento / nº de série', m['Equipamento / nº de série'] || '—');
  line('Observações', m['Observações'] || '—');
  line('ID da estação (security code)', R.ids.size ? [...R.ids].map(hex2).join(', ') + (R.ids.size > 1 ? '  (a estação reiniciou ou há mais de uma na linha)' : '') : '—');
  L.push('', 'PERÍODO');
  line('Início', dt(R.start));
  line('Fim', dt(R.end));
  line('Duração', fmtDuration((R.end ?? Date.now()) - R.start));
  line('Primeiro / último pacote válido', R.firstT ? `${fmtTime(new Date(R.firstT))} / ${fmtTime(new Date(R.lastT))}` : '—');
  L.push('', 'ARQUIVO DE MEDIÇÕES');
  line('Nome', recorder.name);
  line('Formato', o.fmt === 'csv' ? `CSV, ${CSV_STYLES[o.style].label}` : 'TXT');
  line('Pacotes gravados', `${recorder.rows}${o.includeInvalid ? ' (inclui os com erro)' : ' (só válidos)'}`);
  line('Tamanho', fmtBytes(recorder.size));
  line('SHA-256', recorder.hash);
  L.push('', 'COMUNICAÇÃO');
  line('Pacotes válidos', String(R.ok));
  line('Erros de CRC / checksum', `${R.crc} / ${R.sum}`);
  line('Perdidos (estimado)', String(R.missed));
  line('Bytes descartados', String(R.junk));
  line('Intervalo médio entre pacotes', R.intN ? `${n(R.intSum / R.intN / 1000, 1)} s (esperado ${PERIOD_S} s)` : '—');
  line('Pacotes com alerta', String(R.alerted));
  line('Simulados/manuais (fora da estat.)', R.nonSerial ? `${R.nonSerial} (marcados na coluna origem do arquivo)` : '0');
  line('Bateria baixa', R.lowBat ? `SIM, em ${R.lowBat} pacote(s)` : 'não');
  L.push('', 'MEDIÇÕES (pacotes válidos)');
  L.push(`  ${'Grandeza'.padEnd(26)}${'Unid.'.padEnd(7)}${'N'.padStart(6)}${'Mínimo'.padStart(12)}${'Máximo'.padStart(12)}${'Média'.padStart(12)}${'Inválidos'.padStart(11)}${'Fora faixa'.padStart(12)}`);
  const row = (label, unit, S, dec, mult = 1, mean = null) => L.push(`  ${label.padEnd(26)}${unit.padEnd(7)}${String(S.n).padStart(6)}` +
    `${(S.n ? n(S.min * mult, dec) : '—').padStart(12)}${(S.n ? n(S.max * mult, dec) : '—').padStart(12)}${(S.n ? (mean ?? n((S.sum / S.n) * mult, dec)) : '—').padStart(12)}${String(S.inv).padStart(11)}${String(S.warn).padStart(12)}`);
  for (const fd of FIELDS) {
    const S = R.f[fd.key];
    if (fd.key === 'pressure' && !S.n && !S.inv) continue;
    if (fd.key === 'dir') {
      const deg = S.n ? ((Math.atan2(S.sx, S.cy) * 180) / Math.PI + 360) % 360 : null;
      row(fd.label, '°', S, 0, 1, deg === null ? '—' : `${n(deg, 0)} ${cardinal(deg)}`);
      continue;
    }
    if (fd.key === 'rain') { row('Chuva (acumulado est.)', 'mm', S, 1, 1, '—'); continue; }
    row(fd.label, fd.unit || '—', S, fd.dec);
    if (fd.key === 'wind' || fd.key === 'gust') row(`${fd.key === 'wind' ? 'Vento' : 'Rajada'} em km/h`, 'km/h', S, 1, 3.6);
  }
  L.push('  Direção: média vetorial. Chuva: o acumulado vem do contador da estação; veja a chuva no período abaixo.');
  line('Chuva no período', `+${n(R.rainMm, 1)} mm (${R.rainCounts} basculada${R.rainCounts === 1 ? '' : 's'})`);
  L.push('', 'CONFIGURAÇÃO');
  line('Software', m.Software);
  line('Porta serial', m['Porta serial']);
  line('Fatores de conversão', m['Fatores de conversão'] + (R.factorChanges.length ? ' (no início)' : ''));
  for (const fc of R.factorChanges) line('Fatores alterados', `${isoLocal(new Date(fc.t))}: ${fc.text}`);
  line('Validação', m['Validação']);
  L.push('', `Relatório gerado em ${dt(Date.now())}.`, '', '', 'Responsável: ______________________________    Data: ____/____/________', '');
  return L.join('\r\n');
}
/* Salva um texto onde o técnico escolher (ou baixa, se o navegador não tiver o "Salvar como") */
async function saveTextFile(text, name) {
  if (typeof window.showSaveFilePicker !== 'function') { downloadText(text, name); return name; }
  const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Texto', accept: { 'text/plain': ['.txt'] } }] });
  const w = await h.createWritable();
  await w.write('\ufeff' + text);
  await w.close();
  return h.name;
}
async function saveReport() {
  if (!ctx.recStats || !recorder.hash) return;
  try {
    const name = await saveTextFile(buildReport(), recorder.name.replace(/\.(csv|txt)$/i, '') + '_relatorio.txt');
    log.line(`Relatório do monitoramento salvo: ${name}`, 's');
  } catch (e) {
    if (e?.name !== 'AbortError') log.line('Não foi possível salvar o relatório: ' + (e?.message || e), 'e');
  }
}

/* ------------------------------------------------------------------ */
/* Conexão */
function friendlyError(e) {
  const m = e?.message || String(e);
  if (e?.name === 'InvalidStateError' || e?.name === 'NetworkError' || /Failed to open/i.test(m)) return 'a porta está em uso por outro programa (terminal, script Python…) ou foi desconectada. Feche o outro programa e tente de novo.';
  if (e?.name === 'SecurityError') return 'acesso à porta negado pelo navegador.';
  return m;
}
async function connect() {
  try {
    await link.open(baud(), onSerialData);
    ctx.liveSince = Date.now();
    splitter.reset();
    log.line(`Porta aberta: ${link.portLabel()} · ${baud()} bps, 8N1. Aguardando pacotes (a cada ${PERIOD_S} s).`, 's');
  } catch (e) {
    if (e?.name === 'NotFoundError') return;  // seletor fechado sem escolher
    log.line('Não foi possível abrir a porta: ' + friendlyError(e), 'e');
  }
  renderConn();
}
async function disconnect() {
  splitter.flush();
  await link.close();
  log.line('Porta fechada.', 's');
  renderConn();
}
async function choosePortManual() {
  const wasOpen = link.isOpen;
  try {
    await link.choosePort(true);
  } catch (e) {
    if (e?.name !== 'NotFoundError') log.line('Erro ao escolher a porta: ' + friendlyError(e), 'e');
    return;
  }
  log.line(`Porta escolhida: ${link.portLabel()}`, 's');
  if (wasOpen) await connect();
  renderConn();
}
function renderConn() {
  const pill = $('portPill');
  const open = link.isOpen;
  const label = link.portLabel();
  pill.className = 'pill' + (open ? (ctx.stats?.lastT !== null ? ' live' : ' wait') : '');
  if (open) pill.innerHTML = `<i></i><b>${escapeHtml(label)}</b> · ${link.baud} bps`;
  else if (label) pill.innerHTML = `<i></i><b>${escapeHtml(label)}</b> · pronta`;
  else pill.innerHTML = '<i></i>Nenhuma porta selecionada';
  pill.title = 'Escolher outra porta serial';
  pill.disabled = !link.supported;
  $('btnConnect').classList.toggle('hide', open);
  $('btnConnect').disabled = !link.supported;
  $('btnDisconnect').classList.toggle('hide', !open);
  $('simPill').classList.toggle('hide', !ctx.sim);
  renderStation();
}

/* ------------------------------------------------------------------ */
/* Modos de exibição e menu lateral */
const TABS = ['dash', 'table', 'text', 'ref', 'dev'];
const TAB_TITLES = { dash: 'Dashboard', table: 'Tabela', text: 'Texto', ref: 'Referência', dev: 'Desenvolvedor' };
function closeNav() { $('tabs').classList.remove('open'); $('scrim').classList.remove('on'); }
function toggleNav() { const o = !$('tabs').classList.contains('open'); $('tabs').classList.toggle('open', o); $('scrim').classList.toggle('on', o); }
const devUnlocked = () => { try { return sessionStorage.getItem('wsmonitor.dev') === '1'; } catch { return ctx.devUnlocked === true; } };
function setDevUnlocked(on) {
  ctx.devUnlocked = on;
  try { if (on) sessionStorage.setItem('wsmonitor.dev', '1'); else sessionStorage.removeItem('wsmonitor.dev'); } catch { /* sem armazenamento */ }
}
/* Modo Desenvolvedor protegido por senha (vale até fechar o app) */
async function unlockDev() {
  if (devUnlocked()) return true;
  const ok = await passwordDialog({
    title: 'Modo Desenvolvedor',
    html: 'Digite a senha para acessar as configurações avançadas.',
    check: async (pw) => (await sha256Hex(new TextEncoder().encode(pw))) === DEV_PASSWORD_SHA256,
  });
  if (ok) { setDevUnlocked(true); log.line('Modo Desenvolvedor desbloqueado.', 's'); }
  return ok;
}
async function setTab(t) {
  if (!TABS.includes(t)) return;
  if (t === 'dev' && !(await unlockDev())) return;
  ctx.tab = t;
  store.set('tab', t);
  document.body.dataset.tab = t;
  $('modeTitle').textContent = TAB_TITLES[t];
  closeNav();
  for (const b of document.querySelectorAll('#tabs [data-tab], #viewSwitch [data-tab]')) {
    b.classList.toggle('on', b.dataset.tab === t);
    if (b.closest('#viewSwitch')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  }
  for (const p of document.querySelectorAll('main .panel')) p.classList.toggle('on', p.id === 'panel-' + t);
  if (t === 'table' && ctx.tableDirty) renderTableNow();
  if (t === 'dash') dash.redraw();
  if (t === 'ref') renderRef();
  if (ctx.started) history.replaceState(null, '', '#' + t);
}

/* ------------------------------------------------------------------ */
/* Referência: especificações e mapa do pacote (com os fatores em uso) */
function renderRef() {
  const range = (r, u) => (r ? `${fmtNum(r[0], 0)} a ${fmtNum(r[1], 0)} ${u}`.trim() : '—');
  $('refSpecs').innerHTML = '<thead><tr><th>Grandeza</th><th>Faixa de medição</th><th>Faixa do protocolo</th><th>Exatidão</th><th>Resolução</th><th>Inválido</th></tr></thead><tbody>' +
    FIELDS.map((f) => `<tr><td>${f.label}</td><td>${range(f.spec, f.unit)}</td><td>${range(f.proto, f.unit)}</td><td>${f.acc}</td><td>${f.res}</td><td class="mono">${f.invalid}</td></tr>`).join('') + '</tbody>';
  const F = ctx.factors;
  const rows = [
    ['0', 'Family code', 'sempre 0x24'],
    ['1', 'Security code (ID)', 'muda quando a estação reinicia'],
    ['2 + 3.b7', 'Direção do vento (9 bits)', 'graus, 0 a 359'],
    ['3.b6-b5', 'Bits fixos', 'sempre 11'],
    ['3.b4 + 6', 'Velocidade do vento (9 bits)', `bruto ÷ 8 × ${F.wind} m/s${F.curve ? '; curva do coletor até 14,5 km/h e limite de 50 m/s' : ''}`],
    ['3.b3', 'Bateria baixa', '1 = baixa'],
    ['3.b2-b0 + 4', 'Temperatura (11 bits)', '(bruto − 400) ÷ 10 °C · ex.: 0x1F9 = 10,5 °C; 0x127 = −10,5 °C'],
    ['5', 'Umidade relativa', '%'],
    ['7', 'Rajada', `bruto × ${F.gust} m/s${F.curve ? '; mesma curva do vento' : ''}`],
    ['8-9', 'Contador de chuva', `contagens × ${F.rain} mm (acumulado desde que a estação ligou)`],
    ['10-11', 'UV', 'valor bruto, 0 a 20000 (índice UV de 0 a 15 pela tabela do firmware do coletor)'],
    ['12-14', 'Luminosidade', `bruto × ${F.light} lux`],
    ['15', 'CRC-8', 'polinômio 0x31, valor inicial 0, bytes 0 a 14'],
    ['16', 'Checksum', 'soma dos bytes 0 a 15, sem o vai-um'],
    ['17-19', 'Pressão (opcional)', 'bruto ÷ 100 hPa · ex.: 0x018A9E = 1010,22 hPa'],
  ];
  $('refProto').innerHTML = '<thead><tr><th>Byte</th><th>Campo</th><th>Conversão</th></tr></thead><tbody>' +
    rows.map(([b, c, v]) => `<tr><td class="mono">${b}</td><td>${c}</td><td>${v}</td></tr>`).join('') + '</tbody>';
}

/* ------------------------------------------------------------------ */
/* Modo Desenvolvedor */
const FACTOR_FIELDS = [
  ['wind', 'Vento (m/s por contagem ÷ 8)'],
  ['gust', 'Rajada (m/s por contagem)'],
  ['rain', 'Chuva (mm por basculada)'],
  ['light', 'Luminosidade (lux por contagem)'],
];
function renderDevForms() {
  $('dvFactors').replaceChildren(...FACTOR_FIELDS.map(([k, label]) => el('label', {}, label, el('span', { class: 'inp' }, el('input', { id: 'dvF_' + k, type: 'number', step: 'any', min: '0', value: String(ctx.factors[k]) })))));
  $('dvCurve').checked = ctx.factors.curve;
  $('dvFactorsTag').classList.toggle('hide', !Object.keys(DEFAULT_FACTORS).some((k) => ctx.factors[k] !== DEFAULT_FACTORS[k]));
  $('dvGap').value = ctx.rx.gapMs;
  $('dvAcceptSum').checked = ctx.rx.acceptBadSum;
  $('dvLogChunks').checked = ctx.rx.logChunks;
}
function saveFactors(reset = false) {
  const next = { ...DEFAULT_FACTORS };
  if (!reset) {
    for (const [k] of FACTOR_FIELDS) {
      const inp = $('dvF_' + k);
      const v = Number(inp.value);
      const bad = !(v > 0 && v < 1e6);
      inp.parentElement.classList.toggle('bad', bad);
      if (bad) { $('dvFactorsMsg').className = 'note err'; $('dvFactorsMsg').textContent = 'Use números maiores que zero.'; return; }
      next[k] = v;
    }
    next.curve = $('dvCurve').checked;
  }
  ctx.factors = next;
  if (reset) store.del('factors'); else store.set('factors', next);
  renderDevForms();
  $('dvFactorsMsg').className = 'note ok';
  $('dvFactorsMsg').textContent = 'Salvo. Vale para os próximos pacotes (os já recebidos não são recalculados).';
  log.line(`Fatores de conversão ${reset ? 'restaurados' : 'alterados'}: ${factorsText()}`, 'w');
  if (recorder.active && ctx.recStats) ctx.recStats.factorChanges.push({ t: Date.now(), text: factorsText() });
  if (recorder.active) recorder.append(ctx.recOpts.fmt === 'csv' ? (ctx.recOpts.header ? `# ${isoLocal()} fatores alterados: ${factorsText()}\r\n` : '') : `${isoLocal()} FATORES ALTERADOS: ${factorsText()}\r\n`, { row: false });
}
function saveRx(reset = false) {
  const gap = reset ? DEFAULT_RX.gapMs : Math.round(Number($('dvGap').value));
  if (!(gap >= 10 && gap <= 2000)) { $('dvRxMsg').className = 'note err'; $('dvRxMsg').textContent = 'Silêncio entre 10 e 2000 ms.'; return; }
  ctx.rx = reset ? { ...DEFAULT_RX } : { gapMs: gap, acceptBadSum: $('dvAcceptSum').checked, logChunks: $('dvLogChunks').checked };
  if (reset) store.del('rx'); else store.set('rx', ctx.rx);
  splitter.gapMs = ctx.rx.gapMs;
  renderDevForms();
  $('dvRxMsg').className = 'note ok';
  $('dvRxMsg').textContent = 'Salvo.';
  log.line(`Recepção: silêncio ${ctx.rx.gapMs} ms · checksum errado ${ctx.rx.acceptBadSum ? 'ACEITO' : 'recusado'} · blocos no log ${ctx.rx.logChunks ? 'sim' : 'não'}`, 'w');
}
/* Exemplo: o pacote que o simulador em Python (weather.py) envia, com chuva de 7,5 mm. O script
   recalcula só o CRC e mantém o checksum fixo em 0x2C. */
function examplePacket() {
  const b = Uint8Array.from([0x24, 0xfa, 0x53, 0x62, 0x8a, 0x45, 0, 0, 0, 0x19, 0, 0x02, 0, 0, 0, 0, 0x2c]);
  b[15] = crc8(b, 0, 15);
  return b;
}
function devDecode() {
  const bytes = parseHexBytes($('dvHex').value);
  const out = $('dvOut');
  if (!bytes) { out.textContent = 'Hexadecimal inválido: use pares de dígitos (ex.: 24 FA 53 …).'; return null; }
  const lines = [];
  for (const part of splitBurst(bytes)) {
    if (part.kind === 'junk') { lines.push(`Bytes que não formam um pacote (${part.bytes.length}): ${toHex(part.bytes)}`, ''); continue; }
    const check = checkFrame(part.bytes);
    const status = check.crcOk ? (check.sumOk ? 'ok' : 'sum') : 'crc';
    const dec = check.crcOk ? decode(part.bytes, ctx.factors) : null;
    const asm = dec ? assess(dec) : null;
    const alerts = asm ? FIELDS.filter((f) => ['warn', 'err'].includes(asm[f.key].st)).map((f) => `${f.label} ${asm[f.key].msg}`) : [];
    lines.push(...detailLines({ seq: '-', t: Date.now(), source: 'manual', bytes: part.bytes, hex: toHex(part.bytes), check, status, dec, asm, alerts }), '');
  }
  if (bytes.length >= 16 && bytes[0] === 0x24) lines.push(`Para corrigir: CRC esperado ${hex2(crc8(bytes, 0, 15))} no byte 15; checksum esperado ${hex2(sum8(Uint8Array.from([...bytes.slice(0, 15), crc8(bytes, 0, 15)]), 0, 16))} no byte 16 (com o CRC corrigido).`);
  out.textContent = lines.join('\n');
  return bytes;
}

/* Simulador: valores com variação lenta, para testar a interface e a gravação sem a estação */
function simStart() {
  const every = Number($('simEvery').value) || PERIOD_S;
  const st = { id: (Math.random() * 255) | 0, dir: 120, temp: 24.5, hum: 62, wind: 2.4, gust: 4, rain: 30, uv: 900, light: 42000, pressure: 1012.4, n: 0 };
  const tick = () => {
    const jit = (x, a, lo, hi) => Math.max(lo, Math.min(hi, x + (Math.random() - 0.5) * a));
    st.dir = (st.dir + (Math.random() - 0.5) * 40 + 360) % 360;
    st.temp = jit(st.temp, 0.4, -5, 45);
    st.hum = jit(st.hum, 2, 15, 98);
    st.wind = jit(st.wind, 0.8, 0, 14);
    st.gust = Math.max(st.wind, jit(st.gust, 1.6, 0, 20));
    if (Math.random() < 0.25) st.rain += 0.3;
    st.uv = jit(st.uv, 150, 0, 6000);
    st.light = jit(st.light, 4000, 0, 120000);
    st.pressure = jit(st.pressure, 0.3, 980, 1040);
    st.n++;
    const raw = rawFromValues({ ...st, pressure: $('simPressure').checked ? st.pressure : null, lowBattery: false }, ctx.factors);
    const b = encodeRaw(raw);
    if ($('simErrors').checked && st.n % 8 === 0) b[st.n % 16 === 0 ? 16 : 6] ^= 0x10;
    handleBurst(b, Date.now(), 'sim');
  };
  ctx.sim = { every, timer: setInterval(tick, every * 1000) };
  ctx.liveSince = Date.now();
  log.line(`Simulador iniciado (um pacote a cada ${every} s, ID ${hex2(st.id)}).`, 'w');
  tick();
  renderSim();
}
function simStop() {
  if (!ctx.sim) return;
  clearInterval(ctx.sim.timer);
  ctx.sim = null;
  log.line('Simulador parado.', 'w');
  renderSim();
}
function renderSim() {
  $('simStart').classList.toggle('hide', !!ctx.sim);
  $('simStop').classList.toggle('hide', !ctx.sim);
  $('simTag').classList.toggle('hide', !ctx.sim);
  $('simEvery').disabled = !!ctx.sim;
  renderConn();
}

/* ------------------------------------------------------------------ */
function renderLogStatus() {
  const off = sink.ok === false;
  const kb = Math.ceil(sink.pending / 1024);
  for (const n of document.querySelectorAll('.logstat')) {
    n.classList.toggle('off', off);
    n.innerHTML = off ? `<i></i>Pasta log/ indisponível${kb ? ` · ${kb} KB pendente(s)` : ''}` : '<i></i>Salvo em log/';
    n.title = off ? 'Servidor local parado: o texto fica guardado neste computador e é gravado em log/ quando o servidor voltar. Abra o app pelo atalho "WS Monitor".' : 'log/AAAA-MM-DD_log-tecnico.txt na pasta do WS Monitor';
  }
}

let dash;
function bind() {
  $('baud').replaceChildren(...BAUD_RATES.map((b) => el('option', { value: b, text: String(b) })));
  $('baud').value = String(store.get('baud', DEFAULT_BAUD));
  $('baud').addEventListener('change', async () => {
    store.set('baud', baud());
    log.line(`Baudrate: ${baud()} bps${baud() !== DEFAULT_BAUD ? ' (o padrão da WH24C é 9600)' : ''}`, baud() !== DEFAULT_BAUD ? 'w' : 's');
    if (link.isOpen) await connect();
  });
  for (const b of document.querySelectorAll('#tabs [data-tab], #viewSwitch [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('btnConnect').addEventListener('click', connect);
  $('btnDisconnect').addEventListener('click', disconnect);
  $('portPill').addEventListener('click', choosePortManual);
  $('navToggle').addEventListener('click', toggleNav);
  $('scrim').addEventListener('click', closeNav);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });

  link.addEventListener('change', renderConn);
  link.addEventListener('lost', () => {
    splitter.flush();
    log.line(`Conversor USB desconectado. ${link.wantOpen ? 'Reconecte o cabo: a porta volta a abrir sozinha.' : ''}`, 'e');
    renderConn();
  });
  link.addEventListener('reconnected', () => { ctx.liveSince = Date.now(); log.line(`Conversor reconectado: porta aberta de novo (${link.portLabel()} · ${link.baud} bps).`, 'i'); renderConn(); });
  link.addEventListener('reconnectfail', (e) => log.line('Conversor reconectado, mas a porta não abriu: ' + friendlyError(e.detail) + ' Clique em Conectar.', 'e'));
  link.addEventListener('readerror', (e) => {
    ctx.stats.readErrors++;
    if (ctx.stats.readErrors <= 5) log.line(`Erro de leitura na serial (${e.detail?.name || 'erro'}: ${e.detail?.message || ''}). Ruído na linha ou baudrate errado.${ctx.stats.readErrors === 5 ? ' Próximos erros não serão registrados.' : ''}`, 'w');
  });
  sink.addEventListener('change', renderLogStatus);

  $('stReset').addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Nova sessão', html: 'Zera os contadores, os mínimos e máximos, as mini-séries, a referência da chuva e limpa a Tabela e o Texto. A gravação em andamento e o log técnico continuam.', ok: 'Zerar' }))) return;
    newSession();
    log.line('Nova sessão: contadores zerados.', 's');
  });

  /* Gravação */
  $('recStyle').replaceChildren(...Object.entries(CSV_STYLES).map(([k, s]) => el('option', { value: k, text: s.label })));
  $('recStyle').value = store.get('recStyle', 'br');
  const fmt0 = store.get('recFmt', 'csv');
  for (const b of $('recFmt').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.fmt === fmt0);
    b.addEventListener('click', () => {
      for (const x of $('recFmt').querySelectorAll('button')) x.classList.toggle('on', x === b);
      store.set('recFmt', b.dataset.fmt);
      renderRecFmt();
    });
  }
  for (const id of ['recOperator', 'recDevice']) {
    $(id).value = store.get(id, '');
    $(id).addEventListener('change', () => store.set(id, $(id).value.trim()));
  }
  for (const id of ['recInvalid', 'recHeader']) {
    $(id).checked = store.get(id, true);
    $(id).addEventListener('change', () => store.set(id, $(id).checked));
  }
  $('recStyle').addEventListener('change', () => store.set('recStyle', $('recStyle').value));
  $('recStart').addEventListener('click', startRec);
  $('recStop').addEventListener('click', stopRec);
  $('recReport').addEventListener('click', saveReport);
  $('recPill').addEventListener('click', async () => {
    if (['ref', 'dev'].includes(ctx.tab)) await setTab('dash');
    expandCard($('recCard'));
    $('recCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  recorder.addEventListener('change', renderRecInfo);
  recorder.addEventListener('error', (e) => log.line('Erro ao gravar no arquivo de medições: ' + (e.detail?.message || e.detail), 'e'));
  window.addEventListener('beforeunload', (e) => { if (recorder.active) { e.preventDefault(); e.returnValue = ''; } });

  /* Tabela e Texto */
  for (const id of ['tblHex', 'tblOnlyErr']) {
    $(id).checked = store.get(id, false);
    $(id).addEventListener('change', () => { store.set(id, $(id).checked); renderTableNow(); });
  }
  $('tblClear').addEventListener('click', () => { ctx.records = []; renderTableNow(); txt.clear(); });
  $('tblCsv').addEventListener('click', () => {
    const style = $('recStyle').value;
    if (!ctx.records.length) return;
    downloadText(csvHeader(style) + ctx.records.map((r) => csvRow(r, style)).join(''), `wh24c_tabela_${stampForFile()}.csv`, 'text/csv;charset=utf-8');
    log.line(`Tabela exportada em CSV (${ctx.records.length} pacotes).`, 's');
  });
  for (const id of ['txtTime', 'txtHex', 'txtDetail']) {
    $(id).checked = store.get(id, id === 'txtTime');
    $(id).addEventListener('change', () => { store.set(id, $(id).checked); renderTextAll(); });
  }
  $('txtClear').addEventListener('click', () => txt.clear());
  $('txtSave').addEventListener('click', () => downloadText(txt.text().replace(/\n/g, '\r\n'), `wh24c_texto_${stampForFile()}.txt`));
  $('logClear').addEventListener('click', (e) => { e.preventDefault(); log.clear(); });
  $('logSave').addEventListener('click', (e) => { e.preventDefault(); downloadText(log.text().replace(/\n/g, '\r\n'), `ws-monitor_log-tecnico_${stampForFile()}.txt`); });

  /* Desenvolvedor */
  $('devLock').addEventListener('click', () => { setDevUnlocked(false); log.line('Modo Desenvolvedor bloqueado.', 's'); setTab('dash'); });
  $('dvFactorsSave').addEventListener('click', () => saveFactors(false));
  $('dvFactorsReset').addEventListener('click', () => saveFactors(true));
  $('dvRxSave').addEventListener('click', () => saveRx(false));
  $('dvRxReset').addEventListener('click', () => saveRx(true));
  $('dvExample').addEventListener('click', () => { $('dvHex').value = toHex(examplePacket()); devDecode(); });
  $('dvDecode').addEventListener('click', devDecode);
  $('dvInject').addEventListener('click', () => { const b = devDecode(); if (b) handleBurst(b, Date.now(), 'manual'); });
  $('simStart').addEventListener('click', simStart);
  $('simStop').addEventListener('click', simStop);

  $('appVersion').textContent = APP_VERSION;
}

function main() {
  dash = new Dashboard($('tiles'), {
    onRainZero: () => {
      if (!ctx.last) return;
      ctx.rainRef = ctx.last.dec.raw.rain;
      dash.update(ctx.last, ctx.hist, ctx.mm, ctx.rainRef);
      log.line(`Referência da chuva zerada (contador ${ctx.rainRef}).`, 's');
    },
  });
  bind();
  newSession();
  renderDevForms();
  renderRecFmt();
  renderRec();
  renderSim();
  if (!link.supported) $('unsupported').classList.remove('hide');
  log.line(`===== WS Monitor v${APP_VERSION} · sessão iniciada em ${fmtDateTime()} =====`, 's');
  log.line(`Fatores de conversão: ${factorsText()}`, 's');
  if (!Recorder.direct) log.line('Este navegador não grava direto no disco: as gravações serão baixadas ao parar.', 'w');
  const hash = location.hash.slice(1);
  const t = TABS.includes(hash) ? hash : store.get('tab', 'dash');
  setTab(TABS.includes(t) && (t !== 'dev' || devUnlocked()) ? t : 'dash');
  initCollapsibleCards();
  renderLogStatus();
  renderConn();
  setInterval(renderStation, 1000);
  splashDone();
  ctx.started = true;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch((e) => log.line('Service worker: ' + e.message, 'w'));
}

main();
