import {
  CATEGORIES,
  categoryOptions,
  confirmDialog,
  debounce,
  download,
  emptyState,
  esc,
  formatDateTime,
  formatNumber,
  formatRelative,
  historyLimitOptions,
  icon,
  loadingState,
  retentionOptions,
  send,
  setBusy,
  setHtml,
  toast,
  typeOptions,
} from '../../ui/shared.js';

const PAGE_SIZES = [25, 50, 100];

function dayStart(value) {
  if (!value) return 0;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day).getTime();
}

function dayEnd(value) {
  const start = dayStart(value);
  return start ? start + 24 * 60 * 60 * 1000 - 1 : 0;
}

export async function render(view, ctx) {
  let disposed = false;
  let loading = null;
  let listOptions = [];
  let summary = null;
  let result = { items: [], total: 0, page: 1, pageSize: 25, pages: 1 };
  const selected = new Set();
  const filters = {
    search: '',
    site: '',
    category: '',
    type: '',
    listId: '',
    from: '',
    to: '',
    pageSize: 25,
    page: 1,
  };

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!result.items.length) setHtml(view, loadingState('Consultando histórico local…'));
      try {
        const query = {
          page: filters.page,
          pageSize: filters.pageSize,
          search: filters.search,
          site: filters.site,
          category: filters.category,
          type: filters.type,
          listId: filters.listId,
          from: dayStart(filters.from),
          to: dayEnd(filters.to),
        };
        const [history, lists, summaryData] = await Promise.all([
          send('history.query', { filters: query }),
          listOptions.length ? Promise.resolve(null) : send('lists.get'),
          send('history.summary'),
        ]);
        if (disposed) return;
        result = history;
        summary = summaryData;
        if (lists) listOptions = lists.lists;
        if (result.page > result.pages && result.pages >= 1) {
          filters.page = result.pages;
          loading = null;
          return load();
        }
        paint();
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao consultar o histórico.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function paint() {
    const settings = summary?.settings || ctx.state.status?.settings?.history || {};
    const hasFilters = Boolean(filters.search || filters.site || filters.category || filters.type || filters.listId || filters.from || filters.to);
    const firstRow = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
    const lastRow = Math.min(result.total, result.page * result.pageSize);

    setHtml(view, `
      <div class="grid grid-4">
        <div class="card kpi"><div class="kpi-label">${icon('history')}Registros salvos</div><div class="kpi-value">${esc(formatNumber(summary?.count || result.total))}</div><div class="kpi-sub">${esc(formatNumber(result.total))} no filtro atual</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('download')}Mais antigo</div><div class="kpi-value" style="font-size:20px">${esc(summary?.oldest ? formatRelative(summary.oldest) : '—')}</div><div class="kpi-sub">${esc(summary?.oldest ? formatDateTime(summary.oldest) : 'sem dados')}</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('zap')}Mais recente</div><div class="kpi-value" style="font-size:20px">${esc(summary?.newest ? formatRelative(summary.newest) : '—')}</div><div class="kpi-sub">${esc(summary?.newest ? formatDateTime(summary.newest) : 'sem dados')}</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('settings')}Retenção</div><div class="kpi-value" style="font-size:20px">${esc(String(settings.retentionDays || 30))} dias</div><div class="kpi-sub">máx. ${esc(formatNumber(settings.maxEntries || 20000))} eventos</div></div>
      </div>

      <section class="card mt-16">
        <div class="card-head"><div><h2>Filtros</h2><p>Parâmetros de consulta nunca são armazenados; apenas host e caminho.</p></div><span class="badge ${settings.enabled === false ? 'gray' : 'green'}">${settings.enabled === false ? 'Histórico desligado' : 'Histórico ativo'}</span></div>
        <div class="form-grid">
          <div class="field span-2"><label for="hs-search">Buscar</label><input class="input" id="hs-search" placeholder="URL, site, regra ou lista" value="${esc(filters.search)}" spellcheck="false"></div>
          <div class="field"><label for="hs-site">Site</label><input class="input" id="hs-site" placeholder="exemplo.com" value="${esc(filters.site)}" spellcheck="false"></div>
          <div class="field"><label for="hs-category">Categoria</label><select class="select" id="hs-category">${categoryOptions(filters.category, { includeAll: true })}</select></div>
          <div class="field"><label for="hs-type">Tipo</label><select class="select" id="hs-type">${typeOptions(filters.type)}</select></div>
          <div class="field"><label for="hs-list">Lista</label><select class="select" id="hs-list"><option value="">Todas as listas</option>${listOptions.map((list) => `<option value="${esc(list.id)}" ${list.id === filters.listId ? 'selected' : ''}>${esc(list.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="hs-from">De</label><input class="input" id="hs-from" type="date" value="${esc(filters.from)}"></div>
          <div class="field"><label for="hs-to">Até</label><input class="input" id="hs-to" type="date" value="${esc(filters.to)}"></div>
          <div class="field span-full flex" style="gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-sm" id="hs-apply">Aplicar filtros</button>
            <button class="btn btn-sm btn-ghost" id="hs-reset" ${hasFilters ? '' : 'disabled'}>Limpar filtros</button>
            <span class="spacer" style="flex:1"></span>
            <label class="tiny muted" for="hs-page-size">Por página</label>
            <select class="select" id="hs-page-size" style="width:auto">${PAGE_SIZES.map((size) => `<option value="${size}" ${size === filters.pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select>
          </div>
        </div>
      </section>

      <section class="card mt-16">
        <div class="card-head">
          <div><h2>Eventos bloqueados</h2><p>${esc(formatNumber(result.total))} resultado(s). Exibindo ${esc(formatNumber(firstRow))}–${esc(formatNumber(lastRow))}.</p></div>
          <div class="card-actions">
            <button class="btn btn-sm" id="hs-delete" ${selected.size ? '' : 'disabled'}>${icon('trash')}Excluir selecionados (${esc(String(selected.size))})</button>
            <button class="btn btn-sm" id="hs-export" ${result.total ? '' : 'disabled'}>${icon('download')}Exportar CSV</button>
            <button class="btn btn-sm btn-danger" id="hs-clear" ${summary?.count ? '' : 'disabled'}>Limpar histórico</button>
          </div>
        </div>

        ${result.items.length ? `
          <div class="table-wrap"><table>
            <thead><tr>
              <th style="width:32px"><input type="checkbox" id="hs-select-all" aria-label="Selecionar página"></th>
              <th>Quando</th><th>Site</th><th>Recurso</th><th>Tipo</th><th>Categoria</th><th>Regra</th><th>Lista</th><th>Ocorr.</th>
            </tr></thead>
            <tbody>${result.items.map(renderRow).join('')}</tbody>
          </table></div>
          ${renderPagination()}
        ` : emptyState(hasFilters ? 'Nenhum resultado para estes filtros' : 'Nenhum bloqueio registrado', hasFilters ? 'Ajuste ou limpe os filtros para ver mais eventos.' : 'Navegue com a proteção ativa; os bloqueios aparecem aqui.', 'history')}
      </section>

      <div class="notice info mt-16">${icon('info')}<div>Limpeza automática: ${settings.autoCleanup === false ? 'desligada' : 'ligada'} · retenção de ${esc(String(settings.retentionDays || 30))} dias ou ${esc(formatNumber(settings.maxEntries || 20000))} eventos. Alterações em <a href="#/settings">Configurações</a>.</div></div>
    `);
    bind();
  }

  function renderRow(row) {
    const category = CATEGORIES[row.category] || CATEGORIES.other;
    const label = category.label;
    return `<tr>
      <td><input type="checkbox" data-select="${esc(row.id)}" ${selected.has(row.id) ? 'checked' : ''} aria-label="Selecionar registro"></td>
      <td class="nowrap" title="${esc(formatDateTime(row.ts))}">${esc(formatRelative(row.ts))}</td>
      <td class="truncate" style="max-width:150px" title="${esc(row.site)}">${esc(row.site || '—')}</td>
      <td style="max-width:300px"><div class="cell-main truncate" style="max-width:300px" title="${esc(row.url)}">${esc(row.url || '—')}</div></td>
      <td class="nowrap">${esc(row.type || '—')}</td>
      <td><span class="badge" style="background:${category.color}1f;color:${category.color};border-color:${category.color}3d">${esc(label)}</span></td>
      <td style="max-width:220px"><span class="rule-code" title="${esc(row.rule)}">${esc(row.rule || '—')}</span></td>
      <td class="truncate" style="max-width:140px">${esc(row.listName || row.listId || '—')}</td>
      <td>${esc(formatNumber(row.count || 1))}</td>
    </tr>`;
  }

  function renderPagination() {
    const pages = [];
    const total = result.pages;
    const current = result.page;
    const push = (page) => pages.push(`<button class="btn page-btn ${page === current ? 'active' : ''}" data-page="${page}">${page}</button>`);
    if (total <= 9) {
      for (let page = 1; page <= total; page += 1) push(page);
    } else {
      push(1);
      if (current > 4) pages.push('<span class="muted" style="padding:0 4px">…</span>');
      const start = Math.max(2, current - 2);
      const end = Math.min(total - 1, current + 2);
      for (let page = start; page <= end; page += 1) push(page);
      if (current < total - 3) pages.push('<span class="muted" style="padding:0 4px">…</span>');
      push(total);
    }
    return `<div class="pagination">
      <span>Página ${esc(String(current))} de ${esc(String(total))} · ${esc(formatNumber(result.total))} registro(s)</span>
      <div class="pages">
        <button class="btn page-btn" data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>Anterior</button>
        ${pages.join('')}
        <button class="btn page-btn" data-page="${current + 1}" ${current >= total ? 'disabled' : ''}>Próxima</button>
      </div>
    </div>`;
  }

  function setFilter(patch, { reload = true } = {}) {
    Object.assign(filters, patch);
    filters.page = 1;
    selected.clear();
    if (reload) load();
  }

  function bind() {
    const search = view.querySelector('#hs-search');
    const debouncedSearch = debounce(() => {
      if (search && search.value !== filters.search) setFilter({ search: search.value.trim() });
    }, 450);
    search?.addEventListener('input', debouncedSearch);

    view.querySelector('#hs-site')?.addEventListener('change', (event) => {
      setFilter({ site: event.target.value.trim() });
    });
    view.querySelector('#hs-category')?.addEventListener('change', (event) => {
      setFilter({ category: event.target.value });
    });
    view.querySelector('#hs-type')?.addEventListener('change', (event) => {
      setFilter({ type: event.target.value });
    });
    view.querySelector('#hs-list')?.addEventListener('change', (event) => {
      setFilter({ listId: event.target.value });
    });
    view.querySelector('#hs-from')?.addEventListener('change', (event) => {
      setFilter({ from: event.target.value });
    });
    view.querySelector('#hs-to')?.addEventListener('change', (event) => {
      setFilter({ to: event.target.value });
    });
    view.querySelector('#hs-page-size')?.addEventListener('change', (event) => {
      filters.pageSize = Number(event.target.value) || 25;
      setFilter({});
    });
    view.querySelector('#hs-apply')?.addEventListener('click', () => {
      setFilter({
        search: view.querySelector('#hs-search')?.value.trim() || '',
        site: view.querySelector('#hs-site')?.value.trim() || '',
        category: view.querySelector('#hs-category')?.value || '',
        type: view.querySelector('#hs-type')?.value || '',
        listId: view.querySelector('#hs-list')?.value || '',
        from: view.querySelector('#hs-from')?.value || '',
        to: view.querySelector('#hs-to')?.value || '',
      });
    });
    view.querySelector('#hs-reset')?.addEventListener('click', () => {
      Object.assign(filters, { search: '', site: '', category: '', type: '', listId: '', from: '', to: '', page: 1 });
      selected.clear();
      load();
    });

    view.querySelectorAll('[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const page = Number(button.dataset.page);
        if (!Number.isInteger(page) || page < 1 || page > result.pages || page === filters.page) return;
        filters.page = page;
        selected.clear();
        load();
      });
    });

    view.querySelectorAll('[data-select]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const id = Number(checkbox.dataset.select);
        if (checkbox.checked) selected.add(id);
        else selected.delete(id);
        const deleteButton = view.querySelector('#hs-delete');
        if (deleteButton) {
          deleteButton.disabled = selected.size === 0;
          setHtml(deleteButton, `${icon('trash')}Excluir selecionados (${esc(String(selected.size))})`);
        }
      });
    });
    view.querySelector('#hs-select-all')?.addEventListener('change', (event) => {
      for (const row of result.items) {
        if (event.target.checked) selected.add(row.id);
        else selected.delete(row.id);
      }
      view.querySelectorAll('[data-select]').forEach((checkbox) => {
        checkbox.checked = event.target.checked;
      });
      const deleteButton = view.querySelector('#hs-delete');
      if (deleteButton) {
        deleteButton.disabled = selected.size === 0;
        setHtml(deleteButton, `${icon('trash')}Excluir selecionados (${esc(String(selected.size))})`);
      }
    });

    view.querySelector('#hs-delete')?.addEventListener('click', async () => {
      if (!selected.size) return;
      const confirmed = await confirmDialog({
        title: 'Excluir registros',
        message: `${selected.size} registro(s) selecionado(s) serão removidos permanentemente.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!confirmed) return;
      try {
        const resultDelete = await send('history.delete', { ids: [...selected] });
        toast(`${resultDelete.deleted} registro(s) excluído(s).`, 'success');
        selected.clear();
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    view.querySelector('#hs-export')?.addEventListener('click', async (event) => {
      setBusy(event.currentTarget, true, 'Exportando');
      try {
        const exported = await send('history.export', {
          filters: {
            search: filters.search,
            site: filters.site,
            category: filters.category,
            type: filters.type,
            listId: filters.listId,
            from: dayStart(filters.from),
            to: dayEnd(filters.to),
          },
        });
        download(exported.filename, exported.csv, 'text/csv;charset=utf-8');
        toast(`${formatNumber(exported.rows)} registro(s) exportado(s).`, 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    });

    view.querySelector('#hs-clear')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Limpar todo o histórico',
        message: 'Todos os eventos detalhados de bloqueio serão apagados. Estatísticas agregadas permanecem. Esta ação não pode ser desfeita.',
        confirmLabel: 'Limpar histórico',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await send('history.clear');
        selected.clear();
        toast('Histórico apagado.', 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  const onEvent = (event) => {
    if (disposed) return;
    if (/^(history|settings|system)/.test(event.detail?.scope || '')) {
      setTimeout(() => {
        if (!disposed) load();
      }, 400);
    }
  };
  window.addEventListener('aegis:event', onEvent);

  await load();
  return () => {
    disposed = true;
    window.removeEventListener('aegis:event', onEvent);
  };
}
