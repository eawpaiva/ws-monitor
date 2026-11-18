/* Componentes de interface: terminal de texto, diálogos, relógio, tela de abertura e caixas minimizáveis */
import { $, el, fmtTime, store } from './util.js';

/* Caixas minimizáveis: a mesma seta do "Log técnico" no título de cada card (div.card > h3). Clicar na
   seta ou no título minimiza/expande; botões, campos e listas do título continuam funcionando.
   O estado fica neste computador (localStorage), por card. */
const COLLAPSED_KEY = 'collapsedCards';
const cardKey = (card, h3) => card.id || 'h:' + ([...h3.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())?.textContent.trim() ?? '').slice(0, 48);
function setCollapsed(card, on, persist = true) {
  card.classList.toggle('collapsed', on);
  const btn = card.querySelector(':scope > h3 > .collapse');
  if (btn) {
    btn.setAttribute('aria-expanded', String(!on));
    btn.title = on ? 'Expandir' : 'Minimizar';
  }
  if (!persist || !card.dataset.ck) return;
  const set = new Set(store.get(COLLAPSED_KEY, []));
  if (on) set.add(card.dataset.ck); else set.delete(card.dataset.ck);
  store.set(COLLAPSED_KEY, [...set]);
}
export function expandCard(card) {
  if (card?.classList?.contains('collapsed')) setCollapsed(card, false);
}
export function initCollapsibleCards(root = document) {
  const saved = new Set(store.get(COLLAPSED_KEY, []));
  for (const card of root.querySelectorAll('div.card')) {
    const h3 = card.querySelector(':scope > h3');
    if (!h3 || h3.querySelector(':scope > .collapse')) continue;
    card.dataset.ck = cardKey(card, h3);
    const btn = el('button', { type: 'button', class: 'collapse', 'aria-expanded': 'true', title: 'Minimizar', 'aria-label': 'Minimizar ou expandir a caixa' });
    h3.prepend(btn);
    h3.classList.add('has-collapse');
    h3.addEventListener('click', (e) => {
      if (e.target !== btn && e.target.closest('button, a, input, select, textarea, label, .seg')) return;
      setCollapsed(card, !card.classList.contains('collapsed'));
    });
    if (saved.has(card.dataset.ck)) setCollapsed(card, true, false);
  }
}

/* Diálogo de confirmação (<dialog> nativo) */
export function confirmDialog({ title, html, ok = 'Confirmar', cancel = 'Cancelar', danger = false }) {
  const d = $('dlg');
  $('dlgTitle').textContent = title;
  $('dlgBody').innerHTML = html;
  const bOk = $('dlgOk');
  const bCancel = $('dlgCancel');
  bOk.textContent = ok;
  bOk.className = danger ? 'btn danger' : 'btn';
  bCancel.textContent = cancel;
  bCancel.classList.toggle('hide', cancel === null);
  return new Promise((resolve) => {
    const close = (v) => { d.close(); bOk.onclick = bCancel.onclick = d.oncancel = null; resolve(v); };
    bOk.onclick = () => close(true);
    bCancel.onclick = () => close(false);
    d.oncancel = (e) => { e.preventDefault(); close(false); };
    d.showModal();
  });
}

/* Diálogo de senha: só fecha com a senha correta ou ao cancelar */
export function passwordDialog({ title, html, ok = 'Entrar', check }) {
  const d = $('dlg');
  $('dlgTitle').textContent = title;
  $('dlgBody').innerHTML = `${html}<span class="inp"><input type="password" id="dlgPw" autocomplete="off" spellcheck="false" placeholder="Senha"></span><div class="dlg-err" id="dlgErr"></div>`;
  const bOk = $('dlgOk');
  const bCancel = $('dlgCancel');
  const input = $('dlgPw');
  bOk.textContent = ok;
  bOk.className = 'btn';
  bCancel.textContent = 'Cancelar';
  bCancel.classList.remove('hide');
  return new Promise((resolve) => {
    const close = (v) => { d.close(); bOk.onclick = bCancel.onclick = d.oncancel = input.onkeydown = null; resolve(v); };
    const submit = async () => {
      if (await check(input.value)) { close(true); return; }
      $('dlgErr').textContent = 'Senha incorreta.';
      input.select();
    };
    bOk.onclick = submit;
    bCancel.onclick = () => close(false);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    d.oncancel = (e) => { e.preventDefault(); close(false); };
    d.showModal();
    input.focus();
  });
}

/* Terminal de texto com cores simples (classes e/w/i/s/m) e limite de tamanho */
export class Term {
  constructor(pre, { maxChars = 400_000, onText = null } = {}) {
    this.onText = onText;
    this.pre = pre;
    this.max = maxChars;
    this.autoscroll = true;
    this.len = 0;
  }
  clear() { this.pre.replaceChildren(); this.len = 0; }
  text() { return this.pre.textContent; }
  append(text, cls, { silent = false } = {}) {
    if (!text) return;
    if (!silent) this.onText?.(text);
    const last = this.pre.lastChild;
    if (last && (last.className || '') === (cls || '') && last.textContent.length < 2000) {
      last.textContent += text;
    } else {
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = text;
      this.pre.append(span);
    }
    this.len += text.length;
    if (this.len > this.max) {
      while (this.pre.firstChild && this.len > this.max * 0.8) {
        this.len -= this.pre.firstChild.textContent.length;
        this.pre.firstChild.remove();
      }
    }
    if (this.autoscroll && !this.scrollQueued) {
      this.scrollQueued = true;
      requestAnimationFrame(() => { this.scrollQueued = false; this.pre.scrollTop = this.pre.scrollHeight; });
    }
  }
  line(text, cls) {
    this.append(`[${fmtTime()}] `, 'm');
    this.append(text + '\n', cls);
  }
}

export function startClock() {
  const d = $('clkDate'), t = $('clkTime');
  const tick = () => {
    const now = new Date();
    d.textContent = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const [hh, mm, ss] = fmtTime(now).split(':');
    t.innerHTML = `${hh}<span class="c">:</span>${mm}<span class="c">:</span>${ss}`;
  };
  tick();
  setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
}

/* Tela de abertura: mínimo de 1,8 s (fade do logo + pulso da seta), sai quando o app estiver pronto */
export function splash() {
  const t0 = Date.now();
  const node = $('splash');
  let gone = false;
  const done = () => {
    if (gone || !node) return;
    gone = true;
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 500);
    }, Math.max(0, 1800 - (Date.now() - t0)));
  };
  setTimeout(done, 4000);
  return done;
}
