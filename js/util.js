/* Utilitários: DOM, formatação, SHA-256, armazenamento local e downloads */

export const $ = (id) => document.getElementById(id);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c);
  return n;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const hex2 = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(2, '0');

/* Números no padrão brasileiro (vírgula decimal); null = valor inválido */
export function fmtNum(v, dec = 1, { group = true } = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: group });
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / 1024 / 1024).toFixed(2).replace('.', ',')} MB`;
}

const p2 = (n) => String(n).padStart(2, '0');
export function fmtDateTime(d = new Date(), withSeconds = true) {
  const s = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return withSeconds ? `${s}:${p2(d.getSeconds())}` : s;
}
export const fmtTime = (d = new Date()) => `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
/* AAAA-MM-DD HH:MM:SS (hora local): ordena bem e é reconhecido pelas planilhas */
export function isoLocal(d = new Date()) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${fmtTime(d)}`;
}
/* Fuso no formato -03:00 */
export function tzOffset(d = new Date()) {
  const m = -d.getTimezoneOffset();
  return `${m < 0 ? '-' : '+'}${p2(Math.floor(Math.abs(m) / 60))}:${p2(Math.abs(m) % 60)}`;
}
export function stampForFile(d = new Date()) {
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h} h ${p2(m)} min` : m ? `${m} min ${p2(r)} s` : `${r} s`;
}

export function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1200); }
    return true;
  } catch { return false; }
}

/* Armazenamento local: só para conveniências deste computador (aba, opções, fatores) */
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('wsmonitor.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('wsmonitor.' + key, JSON.stringify(value)); } catch { /* sem armazenamento */ }
  },
  del(key) {
    try { localStorage.removeItem('wsmonitor.' + key); } catch { /* sem armazenamento */ }
  },
};
