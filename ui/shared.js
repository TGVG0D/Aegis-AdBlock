import {
  AUTO_UPDATE_HOURS,
  CATEGORIES,
  CATEGORY_ORDER,
  HISTORY_LIMITS,
  HISTORY_RETENTION_DAYS,
  LIMITS,
  TEMP_DURATIONS,
  TYPE_LABELS,
  USER_CATEGORIES,
} from '../engine/constants.js';
import { getApi, sendMessage } from '../utils/browser.js';
import {
  formatDate,
  formatDateTime,
  formatRelative,
} from '../utils/dates.js';
import { formatBytes, formatCompact, formatNumber, formatPercent, plural, truncate } from '../utils/format.js';

export { formatBytes, formatCompact, formatDate, formatDateTime, formatNumber, formatPercent, formatRelative, plural, truncate };

export const ICONS = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.6 3 8.1 7 10 4-1.9 7-5.4 7-10V6l-7-3Z"/><path d="m9.2 12.2 1.9 1.9 3.8-4"/></svg>',
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  lists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
  rules: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3.5 2"/></svg>',
  cosmetic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2L12 3Z"/><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V22a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.66 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15.1 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.1a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.03Z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V5m0 0 4 4m-4-4L8 9M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m7 4 13 8-13 8V4Z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
};

export function icon(name, className = '') {
  return `<span class="icon ${className}" aria-hidden="true">${ICONS[name] || ICONS.info}</span>`;
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function send(type, payload = {}) {
  const response = await sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'Falha na comunicação com a extensão.');
  return response.data;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

export function categoryInfo(category) {
  return CATEGORIES[category] || CATEGORIES.other;
}

export function categoryOptions(selected = '', { includeAll = false } = {}) {
  const options = [];
  if (includeAll) options.push('<option value="">Todas as categorias</option>');
  for (const id of CATEGORY_ORDER) {
    options.push(`<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(CATEGORIES[id].label)}</option>`);
  }
  return options.join('');
}

export function typeOptions(selected = '') {
  return ['', ...Object.keys(TYPE_LABELS)]
    .map((type) => `<option value="${type}" ${type === selected ? 'selected' : ''}>${type ? esc(TYPE_LABELS[type]) : 'Todos os tipos'}</option>`)
    .join('');
}

export function updateIntervalOptions(selected) {
  return AUTO_UPDATE_HOURS.map((hours) => {
    const label = hours === 168 ? 'A cada 7 dias' : `A cada ${hours} horas`;
    return `<option value="${hours}" ${Number(selected) === hours ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

export function retentionOptions(selected) {
  return HISTORY_RETENTION_DAYS.map((days) => {
    const label = days === 1 ? '1 dia' : `${days} dias`;
    return `<option value="${days}" ${Number(selected) === days ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

export function historyLimitOptions(selected) {
  return HISTORY_LIMITS.map((limit) => `<option value="${limit}" ${Number(selected) === limit ? 'selected' : ''}>${formatNumber(limit)} eventos</option>`).join('');
}

export function tempDurationOptions(selected = '1h') {
  return TEMP_DURATIONS.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${esc(item.label)}</option>`).join('');
}

export function formatRemaining(ms) {
  if (!ms || ms <= 0) return 'expirado';
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms >= day) return `${Math.ceil(ms / day)} ${plural(Math.ceil(ms / day), 'dia', 'dias')}`;
  if (ms >= hour) return `${Math.ceil(ms / hour)} h`;
  return `${Math.max(1, Math.ceil(ms / minute))} min`;
}

export function statusBadge(kind) {
  if (kind === 'paused') return '<span class="badge amber"><span class="dot"></span>Pausado</span>';
  if (kind === 'off') return '<span class="badge red"><span class="dot"></span>Desativado</span>';
  if (kind === 'whitelisted') return '<span class="badge gray"><span class="dot"></span>Site permitido</span>';
  return '<span class="badge green"><span class="dot"></span>Protegido</span>';
}

export function listStatusBadge(list) {
  if (list.status === 'error') return '<span class="badge red">Erro</span>';
  if (list.status === 'pending') return '<span class="badge amber">Pendente</span>';
  if (list.status === 'never') return '<span class="badge gray">Nunca atualizada</span>';
  return '<span class="badge green">OK</span>';
}

export function emptyState(title, text = '', iconName = 'info') {
  return `<div class="empty">${icon(iconName)}<strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
}

export function loadingState(text = 'Carregando…') {
  return `<div class="loading"><span class="spinner"></span>${esc(text)}</div>`;
}

export function errorState(error) {
  return `<div class="notice danger">${icon('alert')}<div><strong>Não foi possível carregar.</strong><div>${esc(error?.message || error)}</div></div></div>`;
}

export function setBusy(button, busy, label = '') {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    setHtml(button, `<span class="spinner"></span>${esc(label)}`);
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) setHtml(button, button.dataset.originalHtml);
  }
}

export function setHtml(element, html) {
  // Substitui o conteúdo sem usar innerHTML, evitando XSS por dados não
  // sanitizados. O DOMParser não executa scripts, tornando a operação segura.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  element.replaceChildren(...doc.body.children);
}

export function toast(message, kind = 'info', timeout = 4200) {
  let stack = qs('#toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const node = document.createElement('div');
  node.className = `toast ${kind === 'error' ? 'bad' : kind === 'success' ? 'good' : ''}`;
  setHtml(node, `<span class="toast-icon">${kind === 'error' ? ICONS.alert : kind === 'success' ? ICONS.check : ICONS.info}</span><div class="toast-body">${esc(message)}</div><button class="toast-close" aria-label="Fechar">×</button>`);
  node.querySelector('.toast-close').addEventListener('click', () => node.remove());
  stack.appendChild(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
}

export function modal({ title, body, actions = [], width = '' }) {
  return new Promise((resolve) => {
    let backdrop = qs('#aegis-modal');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'aegis-modal';
      backdrop.className = 'modal-backdrop';
      setHtml(backdrop, '<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2></h2><button class="modal-close" aria-label="Fechar">×</button></div><div class="modal-body"></div><div class="modal-actions"></div></div>');
      document.body.appendChild(backdrop);
    }
    const dialog = backdrop.querySelector('.modal');
    if (width) dialog.style.width = width;
    else dialog.style.width = '';
    backdrop.querySelector('.modal-head h2').textContent = title || '';
    setHtml(backdrop.querySelector('.modal-body'), body || '');
    const actionBox = backdrop.querySelector('.modal-actions');
    actionBox.replaceChildren();
    const close = (value) => {
      backdrop.hidden = true;
      backdrop.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('.modal-close').onclick = () => close(null);
    backdrop.onclick = (event) => {
      if (event.target === backdrop) close(null);
    };
    actions.forEach((action) => {
      const button = document.createElement('button');
      button.className = `btn ${action.className || ''}`;
      button.textContent = action.label;
      if (action.id) button.id = action.id;
      button.onclick = async () => {
        if (action.onClick) {
          const result = await action.onClick({ close, dialog, button });
          if (result !== false) close(result ?? true);
        } else {
          close(action.value ?? true);
        }
      };
      actionBox.appendChild(button);
    });
    backdrop.hidden = false;
    const focusable = backdrop.querySelector('input, textarea, select, button');
    focusable?.focus();
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  const result = await modal({
    title,
    body: `<p>${esc(message)}</p>`,
    actions: [
      { label: 'Cancelar', value: false, className: 'btn-ghost' },
      { label: confirmLabel, value: true, className: danger ? 'btn-danger' : 'btn-primary' },
    ],
  });
  return result === true;
}

export function download(filename, content, type = 'application/json;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado para a área de transferência.', 'success');
    return true;
  } catch {
    toast('Não foi possível copiar.', 'error');
    return false;
  }
}

export function pickFile(accept = '.txt,.hosts,text/plain') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > LIMITS.maxListBytes) {
        toast(`Arquivo maior que ${formatBytes(LIMITS.maxListBytes)}.`, 'error');
        return resolve(null);
      }
      resolve({ name: file.name, text: await file.text() });
    };
    input.click();
  });
}

export function pickJson() {
  return pickFile('.json,application/json');
}

export function onBackgroundEvent(handler) {
  const api = getApi();
  if (!api?.runtime?.onMessage) return () => {};
  const listener = (message) => {
    if (message?.type === 'event' && message.event) {
      try {
        handler(message.event);
      } catch (error) {
        console.warn('[Aegis UI] handler de evento falhou', error);
      }
    }
  };
  api.runtime.onMessage.addListener(listener);
  return () => api.runtime.onMessage.removeListener(listener);
}

export function navigate(route) {
  location.hash = `#/${route}`;
}

export function variantClass(category) {
  const map = { ads: 'cyan', tracking: 'violet', malware: 'red', annoyance: 'amber', other: 'gray', mixed: 'cyan' };
  return map[category] || 'gray';
}

export { CATEGORIES, CATEGORY_ORDER, TYPE_LABELS, USER_CATEGORIES };
