const DAY_MS = 24 * 60 * 60 * 1000;

export function dayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dayKeyToDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function startOfDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function daysAgo(count, from = Date.now()) {
  return startOfDay(from) - count * DAY_MS;
}

export function recentDayKeys(count, from = Date.now()) {
  const keys = [];
  const today = startOfDay(from);
  for (let index = count - 1; index >= 0; index -= 1) {
    keys.push(dayKey(today - index * DAY_MS));
  }
  return keys;
}

export function dayLabel(key, { short = true } = {}) {
  try {
    const date = dayKeyToDate(key);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: short ? '2-digit' : 'short',
    }).format(date);
  } catch {
    return key;
  }
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(timestamp));
  } catch {
    return '—';
  }
}

export function formatDate(timestamp) {
  if (!timestamp) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(timestamp));
  } catch {
    return '—';
  }
}

export function formatRelative(timestamp) {
  if (!timestamp) return 'Nunca';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'Agora';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 45) return 'Agora há pouco';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ontem';
  if (days < 30) return `Há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  return formatDate(timestamp);
}

export function durationToMs(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const factors = { minutes: 60000, hours: 3600000, days: DAY_MS };
  return amount * (factors[unit] || 0);
}

export function isValidTimestamp(value) {
  return Number.isFinite(value) && value > 0;
}

export { DAY_MS };
