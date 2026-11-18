/* Envia o log técnico ao servidor local, que grava em log/AAAA-MM-DD_log-tecnico.txt.
   Se o servidor estiver parado (app aberto pelo cache do PWA), guarda o texto pendente neste
   computador e reenvia assim que o servidor voltar. */
import { API_HEADER, LOG_ENDPOINT } from './config.js';
import { store } from './util.js';

const MAX_PENDING = 2 * 1024 * 1024;

export class LogSink extends EventTarget {
  constructor() {
    super();
    this.queue = store.get('logPending', '');
    this.ok = null;
    this.timer = null;
    this.flushing = false;
    if (this.queue) this._schedule(500);
    setInterval(() => { if (this.ok === false) this.flush(); }, 30_000);
  }

  get pending() { return this.queue.length; }

  push(text) {
    if (!text) return;
    let q = this.queue + text;
    if (q.length > MAX_PENDING) q = q.slice(q.length - MAX_PENDING);
    this.queue = q;
    this._schedule(800);
  }

  _schedule(ms) {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, ms);
  }

  async flush() {
    if (this.flushing) { this._schedule(500); return; }
    if (!this.queue) return;
    this.flushing = true;
    const body = this.queue;
    this.queue = '';
    try {
      const r = await fetch(`${LOG_ENDPOINT}?f=tecnico`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8', [API_HEADER]: '1' },
        body,
        cache: 'no-store',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.ok = true;
    } catch {
      this.queue = body + this.queue;
      this.ok = false;
    } finally {
      this.flushing = false;
      store.set('logPending', this.queue);
      this.dispatchEvent(new Event('change'));
    }
  }
}
