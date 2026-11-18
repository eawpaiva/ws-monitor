/* Modos de exibição: Dashboard (cartões com mini-séries e rosa dos ventos), Tabela e Texto */
import { FIELD, cardinal } from './wh24c.js';
import { STATUS_LABEL, SOURCE_LABEL, compactLine, detailLines, statusDetail } from './format.js';
import { $, el, escapeHtml, fmtNum, fmtTime, hex2 } from './util.js';

const ICON = {
  ok: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M11 7h2v7h-2zm0 9h2v2h-2z"/></svg>',
  err: '<svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
};
const ST_TEXT = { ok: 'OK', warn: 'Fora da faixa', err: 'Inválido' };
export const statusTag = (st, title = '') => `<span class="tag ${st}"${title ? ` title="${escapeHtml(title)}"` : ''}>${ICON[st]}${ST_TEXT[st]}</span>`;

/* ---------------------------------------------------------------- tooltip único */
let tip = null;
function showTip(html, x, y) {
  if (!tip) { tip = el('div', { class: 'tip', role: 'tooltip' }); document.body.append(tip); }
  tip.innerHTML = html;
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideTip() { if (tip) tip.style.display = 'none'; }

/* ---------------------------------------------------------------- mini-série (sparkline) */
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

/* Uma série, sem eixo: linha fina na cor de apoio, último ponto em destaque. Passar o mouse mostra
   hora e valor de cada ponto (linha vertical + ponto + balão). Valores inválidos interrompem a linha. */
export function drawSpark(svg, pts, fmt) {
  const w = Math.max(60, Math.round(svg.getBoundingClientRect().width || 200));
  const h = 44, pad = 4;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.replaceChildren();
  svg._pts = [];
  const vals = pts.map((p) => p.v).filter((v) => v !== null);
  if (!vals.length) return;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const n = pts.length;
  const x = (i) => (n === 1 ? w - pad : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
  let d = '', pen = false;
  pts.forEach((p, i) => {
    if (p.v === null) { pen = false; return; }
    const px = x(i), py = y(p.v);
    d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
    pen = true;
    svg._pts.push({ x: px, y: py, t: p.t, v: p.v });
  });
  svg.append(svgEl('path', { d, class: 'ln' }));
  const last = svg._pts[svg._pts.length - 1];
  if (last && pts[n - 1].v !== null) svg.append(svgEl('circle', { cx: last.x, cy: last.y, r: 3.5, class: 'now' }));
  const cross = svgEl('line', { y1: 0, y2: h, class: 'cross' });
  const dot = svgEl('circle', { r: 3.5, class: 'hov' });
  cross.style.display = dot.style.display = 'none';
  svg.append(cross, dot);
  svg._hover = { cross, dot, fmt };
}
function bindSpark(svg) {
  const move = (e) => {
    const P = svg._pts;
    if (!P?.length) return;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const mx = ((e.clientX - r.left) / r.width) * vb.width;
    let best = P[0];
    for (const p of P) if (Math.abs(p.x - mx) < Math.abs(best.x - mx)) best = p;
    const { cross, dot, fmt } = svg._hover;
    cross.setAttribute('x1', best.x); cross.setAttribute('x2', best.x);
    dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y);
    cross.style.display = dot.style.display = '';
    showTip(`<span class="muted">${fmtTime(new Date(best.t))}</span> <b>${escapeHtml(fmt(best.v))}</b>`, r.left + (best.x / vb.width) * r.width, r.top);
  };
  const leave = () => {
    hideTip();
    if (svg._hover) svg._hover.cross.style.display = svg._hover.dot.style.display = 'none';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', leave);
}

/* ---------------------------------------------------------------- rosa dos ventos */
function compassSvg() {
  const s = svgEl('svg', { viewBox: '-60 -60 120 120', class: 'compass', role: 'img', 'aria-label': 'Direção do vento' });
  s.append(svgEl('circle', { r: 50, class: 'ring' }));
  for (let a = 0; a < 360; a += 22.5) {
    const major = a % 90 === 0;
    const r1 = major ? 41 : 45, rad = (a * Math.PI) / 180;
    s.append(svgEl('line', { x1: Math.sin(rad) * r1, y1: -Math.cos(rad) * r1, x2: Math.sin(rad) * 50, y2: -Math.cos(rad) * 50, class: major ? 'tk mj' : 'tk' }));
  }
  for (const [t, a] of [['N', 0], ['L', 90], ['S', 180], ['O', 270]]) {
    const rad = (a * Math.PI) / 180;
    const tx = svgEl('text', { x: Math.sin(rad) * 31, y: -Math.cos(rad) * 31 + 4, class: 'cd' });
    tx.textContent = t;
    s.append(tx);
  }
  const needle = svgEl('g', { class: 'needle' });
  needle.append(svgEl('path', { d: 'M0,-47 L6,-6 L0,-10 L-6,-6 Z', class: 'nd' }), svgEl('circle', { r: 4, class: 'hub' }));
  s.append(needle);
  s._needle = needle;
  return s;
}

/* ---------------------------------------------------------------- Dashboard */
const TILES = [
  { key: 'temp' },
  { key: 'hum' },
  { key: 'wind', wide: true },
  { key: 'rain' },
  { key: 'light' },
  { key: 'uv' },
  { key: 'pressure', optional: true },
];

export class Dashboard {
  constructor(root, { onRainZero } = {}) {
    this.root = root;
    this.tiles = {};
    for (const T of TILES) {
      const fd = FIELD[T.key];
      const tile = el('div', { class: 'tile' + (T.wide ? ' wide' : '') + (T.optional ? ' hide' : ''), id: 'tile-' + T.key });
      const title = T.key === 'wind' ? 'Vento' : T.key === 'uv' ? 'UV' : fd.label;
      tile.innerHTML = `
        <div class="th"><span class="lb">${title}</span><span data-st></span></div>
        <div class="tbody">
          ${T.key === 'wind' ? '<div class="cmp" data-cmp></div>' : ''}
          <div class="tmain">
            <div class="tv"><b data-v>—</b><small>${T.key === 'uv' ? '' : fd.unit}</small></div>
            <div class="ts" data-sub>&nbsp;</div>
          </div>
        </div>
        <svg class="spark" data-spark aria-hidden="true"></svg>
        <div class="tf"><span>mín <b data-min>—</b></span><span>máx <b data-max>—</b></span><span class="acc" title="Exatidão informada no manual">${fd.acc !== '—' ? 'exatidão ' + escapeHtml(fd.acc.split(' · ')[0]) : ''}</span></div>`;
      if (T.key === 'wind') {
        const c = compassSvg();
        tile.querySelector('[data-cmp]').append(c);
        this.needle = c._needle;
      }
      if (T.key === 'rain') {
        const b = el('button', { class: 'btn ghost xs', type: 'button', title: 'Usar a leitura atual como referência da chuva na sessão', text: 'Zerar Δ' });
        b.addEventListener('click', () => onRainZero?.());
        tile.querySelector('.th').append(b);
      }
      bindSpark(tile.querySelector('[data-spark]'));
      root.append(tile);
      this.tiles[T.key] = tile;
    }
    this.ro = new ResizeObserver(() => this.redraw());
    this.ro.observe(root);
  }

  q(key, sel) { return this.tiles[key].querySelector(sel); }

  /* rec: último pacote aceito; hist: { campo: [{t, v}] }; mm: { campo: {min, max} }; rainRef: contador de referência */
  update(rec, hist, mm, rainRef) {
    this.last = { hist };
    const d = rec.dec;
    for (const key of Object.keys(this.tiles)) {
      const fd = FIELD[key];
      if (key === 'pressure') this.tiles.pressure.classList.toggle('hide', !d.hasPressure);
      const a = rec.asm[key];
      if (!a || a.st === 'none') continue;
      const val = d.values[key];
      const vEl = this.q(key, '[data-v]');
      vEl.textContent = fmtNum(val, fd.dec);
      vEl.classList.toggle('long', vEl.textContent.length > 7);
      this.q(key, '[data-st]').innerHTML = statusTag(a.st, a.msg);
      const m = mm[key];
      this.q(key, '[data-min]').textContent = m ? fmtNum(m.min, fd.dec) : '—';
      this.q(key, '[data-max]').textContent = m ? fmtNum(m.max, fd.dec) : '—';
    }
    /* Vento: direção na rosa, velocidade, rajada */
    const dir = d.values.dir;
    if (dir !== null) this.needle.style.transform = `rotate(${dir}deg)`;
    this.needle.classList.toggle('off', dir === null);
    const wa = rec.asm.dir;
    this.q('wind', '[data-sub]').innerHTML =
      (d.values.wind === null ? '' : `<span><b>${fmtNum(d.values.wind * 3.6, 1)} km/h</b>${rec.factors.curve ? ' <span class="muted">· curva do coletor</span>' : ''}</span>`) +
      `<span>Direção <b>${dir === null ? 'inválida' : fmtNum(dir, 0) + '° ' + cardinal(dir)}</b>${wa.st !== 'ok' ? ' ' + statusTag(wa.st, wa.msg) : ''}</span>` +
      `<span>Rajada <b>${d.values.gust === null ? 'inválida' : fmtNum(d.values.gust, 1) + ' m/s · ' + fmtNum(d.values.gust * 3.6, 1) + ' km/h'}</b></span>`;
    /* Chuva: contador bruto e variação desde a referência (basculadas da caçamba) */
    const cnt = d.raw.rain;
    const delta = rainRef === null ? 0 : (cnt - rainRef + 0x10000) % 0x10000;
    this.q('rain', '[data-sub]').innerHTML = `Δ sessão <b>+${fmtNum(delta * rec.factors.rain, 1)} mm</b> <span class="muted">(${delta} basculada${delta === 1 ? '' : 's'} · contador ${cnt})</span>`;
    /* UV: valor bruto + índice estimado */
    this.q('uv', '[data-sub]').innerHTML = d.values.uvi === null ? '&nbsp;' : `Índice UV <b>${d.values.uvi}</b> <span class="muted">(tabela do coletor)</span>`;
    this.q('light', '[data-sub]').innerHTML = d.values.light === null ? '&nbsp;' : `<b>${fmtNum(d.values.light / 1000, 2)}</b> klux`;
    this.q('temp', '[data-sub]').innerHTML = `resolução ${FIELD.temp.res}`;
    this.q('hum', '[data-sub]').innerHTML = `resolução ${FIELD.hum.res}`;
    if (d.hasPressure) this.q('pressure', '[data-sub]').innerHTML = 'barômetro (bytes 17 a 19)';
    this.redraw();
  }

  redraw() {
    const hist = this.last?.hist;
    if (!hist) return;
    for (const key of Object.keys(this.tiles)) {
      const fd = FIELD[key];
      const svg = this.q(key, '[data-spark]');
      if (this.tiles[key].classList.contains('hide')) continue;
      drawSpark(svg, hist[key] ?? [], (v) => `${fmtNum(v, fd.dec)} ${fd.unit}`.trim());
    }
  }

  clear() {
    this.last = null;
    for (const key of Object.keys(this.tiles)) {
      for (const s of ['[data-v]', '[data-min]', '[data-max]']) this.q(key, s).textContent = '—';
      this.q(key, '[data-st]').innerHTML = '';
      this.q(key, '[data-sub]').innerHTML = '&nbsp;';
      this.q(key, '[data-spark]').replaceChildren();
    }
    this.tiles.pressure.classList.add('hide');
    this.needle.classList.add('off');
  }
}

/* ---------------------------------------------------------------- Tabela */
const COLS = [
  ['temp', 'T (°C)'], ['hum', 'UR (%)'], ['dir', 'Dir (°)'], ['wind', 'Vento (m/s)'], ['gust', 'Rajada (m/s)'],
  ['rain', 'Chuva (mm)'], ['uv', 'UV'], ['light', 'Luz (lux)'], ['pressure', 'P (hPa)'],
];
export function renderTable(records, { hex = false, onlyErr = false, pressure = false } = {}) {
  const cols = COLS.filter(([k]) => k !== 'pressure' || pressure);
  $('tblHead').innerHTML = `<tr><th>Hora</th><th>#</th><th>Status</th><th>ID</th>${cols.map(([, t]) => `<th class="r">${t}</th>`).join('')}<th>Bateria</th>${hex ? '<th>Frame (hex)</th>' : ''}</tr>`;
  const list = (onlyErr ? records.filter((r) => r.status !== 'ok' || r.alerts.length) : records).slice().reverse();
  const rows = list.map((r) => {
    const d = r.dec;
    const st = r.status === 'ok' ? 'ok' : 'err';
    const src = r.source !== 'serial' ? ` <span class="tag warn">${SOURCE_LABEL[r.source]}</span>` : '';
    let cells = `<td class="mono">${fmtTime(new Date(r.t))}</td><td class="mono muted">${r.seq}</td>` +
      `<td><span class="tag ${st}" title="${escapeHtml(statusDetail(r))}">${STATUS_LABEL[r.status]}</span>${src}</td>`;
    if (d) {
      cells += `<td class="mono">${hex2(d.id)}</td>`;
      for (const [k] of cols) {
        const a = r.asm[k];
        const v = d.values[k];
        const txt = k === 'pressure' && !d.hasPressure ? '—' : v === null ? 'inválido' : k === 'dir' ? `${fmtNum(v, 0)} ${cardinal(v)}` : fmtNum(v, FIELD[k].dec);
        cells += `<td class="r ${a.st === 'ok' || a.st === 'none' ? '' : a.st}"${a.msg ? ` title="${escapeHtml(a.msg)}"` : ''}>${txt}</td>`;
      }
      cells += `<td>${d.lowBattery ? '<span class="tag warn">Baixa</span>' : '<span class="muted">OK</span>'}</td>`;
    } else {
      cells += `<td class="muted" colspan="${cols.length + 2}">${escapeHtml(statusDetail(r))}</td>`;
    }
    if (hex) cells += `<td class="mono hexcell">${r.hex}</td>`;
    return `<tr class="${st === 'err' ? 'bad' : ''}${r.alerts.length ? ' alert' : ''}"${r.alerts.length ? ` title="${escapeHtml(r.alerts.join('; '))}"` : ''}>${cells}</tr>`;
  });
  $('tblBody').innerHTML = rows.join('');
  $('tblEmpty').classList.toggle('hide', rows.length > 0);
  $('tblWrap').classList.toggle('hide', rows.length === 0);
  $('tblCount').textContent = records.length ? `${list.length} de ${records.length} pacote(s) na tela` : '';
}

/* ---------------------------------------------------------------- Texto */
export function textFor(rec, { time = true, hex = false, detail = false } = {}) {
  if (detail) return detailLines(rec).join('\n') + '\n\n';
  return compactLine(rec, { time, hex }) + '\n';
}
export const textClass = (rec) => (rec.status !== 'ok' ? 'e' : rec.alerts.length ? 'w' : '');
