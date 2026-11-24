const numberFormatters = new Map();

function formatter(options) {
  const key = JSON.stringify(options);
  if (!numberFormatters.has(key)) {
    numberFormatters.set(key, new Intl.NumberFormat('pt-BR', options));
  }
  return numberFormatters.get(key);
}

export function formatNumber(value) {
  const number = Number(value) || 0;
  return formatter({ maximumFractionDigits: 0 }).format(number);
}

export function formatCompact(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) < 10000) return formatNumber(number);
  return formatter({ notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

export function formatPercent(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${formatter({ maximumFractionDigits: digits }).format(number)}%`;
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** index;
  return `${formatter({ maximumFractionDigits: size >= 10 ? 0 : 1 }).format(size)} ${units[index]}`;
}

export function truncate(value, max = 80) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function plural(value, singular, pluralForm) {
  return Number(value) === 1 ? singular : pluralForm;
}
