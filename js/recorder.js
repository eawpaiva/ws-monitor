/* Gravação contínua das medições num arquivo escolhido pelo técnico (.csv ou .txt).
   Usa a File System Access API do Chrome/Edge: cada pacote é acrescentado e o arquivo é fechado logo em
   seguida, então o que já foi gravado fica no disco mesmo se o computador desligar. Ao parar, calcula o
   SHA-256 do arquivo (conferência de integridade para auditoria).
   Sem a API (navegador antigo), guarda na memória e baixa o arquivo ao parar. */
import { sha256Hex } from './util.js';

const TYPES = {
  csv: [{ description: 'Planilha CSV', accept: { 'text/csv': ['.csv'] } }],
  txt: [{ description: 'Texto', accept: { 'text/plain': ['.txt'] } }],
};

export class Recorder extends EventTarget {
  constructor() {
    super();
    this.active = false;
    this.reset();
  }

  static get direct() { return typeof window.showSaveFilePicker === 'function'; }

  reset() {
    this.handle = null;
    this.mem = null;
    this.name = '';
    this.format = 'csv';
    this.rows = 0;
    this.size = 0;
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.hash = null;
    this.error = null;
    this.queue = Promise.resolve();
  }

  _emit() { this.dispatchEvent(new Event('change')); }

  /* Abre o "Salvar como"; recusa (AbortError) se o técnico cancelar */
  async start({ format, suggestedName, header }) {
    this.reset();
    this.format = format;
    if (Recorder.direct) {
      this.handle = await window.showSaveFilePicker({ suggestedName, types: TYPES[format], excludeAcceptAllOption: false });
      this.name = this.handle.name;
      const w = await this.handle.createWritable({ keepExistingData: false });
      await w.write('﻿' + header);
      await w.close();
      this.size = (await this.handle.getFile()).size;
    } else {
      this.name = suggestedName;
      this.mem = ['﻿' + header];
      this.size = header.length;
    }
    this.startedAt = Date.now();
    this.active = true;
    this._emit();
  }

  /* Acrescenta texto (uma ou mais linhas) no fim do arquivo; as escritas ficam em fila */
  append(text, { row = true } = {}) {
    if (!this.active || !text) return this.queue;
    this.queue = this.queue.then(async () => {
      if (this.mem) { this.mem.push(text); this.size += text.length; }
      else await this._write(text);
      if (row) this.rows++;
      this._emit();
    }).catch((e) => {
      this.error = e;
      this.dispatchEvent(new CustomEvent('error', { detail: e }));
      this._emit();
    });
    return this.queue;
  }

  async _write(text) {
    const size = (await this.handle.getFile()).size;
    const w = await this.handle.createWritable({ keepExistingData: true });
    try {
      await w.seek(size);
      await w.write(text);
    } finally {
      await w.close();
    }
    this.size = (await this.handle.getFile()).size;
  }

  async stop(trailer = '') {
    if (!this.active) return null;
    if (trailer) this.append(trailer, { row: false });
    await this.queue;
    this.active = false;
    this.stoppedAt = Date.now();
    let bytes;
    if (this.mem) {
      bytes = new TextEncoder().encode(this.mem.join(''));
      const url = URL.createObjectURL(new Blob([bytes], { type: this.format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = this.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.mem = null;
    } else {
      bytes = new Uint8Array(await (await this.handle.getFile()).arrayBuffer());
    }
    this.size = bytes.length;
    this.hash = await sha256Hex(bytes);
    this._emit();
    return this.hash;
  }
}
