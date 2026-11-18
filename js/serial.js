/* Porta serial (Web Serial) do conversor USB/RS-485: abre em 8N1, lê continuamente e entrega os bytes.
   Se o conversor é desconectado com a porta aberta, volta a abrir sozinho quando o mesmo adaptador
   (mesmo fabricante/produto USB) é reconectado: uma gravação longa não para por um mau contato. */
import { sleep } from './util.js';

const VENDORS = { 0x1a86: 'CH340/CH9102', 0x10c4: 'CP210x', 0x0403: 'FTDI', 0x067b: 'PL2303', 0x303a: 'Espressif USB' };

export class SerialLink extends EventTarget {
  constructor() {
    super();
    this.port = null;
    this.mon = null;        // leitura em andamento
    this.baud = null;
    this.onData = null;
    this.wantOpen = false;  // o técnico pediu para conectar (e não desconectou)
    this.lastInfo = null;
    if ('serial' in navigator) {
      navigator.serial.addEventListener('disconnect', (e) => { if (e.target === this.port) this._lost(); });
      navigator.serial.addEventListener('connect', (e) => this._maybeReconnect(e.target));
    }
  }

  get supported() { return 'serial' in navigator; }
  get isOpen() { return !!this.mon; }

  portLabel(port = this.port) {
    if (!port) return null;
    const i = port.getInfo?.() ?? {};
    if (VENDORS[i.usbVendorId]) return VENDORS[i.usbVendorId];
    return i.usbVendorId ? `USB ${i.usbVendorId.toString(16).padStart(4, '0')}:${(i.usbProductId ?? 0).toString(16).padStart(4, '0')}` : 'Serial';
  }

  _emit() { this.dispatchEvent(new Event('change')); }

  _lost() {
    if (this.mon) this.mon.reading = false;
    this.mon = null;
    this.port = null;
    this.dispatchEvent(new Event('lost'));
    this._emit();
  }

  async _maybeReconnect(port) {
    if (!this.wantOpen || this.port || !this.lastInfo) return;
    const i = port.getInfo?.() ?? {};
    if (i.usbVendorId !== this.lastInfo.usbVendorId || i.usbProductId !== this.lastInfo.usbProductId) return;
    this.port = port;
    try {
      await sleep(300);
      await this.open(this.baud, this.onData);
      this.dispatchEvent(new Event('reconnected'));
    } catch (e) {
      this.port = null;
      this.dispatchEvent(new CustomEvent('reconnectfail', { detail: e }));
      this._emit();
    }
  }

  /* Reaproveita a porta já autorizada; só abre o seletor do navegador se necessário */
  async choosePort(forcePrompt = false) {
    if (this.port && !forcePrompt) return this.port;
    if (!forcePrompt) {
      const ports = await navigator.serial.getPorts();
      if (ports.length === 1) { this.port = ports[0]; this._emit(); return this.port; }
    }
    const p = await navigator.serial.requestPort();
    if (p !== this.port) await this.close();
    this.port = p;
    this._emit();
    return p;
  }

  async open(baud, onData) {
    if (this.mon) await this._closePort();
    const port = await this.choosePort();
    await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 16 * 1024 });
    this.baud = baud;
    this.onData = onData;
    this.wantOpen = true;
    this.lastInfo = port.getInfo?.() ?? null;
    const mon = { port, reading: true, reader: null, done: null };
    mon.done = (async () => {
      while (mon.reading && port.readable) {
        mon.reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await mon.reader.read();
            if (done) break;
            if (value?.length) onData(value);
          }
        } catch (e) {
          /* erro de leitura (ruído, framing, break): avisa e tenta de novo enquanto aberta */
          if (mon.reading) this.dispatchEvent(new CustomEvent('readerror', { detail: e }));
          await sleep(50);
        } finally {
          try { mon.reader.releaseLock(); } catch { /* ok */ }
        }
      }
    })();
    this.mon = mon;
    this._emit();
  }

  async _closePort() {
    const m = this.mon;
    if (!m) return;
    m.reading = false;
    try { await m.reader?.cancel(); } catch { /* ok */ }
    try { await m.done; } catch { /* ok */ }
    try { await m.port.close(); } catch { /* ok */ }
    this.mon = null;
  }

  /* Desconectar pelo botão: não reabre sozinho */
  async close() {
    this.wantOpen = false;
    await this._closePort();
    this._emit();
  }
}
