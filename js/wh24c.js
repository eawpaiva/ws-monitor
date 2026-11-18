/* Protocolo da estação WH24C (saída RS-485, UART 9600 8N1): CRC-8, checksum, separação dos frames e
   decodificação. Sem DOM: usado pela interface, pelo simulador do Desenvolvedor e por tests/unit.html.
   Referência: manual FG-0WN24C-B4U1 (docs/), seções 5 (Specifications) e 6 (Data Protocol).

   Frame (17 bytes; 20 com o barômetro):
     0     family code 0x24
     1     security code (ID; muda quando a estação reinicia)
     2     DIR_7..0
     3     b7 DIR_8 · b6..5 fixos em 1 · b4 WSP_8 · b3 bateria baixa · b2..0 TMP_10..8
     4     TMP_7..0          temperatura + 400, em 0,1 °C (0x7FF = inválido)
     5     umidade %         (0xFF = inválido)
     6     WSP_7..0          vento: 9 bits / 8 × fator (1,12 m/s no firmware do coletor)
     7     rajada            (0xFF = inválido)
     8-9   contador de chuva (× 0,3 mm)
     10-11 UV                (0 a 20000; 0xFFFF = inválido)
     12-14 luminosidade      0,1 lux (0xFFFFFF = inválido)
     15    CRC-8 (polinômio 0x31, valor inicial 0) dos bytes 0 a 14
     16    checksum: soma dos bytes 0 a 15, sem o vai-um
     17-19 pressão (opcional) em 0,01 hPa: 0x018A9E = 1010,22 hPa */

export const FAMILY_CODE = 0x24;
export const FRAME_LEN = 17;
export const FRAME_LEN_PRESSURE = 20;
export const PERIOD_S = 16;
export const TEMP_OFFSET = 400;

/* Fatores de conversão (editáveis no Modo Desenvolvedor). Padrão = firmware do coletor BeWeather
   (components/weatherstation/ws_wh24c.c), para a tela bater com o que o coletor envia ao servidor:
   - vento = bruto(9 bits) / 8 × 1,12 m/s; rajada = bruto × 1,12 m/s (WH24C_WIND_FACTOR).
     O manual da WH24C traz "wind speed factor: 0.4 m/s"; o firmware usa 1,12 (o da família WH24).
   - curve: curva de calibração do firmware para vento e rajada (calc_wind_speed/calc_wind_gust):
     limite de 50 m/s e, até 14,5 km/h, y = 2,30403498·x − 0,08951347·x² (x e y em km/h).
   - chuva × 0,3 mm; luz × 0,1 lux (o firmware divide por 10 em inteiro e perde a casa decimal). */
export const DEFAULT_FACTORS = { wind: 1.12, gust: 1.12, rain: 0.3, light: 0.1, curve: true };
export const WIND_MAX_MS = 50;
export const CURVE_LIMIT_KMH = 14.5;

/* Curva do firmware: recebe m/s (linear) e devolve m/s, como calc_wind_speed/calc_wind_gust (que devolvem km/h) */
export function collectorCurve(ms) {
  if (ms > WIND_MAX_MS) return WIND_MAX_MS;
  const kmh = ms * 3.6;
  if (kmh <= CURVE_LIMIT_KMH) return (2.30403498 * kmh - 0.08951347 * kmh * kmh) / 3.6;
  return ms;
}

/* Marcadores de valor inválido. Vento (0x1FF) não consta no manual: segue a família WH24 e também é o
   maior valor representável (saturado). */
export const INVALID = { dir: 0x1ff, temp: 0x7ff, hum: 0xff, wind: 0x1ff, gust: 0xff, uv: 0xffff, light: 0xffffff };

/* ---------------------------------------------------------------- CRC-8 e checksum */
const CRC_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 0xff : (c << 1) & 0xff;
    t[n] = c;
  }
  return t;
})();
export const crcTable = () => CRC_TABLE.slice();

export function crc8(bytes, start = 0, len = bytes.length - start) {
  let c = 0;
  for (let i = start; i < start + len; i++) c = CRC_TABLE[bytes[i] ^ c];
  return c;
}
export function sum8(bytes, start = 0, len = bytes.length - start) {
  let s = 0;
  for (let i = start; i < start + len; i++) s = (s + bytes[i]) & 0xff;
  return s;
}

/* Confere family code, CRC (byte 15) e checksum (byte 16) */
export function checkFrame(b) {
  const r = { len: b.length, family: b[0] === FAMILY_CODE, crcCalc: null, crcRx: null, sumCalc: null, sumRx: null, crcOk: false, sumOk: false };
  if (b.length < FRAME_LEN) return r;
  r.crcCalc = crc8(b, 0, 15);
  r.crcRx = b[15];
  r.sumCalc = sum8(b, 0, 16);
  r.sumRx = b[16];
  r.crcOk = r.crcCalc === r.crcRx;
  r.sumOk = r.sumCalc === r.sumRx;
  return r;
}

/* ---------------------------------------------------------------- separação dos frames */
const PRESSURE_MIN = 30000;   // 300 hPa: abaixo disso os 3 bytes extras não são uma pressão plausível
const PRESSURE_MAX = 120000;  // 1200 hPa
const crcAt = (b, i) => i + FRAME_LEN <= b.length && b[i] === FAMILY_CODE && crc8(b, i, 15) === b[i + 15];
const pressureAt = (b, i) => {
  if (i + 3 > b.length) return false;
  const p = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
  return p >= PRESSURE_MIN && p <= PRESSURE_MAX;
};

/* Separa uma rajada de bytes (tudo o que chegou até a linha ficar em silêncio) em frames e lixo.
   - Frame válido: começa em 0x24 e o CRC confere. Os 3 bytes seguintes são a pressão quando não
     começam outro frame e formam um valor plausível (300 a 1200 hPa).
   - Um trecho que sobrou com 17 ou 20 bytes começando em 0x24 vira frame com erro de CRC, para a
     contagem de erros; o resto é "lixo" (ruído, eco, pedaço de frame). */
export function splitBurst(buf) {
  const out = [];
  let junkStart = -1;
  const flushJunk = (end) => {
    if (junkStart < 0) return;
    const seg = buf.slice(junkStart, end);
    const offset = junkStart;
    junkStart = -1;
    if (seg[0] === FAMILY_CODE && (seg.length === FRAME_LEN || seg.length === FRAME_LEN_PRESSURE)) out.push({ kind: 'frame', bytes: seg, offset });
    else out.push({ kind: 'junk', bytes: seg, offset });
  };
  let i = 0;
  while (i < buf.length) {
    if (crcAt(buf, i)) {
      flushJunk(i);
      const next = i + FRAME_LEN;
      const len = !crcAt(buf, next) && pressureAt(buf, next) ? FRAME_LEN_PRESSURE : FRAME_LEN;
      out.push({ kind: 'frame', bytes: buf.slice(i, i + len), offset: i });
      i += len;
    } else {
      if (junkStart < 0) junkStart = i;
      i++;
    }
  }
  flushJunk(buf.length);
  return out;
}

/* Junta os pedaços que chegam da porta serial e entrega cada rajada quando a linha fica em silêncio
   por gapMs (9600 baud: ~1 ms por byte; a estação manda um pacote a cada 16 s).
   - O silêncio é medido também na chegada de cada pedaço (não só pelo temporizador): com a janela
     minimizada, o navegador atrasa os temporizadores em até 1 min, e a rajada anterior é entregue
     assim que chega o próximo pacote.
   - Cada byte guarda a hora em que chegou: onBurst(bytes, t0, timeAt) e timeAt(offset) dá a hora do
     pedaço que contém o byte, para cada pacote ter o seu horário mesmo se vários forem entregues juntos. */
export class FrameSplitter {
  constructor({ gapMs = 80, maxBytes = 512, onBurst }) {
    this.gapMs = gapMs;
    this.maxBytes = maxBytes;
    this.onBurst = onBurst;
    this.buf = [];
    this.marks = [];      // [índice do primeiro byte do pedaço, hora de chegada]
    this.lastAt = 0;
    this.timer = null;
  }
  push(chunk, now = Date.now()) {
    if (this.buf.length && now - this.lastAt > this.gapMs) this.flush();
    this.marks.push([this.buf.length, now]);
    for (const x of chunk) this.buf.push(x);
    this.lastAt = now;
    clearTimeout(this.timer);
    if (this.buf.length >= this.maxBytes) this.flush();
    else this.timer = setTimeout(() => this.flush(), this.gapMs);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.buf.length) return;
    const bytes = Uint8Array.from(this.buf);
    const marks = this.marks;
    this.buf = [];
    this.marks = [];
    const timeAt = (offset) => {
      let t = marks[0][1];
      for (const [i, tm] of marks) { if (i > offset) break; t = tm; }
      return t;
    };
    this.onBurst(bytes, marks[0][1], timeAt);
  }
  reset() { clearTimeout(this.timer); this.timer = null; this.buf = []; this.marks = []; }
}

/* ---------------------------------------------------------------- decodificação */
/* Índice UV a partir do valor bruto: tabela do firmware do coletor (wh24c_calc_uv_index), de 0 a 15.
   O manual da WH24C só informa o valor bruto (0 a 20000). Diferença intencional: de 1843 a 2291 o
   firmware devolve 4 (degrau repetido, provável erro de digitação); aqui vale 5. */
const UVI_LIMITS = [99, 540, 1000, 1400, 1843, 2292, 2734, 3138, 3648, 4196, 4707, 5209, 5735, 6276, 6778];
export function uviFromRaw(raw) {
  if (raw === null || raw === undefined) return null;
  let i = 0;
  while (i < UVI_LIMITS.length && raw >= UVI_LIMITS[i]) i++;
  return i;
}

export function decode(b, factors = DEFAULT_FACTORS) {
  const f = { ...DEFAULT_FACTORS, ...factors };
  const raw = {
    id: b[1],
    dir: b[2] | ((b[3] & 0x80) << 1),
    fix: (b[3] >> 5) & 0x03,
    lowBattery: (b[3] >> 3) & 1,
    temp: ((b[3] & 0x07) << 8) | b[4],
    hum: b[5],
    wind: b[6] | ((b[3] & 0x10) << 4),
    gust: b[7],
    rain: (b[8] << 8) | b[9],
    uv: (b[10] << 8) | b[11],
    light: (b[12] << 16) | (b[13] << 8) | b[14],
    pressure: b.length >= FRAME_LEN_PRESSURE ? (b[17] << 16) | (b[18] << 8) | b[19] : null,
  };
  const v = (key, fn) => (raw[key] === INVALID[key] ? null : fn(raw[key]));
  const values = {
    dir: v('dir', (x) => x),
    temp: v('temp', (x) => (x - TEMP_OFFSET) / 10),
    hum: v('hum', (x) => x),
    wind: v('wind', (x) => (f.curve ? collectorCurve : (y) => y)((x / 8) * f.wind)),
    gust: v('gust', (x) => (f.curve ? collectorCurve : (y) => y)(x * f.gust)),
    rain: raw.rain * f.rain,
    uv: v('uv', (x) => x),
    light: v('light', (x) => x * f.light),
    pressure: raw.pressure === null ? null : raw.pressure / 100,
  };
  values.uvi = uviFromRaw(values.uv);
  return {
    len: b.length,
    id: raw.id,
    lowBattery: raw.lowBattery === 1,
    fixOk: raw.fix === 0x03,
    hasPressure: raw.pressure !== null,
    raw,
    values,
  };
}

/* ---------------------------------------------------------------- faixas do manual */
/* proto: faixa do protocolo (fora dela = falha); spec: faixa de medição do fabricante (fora = aviso).
   acc/res: exatidão e resolução da seção 5 do manual. */
export const FIELDS = [
  { key: 'temp', label: 'Temperatura', short: 'T', unit: '°C', dec: 1, proto: [-40, 60], spec: [-30, 60], acc: '± 1 °C', res: '0,1 °C', invalid: '0x7FF' },
  { key: 'hum', label: 'Umidade relativa', short: 'UR', unit: '%', dec: 0, proto: [1, 99], spec: [10, 99], acc: '± 5 %', res: '1 %', invalid: '0xFF' },
  { key: 'dir', label: 'Direção do vento', short: 'Dir', unit: '°', dec: 0, proto: [0, 359], spec: [0, 359], acc: '—', res: '1°', invalid: '0x1FF' },
  { key: 'wind', label: 'Velocidade do vento', short: 'Vento', unit: 'm/s', dec: 2, proto: null, spec: [0, 50], acc: '± 1 m/s (< 5 m/s) · ± 10 % (> 5 m/s)', res: '—', invalid: '0x1FF' },
  { key: 'gust', label: 'Rajada', short: 'Rajada', unit: 'm/s', dec: 1, proto: null, spec: [0, 50], acc: '—', res: '—', invalid: '0xFF' },
  { key: 'rain', label: 'Chuva acumulada', short: 'Chuva', unit: 'mm', dec: 1, proto: null, spec: [0, 9999], acc: '± 10 %', res: '0,3 mm (< 1000 mm) · 1 mm (> 1000 mm)', invalid: '—' },
  { key: 'uv', label: 'UV (valor bruto)', short: 'UV', unit: '', dec: 0, proto: [0, 20000], spec: null, acc: '—', res: '1', invalid: '0xFFFF' },
  { key: 'light', label: 'Luminosidade', short: 'Luz', unit: 'lux', dec: 1, proto: [0, 300000], spec: [0, 400000], acc: '± 15 %', res: '0,1 lux', invalid: '0xFFFFFF' },
  { key: 'pressure', label: 'Pressão', short: 'P', unit: 'hPa', dec: 2, proto: null, spec: null, acc: '—', res: '0,01 hPa', invalid: '—', optional: true },
];
export const FIELD = Object.fromEntries(FIELDS.map((x) => [x.key, x]));

/* Situação de cada valor: ok | warn (fora da faixa de medição do fabricante) | err (inválido ou fora
   do protocolo) | none (campo ausente, ex.: pressão num frame de 17 bytes) */
export function assess(dec) {
  const out = {};
  for (const fd of FIELDS) {
    const val = dec.values[fd.key];
    if (fd.optional && !dec.hasPressure) { out[fd.key] = { st: 'none' }; continue; }
    if (val === null) { out[fd.key] = { st: 'err', msg: `inválido (${fd.invalid})` }; continue; }
    if (fd.proto && (val < fd.proto[0] || val > fd.proto[1])) { out[fd.key] = { st: 'err', msg: `fora do protocolo (${fd.proto[0]} a ${fd.proto[1]} ${fd.unit})`.replace(' )', ')') }; continue; }
    if (fd.spec && (val < fd.spec[0] || val > fd.spec[1])) { out[fd.key] = { st: 'warn', msg: `fora da faixa de medição (${fd.spec[0]} a ${fd.spec[1]} ${fd.unit})`.replace(' )', ')') }; continue; }
    out[fd.key] = { st: 'ok' };
  }
  return out;
}

/* ---------------------------------------------------------------- montagem (simulador e testes) */
/* Monta um frame a partir dos valores brutos; recalcula CRC e checksum */
export function encodeRaw({ id = 0xa5, dir = 0, lowBattery = 0, temp = 650, hum = 50, wind = 0, gust = 0, rain = 0, uv = 0, light = 0, pressure = null }) {
  const b = new Uint8Array(pressure === null ? FRAME_LEN : FRAME_LEN_PRESSURE);
  b[0] = FAMILY_CODE;
  b[1] = id & 0xff;
  b[2] = dir & 0xff;
  b[3] = ((dir >> 8) & 1) << 7 | 0x60 | ((wind >> 8) & 1) << 4 | (lowBattery ? 0x08 : 0) | ((temp >> 8) & 0x07);
  b[4] = temp & 0xff;
  b[5] = hum & 0xff;
  b[6] = wind & 0xff;
  b[7] = gust & 0xff;
  b[8] = (rain >> 8) & 0xff;
  b[9] = rain & 0xff;
  b[10] = (uv >> 8) & 0xff;
  b[11] = uv & 0xff;
  b[12] = (light >> 16) & 0xff;
  b[13] = (light >> 8) & 0xff;
  b[14] = light & 0xff;
  b[15] = crc8(b, 0, 15);
  b[16] = sum8(b, 0, 16);
  if (pressure !== null) { b[17] = (pressure >> 16) & 0xff; b[18] = (pressure >> 8) & 0xff; b[19] = pressure & 0xff; }
  return b;
}

/* Valores físicos -> brutos (inverso de decode, só a parte linear: a curva do coletor não é invertida) */
export function rawFromValues(v, factors = DEFAULT_FACTORS) {
  const f = { ...DEFAULT_FACTORS, ...factors };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x)));
  return {
    id: v.id,
    dir: clamp(v.dir, 0, 359),
    lowBattery: v.lowBattery ? 1 : 0,
    temp: clamp(v.temp * 10 + TEMP_OFFSET, 0, 0x7fe),
    hum: clamp(v.hum, 1, 99),
    wind: clamp((v.wind / f.wind) * 8, 0, 0x1fe),
    gust: clamp(v.gust / f.gust, 0, 0xfe),
    rain: clamp(v.rain / f.rain, 0, 0xffff),
    uv: clamp(v.uv, 0, 20000),
    light: clamp(v.light / f.light, 0, 0xfffffe),
    pressure: v.pressure === null || v.pressure === undefined ? null : clamp(v.pressure * 100, 0, 0xffffff),
  };
}

/* ---------------------------------------------------------------- utilitários */
export function toHex(bytes, sep = ' ') {
  return [...bytes].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(sep);
}
export function parseHexBytes(text) {
  const t = String(text).replace(/0x/gi, '').replace(/[\s,;:-]+/g, '');
  if (!t || t.length % 2 || /[^0-9a-f]/i.test(t)) return null;
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

/* Rosa dos ventos em 16 pontos (pt-BR: L = leste, O = oeste) */
const CARD = ['N', 'NNE', 'NE', 'ENE', 'L', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
export const cardinal = (deg) => (deg === null || deg === undefined ? '—' : CARD[Math.round(deg / 22.5) % 16]);
