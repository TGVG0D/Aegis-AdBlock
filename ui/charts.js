import { esc, formatCompact, formatNumber, setHtml } from './shared.js';

function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
}

function pathFrom(points) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
}

export function lineChart(container, { series = [], height = 250, primary = 'blocked', secondary = 'requests', primaryColor = '#22d3ee', secondaryColor = '#a78bfa', primaryLabel = 'Bloqueados', secondaryLabel = 'Analisados' } = {}) {
  if (!container) return;
  if (!series.length) {
    setHtml(container, '<div class="empty"><strong>Sem dados ainda</strong><span>Navegue com a proteção ativa para gerar estatísticas.</span></div>');
    return;
  }
  const width = 900;
  const pad = { top: 18, right: 16, bottom: 28, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxValue = niceMax(
    Math.max(
      1,
      ...series.map((item) => Math.max(Number(item[primary]) || 0, Number(item[secondary]) || 0)),
    ),
  );
  const xFor = (index) => pad.left + (series.length === 1 ? plotW / 2 : (index / (series.length - 1)) * plotW);
  const yFor = (value) => pad.top + plotH - (Math.max(0, Number(value) || 0) / maxValue) * plotH;

  const primaryPoints = series.map((item, index) => ({ x: xFor(index), y: yFor(item[primary]), value: Number(item[primary]) || 0, label: item.label || '' }));
  const secondaryPoints = series.map((item, index) => ({ x: xFor(index), y: yFor(item[secondary]), value: Number(item[secondary]) || 0, label: item.label || '' }));

  const areaPath = `${pathFrom(primaryPoints)} L${xFor(series.length - 1).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${xFor(0).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;
  const labelEvery = Math.max(1, Math.ceil(series.length / 9));
  const grid = [];
  for (let step = 0; step <= 4; step += 1) {
    const value = (maxValue / 4) * step;
    const y = yFor(value);
    grid.push(`<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"/>`);
    grid.push(`<text class="axis-text" x="${pad.left - 9}" y="${y + 3}" text-anchor="end">${esc(formatCompact(Math.round(value)))}</text>`);
  }
  const xLabels = series
    .map((item, index) => {
      if (index % labelEvery !== 0 && index !== series.length - 1) return '';
      return `<text class="axis-text" x="${xFor(index)}" y="${height - 8}" text-anchor="middle">${esc(item.label || '')}</text>`;
    })
    .join('');
  const points = primaryPoints
    .map((point) => `<circle class="point" cx="${point.x}" cy="${point.y}" r="2.6" fill="${primaryColor}"><title>${esc(point.label)}: ${esc(formatNumber(point.value))} ${esc(primaryLabel.toLowerCase())}</title></circle>`)
    .join('');
  const svg = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Série temporal de ${esc(primaryLabel)} e ${esc(secondaryLabel)}">
      <defs>
        <linearGradient id="aegis-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${primaryColor}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${primaryColor}" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      ${grid.join('')}
      ${xLabels}
      <path class="area-path" d="${areaPath}" fill="url(#aegis-area)"/>
      <path class="line-secondary" d="${pathFrom(secondaryPoints)}" stroke="${secondaryColor}"/>
      <path class="line-path" d="${pathFrom(primaryPoints)}" stroke="${primaryColor}"/>
      ${points}
    </svg>`;
  setHtml(container, `${svg}
    <div class="chart-legend">
      <span class="key"><span class="swatch" style="background:${primaryColor}"></span>${esc(primaryLabel)}</span>
      <span class="key"><span class="swatch" style="background:${secondaryColor}"></span>${esc(secondaryLabel)}</span>
    </div>`);
}

export function donutChart(container, items = [], { totalLabel = 'eventos', size = 150 } = {}) {
  if (!container) return;
  const filtered = items.filter((item) => Number(item.value) > 0);
  const total = filtered.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  if (!filtered.length || total === 0) {
    setHtml(container, '<div class="empty"><strong>Sem dados no período</strong><span>Nada foi bloqueado ainda.</span></div>');
    return;
  }
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = filtered
    .map((item) => {
      const value = Number(item.value) || 0;
      const fraction = value / total;
      const length = fraction * circumference;
      const segment = `<circle cx="75" cy="75" r="${radius}" fill="none" stroke="${item.color || '#22d3ee'}" stroke-width="15" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" stroke-linecap="butt"><title>${esc(item.label)}: ${esc(formatNumber(value))}</title></circle>`;
      offset += length;
      return segment;
    })
    .join('');
  const legend = filtered
    .map(
      (item) => `<div class="row"><span class="category-dot" style="background:${item.color || '#22d3ee'}"></span><span class="name">${esc(item.label)}</span><span class="val">${esc(formatNumber(item.value))}</span></div>`,
    )
    .join('');
  setHtml(container, `
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 150 150" role="img" aria-label="Distribuição por categoria">
        <g class="donut-svg">
          <circle cx="75" cy="75" r="${radius}" fill="none" stroke="rgba(148,163,184,0.12)" stroke-width="15"/>
          ${segments}
        </g>
        <text class="donut-center" x="75" y="72" text-anchor="middle">${esc(formatCompact(total))}</text>
        <text class="donut-center-label" x="75" y="87" text-anchor="middle">${esc(totalLabel)}</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>`);
  void size;
}

export function barList(container, items = [], { color = '#22d3ee', empty = 'Sem dados.', max: forcedMax = 0 } = {}) {
  if (!container) return;
  const filtered = items.filter((item) => Number(item.value) > 0);
  if (!filtered.length) {
    setHtml(container, `<div class="empty"><strong>${esc(empty)}</strong></div>`);
    return;
  }
  const max = forcedMax || Math.max(...filtered.map((item) => Number(item.value) || 0), 1);
  setHtml(container, `<div class="bar-list">${filtered
    .map((item) => {
      const value = Number(item.value) || 0;
      const width = Math.max(2, (value / max) * 100);
      return `<div class="bar-row"><span class="name" title="${esc(item.label)}">${esc(item.label)}</span><span class="bar-track"><span class="bar-fill" style="width:${width}%;background:${item.color || color}"></span></span><span class="val">${esc(formatCompact(value))}</span></div>`;
    })
    .join('')}</div>`);
}

export function miniSparkline(values = [], { color = '#22d3ee', width = 120, height = 34 } = {}) {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (Number(value) / max) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
