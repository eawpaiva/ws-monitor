/* Texto de cada pacote recebido: linha compacta (modo Texto e arquivo .txt), detalhamento campo a campo
   e linha CSV. Um "registro" (rec) é montado em app.js a partir de um frame:
   { seq, t, source, bytes, hex, check, status: 'ok'|'sum'|'crc', accepted, dec, asm, alerts } */
import { FIELDS, FIELD, cardinal } from './wh24c.js';
import { fmtNum, fmtTime, hex2, isoLocal } from './util.js';

export const STATUS_LABEL = { ok: 'OK', sum: 'ERRO CHECKSUM', crc: 'ERRO CRC' };
export const SOURCE_LABEL = { serial: 'SERIAL', sim: 'SIMULADO', manual: 'MANUAL' };

/* Valor com unidade, no padrão brasileiro */
export function fmtField(dec, key, { unit = true } = {}) {
  const fd = FIELD[key];
  const v = dec.values[key];
  if (key === 'pressure' && !dec.hasPressure) return '—';
  const s = fmtNum(v, fd.dec);
  if (s === '—') return 'inválido';
  if (key === 'dir') return `${s}°${unit ? ' ' + cardinal(v) : ''}`;
  return unit && fd.unit ? `${s} ${fd.unit}` : s;
}

export function statusDetail(rec) {
  const c = rec.check;
  if (rec.status === 'crc') return `CRC calculado ${hex2(c.crcCalc ?? 0)}, recebido ${hex2(c.crcRx ?? 0)}`;
  if (rec.status === 'sum') return `checksum calculado ${hex2(c.sumCalc)}, recebido ${hex2(c.sumRx)}`;
  return '';
}

/* Linha única: "17:03:12 #12 OK ID 0xFA · T 25,0 °C · UR 69 % · ..." */
export function compactLine(rec, { time = true, hex = false, date = false } = {}) {
  const head = [];
  if (date) head.push(isoLocal(new Date(rec.t)));
  else if (time) head.push(fmtTime(new Date(rec.t)));
  head.push(`#${rec.seq}`);
  if (rec.source !== 'serial') head.push(`[${SOURCE_LABEL[rec.source]}]`);
  head.push(STATUS_LABEL[rec.status]);
  let body;
  if (rec.dec) {
    const d = rec.dec;
    const parts = [`ID ${hex2(d.id)}`];
    for (const fd of FIELDS) {
      if (fd.key === 'pressure' && !d.hasPressure) continue;
      parts.push(`${fd.short} ${fmtField(d, fd.key, { unit: true })}`);
      if (fd.key === 'uv' && d.values.uvi !== null) parts[parts.length - 1] += ` (UVI ${d.values.uvi})`;
      if ((fd.key === 'wind' || fd.key === 'gust') && d.values[fd.key] !== null) parts[parts.length - 1] += ` (${fmtNum(d.values[fd.key] * 3.6, 1)} km/h)`;
    }
    parts.push(`Bat ${d.lowBattery ? 'BAIXA' : 'OK'}`);
    body = parts.join(' · ');
    if (rec.status !== 'ok') body += ` · ${statusDetail(rec)}`;
  } else {
    body = `${rec.bytes.length} bytes · ${statusDetail(rec)}`;
  }
  let s = `${head.join(' ')}  ${body}`;
  if (rec.alerts.length) s += `  ! ${rec.alerts.join('; ')}`;
  if (hex || !rec.dec) s += `  | ${rec.hex}`;
  return s;
}

/* Detalhamento campo a campo, com os valores brutos (modo Texto > Detalhado e Desenvolvedor) */
export function detailLines(rec) {
  const L = [];
  const c = rec.check;
  L.push(`${fmtTime(new Date(rec.t))} #${rec.seq} ${STATUS_LABEL[rec.status]} · ${rec.bytes.length} bytes${rec.source !== 'serial' ? ' · ' + SOURCE_LABEL[rec.source] : ''}`);
  L.push(`  Frame ............ ${rec.hex}`);
  if (rec.dec) {
    const d = rec.dec, r = d.raw;
    const row = (label, val, raw) => L.push(`  ${(label + ' ').padEnd(19, '.')} ${String(val).padEnd(18)} ${raw}`);
    row('ID (security code)', hex2(d.id), `(decimal ${d.id})`);
    row(FIELD.temp.label, fmtField(d, 'temp'), `(bruto ${hex2(r.temp)} = ${r.temp}; −400, ÷10)`);
    row(FIELD.hum.label, fmtField(d, 'hum'), `(bruto ${hex2(r.hum)})`);
    row(FIELD.dir.label, fmtField(d, 'dir'), `(bruto ${hex2(r.dir)} = ${r.dir})`);
    const kmh = (v) => (v === null ? '' : ` = ${fmtNum(v * 3.6, 1)} km/h`);
    const crv = rec.factors?.curve ? ' + curva do coletor' : '';
    row(FIELD.wind.label, fmtField(d, 'wind'), `(bruto 9 bits ${hex2(r.wind)} = ${r.wind}; ÷8 × fator${crv}${kmh(d.values.wind)})`);
    row(FIELD.gust.label, fmtField(d, 'gust'), `(bruto ${hex2(r.gust)} = ${r.gust}; × fator${crv}${kmh(d.values.gust)})`);
    row(FIELD.rain.label, fmtField(d, 'rain'), `(contador ${r.rain}; × fator)`);
    row(FIELD.uv.label, fmtField(d, 'uv'), d.values.uvi !== null ? `(índice UV ${d.values.uvi}, tabela do coletor)` : '');
    row(FIELD.light.label, fmtField(d, 'light'), `(bruto ${r.light}; × fator)`);
    if (d.hasPressure) row(FIELD.pressure.label, fmtField(d, 'pressure'), `(bruto ${r.pressure}; ÷100)`);
    row('Bateria', d.lowBattery ? 'BAIXA' : 'OK', '(byte 3, bit 3)');
    row('Bits fixos', d.fixOk ? '11 (OK)' : `${r.fix.toString(2).padStart(2, '0')} (esperado 11)`, '(byte 3, bits 6-5)');
  }
  if (c.crcCalc !== null) L.push(`  CRC ${hex2(c.crcRx)} ${c.crcOk ? 'confere' : `NÃO confere (calculado ${hex2(c.crcCalc)})`} · checksum ${hex2(c.sumRx)} ${c.sumOk ? 'confere' : `NÃO confere (calculado ${hex2(c.sumCalc)})`}`);
  if (rec.alerts.length) L.push(`  Alertas: ${rec.alerts.join('; ')}`);
  return L;
}

/* ---------------------------------------------------------------- CSV */
/* br: separador ";" e vírgula decimal (Excel em português); intl: "," e ponto decimal */
export const CSV_STYLES = {
  br: { sep: ';', dec: ',', label: 'Excel pt-BR (; e vírgula decimal)' },
  intl: { sep: ',', dec: '.', label: 'Internacional (, e ponto decimal)' },
};

export const CSV_COLUMNS = [
  'data_hora_local', 'data_hora_utc', 'seq', 'origem', 'status', 'id',
  'temperatura_c', 'umidade_pct', 'direcao_vento_graus', 'velocidade_vento_ms', 'velocidade_vento_kmh', 'rajada_ms', 'rajada_kmh',
  'vento_bruto', 'rajada_bruta', 'chuva_mm', 'chuva_contagem', 'uv_bruto', 'indice_uv', 'luminosidade_lux', 'pressao_hpa',
  'bateria_baixa', 'alertas', 'frame_hex',
];

function csvCell(v, st) {
  const s = String(v ?? '');
  return s.includes(st.sep) || s.includes('"') || /[\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const num = (v, dec, st) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(dec).replace('.', st.dec));

export const csvHeader = (style = 'br') => CSV_COLUMNS.join(CSV_STYLES[style].sep) + '\r\n';

export function csvRow(rec, style = 'br') {
  const st = CSV_STYLES[style];
  const d = rec.dec;
  const v = d?.values ?? {};
  const cells = [
    isoLocal(new Date(rec.t)), new Date(rec.t).toISOString(), rec.seq, SOURCE_LABEL[rec.source], STATUS_LABEL[rec.status],
    d ? hex2(d.id) : '',
    num(v.temp, 1, st), num(v.hum, 0, st), num(v.dir, 0, st),
    num(v.wind, 2, st), num(v.wind === null || v.wind === undefined ? null : v.wind * 3.6, 1, st),
    num(v.gust, 1, st), num(v.gust === null || v.gust === undefined ? null : v.gust * 3.6, 1, st),
    d ? d.raw.wind : '', d ? d.raw.gust : '',
    num(v.rain, 1, st), d ? d.raw.rain : '', num(v.uv, 0, st), v.uvi ?? '', num(v.light, 1, st), d?.hasPressure ? num(v.pressure, 2, st) : '',
    d ? (d.lowBattery ? 1 : 0) : '',
    [rec.status !== 'ok' ? statusDetail(rec) : '', ...rec.alerts].filter(Boolean).join(' | '),
    rec.hex.replace(/ /g, ''),
  ];
  return cells.map((c) => csvCell(c, st)).join(st.sep) + '\r\n';
}

/* Cabeçalho de identificação: "chave: valor" (com "# " no CSV) */
export function metaLines(meta) {
  return Object.entries(meta).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`);
}
