import {
  CATEGORIES,
  categoryOptions,
  confirmDialog,
  emptyState,
  esc,
  formatNumber,
  icon,
  loadingState,
  modal,
  send,
  setBusy,
  setHtml,
  toast,
} from '../../ui/shared.js';

const EXAMPLE_SELECTOR = '##.promo-overlay';

function listLabel(list) {
  return CATEGORIES[list.category]?.label || list.category || 'Outros';
}

export async function render(view, ctx) {
  let disposed = false;
  let loading = null;
  let snapshot = { status: null, lists: [], rules: [] };
  let lastTest = null;

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!snapshot.status) setHtml(view, loadingState('Carregando filtros cosméticos…'));
      try {
        const [status, lists, rules] = await Promise.all([
          send('status.get'),
          send('lists.get'),
          send('rules.get'),
        ]);
        if (disposed) return;
        ctx.state.status = status;
        snapshot = { status, lists: lists.lists, rules };
        paint();
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao carregar os filtros cosméticos.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function cosmeticRules() {
    return snapshot.rules.filter((rule) => rule.parsed?.kind === 'cosmetic');
  }

  function paint() {
    const settings = snapshot.status.settings;
    const build = snapshot.status.engine?.build || {};
    const engine = build.engine || {};
    const cosmeticLists = snapshot.lists.filter((list) => (list.cosmeticCount || 0) > 0);
    const customCosmetic = cosmeticRules();
    const totalCosmetic = Number(build.cosmeticRules || 0);
    const generic = Number(engine.cosmeticGeneric || 0);
    const specific = Number(engine.cosmeticSpecific || 0);
    const enabled = settings.enabled && settings.cosmeticEnabled;

    setHtml(view, `
      <div class="grid grid-4">
        <div class="card kpi"><div class="kpi-label">${icon('cosmetic')}Regras cosméticas</div><div class="kpi-value">${esc(formatNumber(totalCosmetic))}</div><div class="kpi-sub">carregadas no motor</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('eye')}Específicas</div><div class="kpi-value">${esc(formatNumber(specific))}</div><div class="kpi-sub">vinculadas a um domínio</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('lists')}Genéricas</div><div class="kpi-value">${esc(formatNumber(generic))}</div><div class="kpi-sub">${settings.genericCosmetic ? 'aplicadas com limite de segurança' : 'desativadas nas configurações'}</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('shield')}Estado</div><div class="kpi-value" style="font-size:22px">${enabled ? 'Ativo' : 'Inativo'}</div><div class="kpi-sub">${esc(String(cosmeticLists.length))} lista(s) com seletores</div></div>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head">
            <div><h2>Ocultar elementos</h2><p>Teste os seletores que seriam aplicados em um domínio. Nada é injetado nesta página.</p></div>
            <span class="badge ${enabled ? 'green' : 'gray'}">${enabled ? 'Cosméticos ativos' : 'Cosméticos inativos'}</span>
          </div>
          <div class="inline-form">
            <div class="field" style="flex:2;min-width:220px">
              <label for="cs-host">Domínio para testar</label>
              <input class="input" id="cs-host" placeholder="exemplo.com" spellcheck="false" value="${esc(ctx.state.status?.site?.hostname || '')}">
            </div>
            <button class="btn btn-primary" id="cs-test">${icon('eye')}Testar</button>
            <button class="btn" id="cs-current" ${ctx.state.status?.site?.hostname ? '' : 'disabled'}>Usar site atual</button>
          </div>
          <div id="cs-result" class="mt-16">${emptyState('Nenhum teste executado', 'Informe um domínio para ver quantos seletores e exceções se aplicam.', 'cosmetic')}</div>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>Preferências cosméticas</h2><p>As mudanças valem imediatamente nas abas abertas.</p></div></div>
          <div class="flex-between" style="padding:6px 0">
            <div><div class="small soft">Ocultação cosmética</div><div class="tiny muted">Aplica regras <code>##</code> e <code>#@#</code> nos sites.</div></div>
            <label class="switch"><input type="checkbox" id="cs-enabled" ${settings.cosmeticEnabled ? 'checked' : ''}><span class="track"></span></label>
          </div>
          <div class="divider"></div>
          <div class="flex-between" style="padding:6px 0">
            <div><div class="small soft">Seletores genéricos</div><div class="tiny muted">Regras sem domínio, limitadas a ${esc(formatNumber(25000))} por página.</div></div>
            <label class="switch"><input type="checkbox" id="cs-generic" ${settings.genericCosmetic ? 'checked' : ''}><span class="track"></span></label>
          </div>
          <div class="divider"></div>
          <div class="tiny muted">A proteção global precisa estar ativa. Sites permitidos e listas desativadas não recebem regras cosméticas.</div>
        </section>
      </div>

      <section class="card mt-16">
        <div class="card-head">
          <div><h2>Seletores personalizados</h2><p>Regras cosméticas criadas por você, com escopo de domínio ou genérico.</p></div>
          <button class="btn btn-sm btn-primary" id="cs-add">${icon('plus')}Nova regra cosmética</button>
        </div>
        ${customCosmetic.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Ativa</th><th>Regra</th><th>Escopo</th><th>Categoria</th><th>Nota</th><th></th></tr></thead>
            <tbody>${customCosmetic.map(renderCustomRow).join('')}</tbody>
          </table></div>` : emptyState('Nenhuma regra cosmética personalizada', 'Use a sintaxe domínio##seletor para ocultar elementos específicos.', 'cosmetic')}
      </section>

      <section class="card mt-16">
        <div class="card-head"><div><h2>Listas com filtros cosméticos</h2><p>Somente listas ativas são usadas para montar o CSS da página.</p></div><span class="badge gray">${esc(String(cosmeticLists.length))} lista(s)</span></div>
        ${cosmeticLists.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Lista</th><th>Categoria</th><th>Cosméticas</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>${cosmeticLists
              .map(
                (list) => `<tr>
                  <td class="cell-main">${esc(list.name)}</td>
                  <td>${esc(listLabel(list))}</td>
                  <td>${esc(formatNumber(list.cosmeticCount || 0))}</td>
                  <td>${esc(formatNumber(list.ruleCount || 0))}</td>
                  <td>${list.enabled ? '<span class="badge green">Ativa</span>' : '<span class="badge gray">Desativada</span>'}</td>
                </tr>`,
              )
              .join('')}</tbody>
          </table></div>` : emptyState('Nenhuma lista com cosméticos', 'Ative uma lista que contenha regras ## ou #@#.', 'lists')}
      </section>

      <div class="notice info mt-16">${icon('info')}<div>Seletores passam por validação de sintaxe e listas de bloqueio muito amplas (como <code>*</code>, <code>body</code> ou <code>div</code>) são recusadas para não remover conteúdo essencial. O CSS é agrupado em <code>:is(...)</code> e aplicado dentro do escopo da página; a extensão nunca executa código das listas.</div></div>
    `);

    if (lastTest) renderTest(lastTest);
    bind();
  }

  function renderCustomRow(rule) {
    const parsed = rule.parsed || {};
    return `<tr>
      <td><label class="switch"><input type="checkbox" data-custom-toggle="${esc(rule.id)}" ${rule.enabled ? 'checked' : ''}><span class="track"></span></label></td>
      <td style="max-width:360px"><span class="rule-code" title="${esc(rule.rule)}">${esc(rule.rule)}</span></td>
      <td>${parsed.generic ? '<span class="badge amber">Genérica</span>' : `<span class="badge cyan">${esc((parsed.includeDomains || []).join(', ') || 'Domínio')}</span>`}</td>
      <td>${esc(CATEGORIES[rule.category]?.label || rule.category)}</td>
      <td class="truncate" style="max-width:180px">${esc(rule.note || '—')}</td>
      <td><div class="td-actions"><button class="btn btn-sm btn-danger" data-custom-delete="${esc(rule.id)}" title="Remover regra">${icon('trash')}</button></div></td>
    </tr>`;
  }

  function bind() {
    view.querySelector('#cs-enabled')?.addEventListener('change', async (event) => {
      await saveSettings({ cosmeticEnabled: event.target.checked }, event.target.checked ? 'Ocultação cosmética ativada.' : 'Ocultação cosmética desativada.');
    });
    view.querySelector('#cs-generic')?.addEventListener('change', async (event) => {
      await saveSettings({ genericCosmetic: event.target.checked }, event.target.checked ? 'Seletores genéricos ativados.' : 'Seletores genéricos desativados.');
    });

    const runTest = async () => {
      const host = view.querySelector('#cs-host')?.value.trim();
      if (!host) {
        toast('Informe um domínio para testar.', 'error');
        return;
      }
      const button = view.querySelector('#cs-test');
      setBusy(button, true, 'Testando');
      try {
        const result = await send('cosmetic.test', { hostname: host });
        if (disposed) return;
        lastTest = result;
        renderTest(result);
      } catch (error) {
        const box = view.querySelector('#cs-result');
        if (box) setHtml(box, `<div class="notice danger">${icon('alert')}<div>${esc(error.message)}</div></div>`);
      } finally {
        setBusy(button, false);
      }
    };
    view.querySelector('#cs-test')?.addEventListener('click', runTest);
    view.querySelector('#cs-host')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runTest();
    });
    view.querySelector('#cs-current')?.addEventListener('click', () => {
      const host = ctx.state.status?.site?.hostname;
      if (!host) return;
      const input = view.querySelector('#cs-host');
      if (input) input.value = host;
      runTest();
    });

    view.querySelector('#cs-add')?.addEventListener('click', openAddRule);
    view.querySelectorAll('[data-custom-toggle]').forEach((input) => {
      input.addEventListener('change', async () => {
        input.disabled = true;
        try {
          await send('rules.toggle', { id: input.dataset.customToggle, enabled: input.checked });
          await load();
        } catch (error) {
          toast(error.message, 'error');
          input.checked = !input.checked;
        } finally {
          input.disabled = false;
        }
      });
    });
    view.querySelectorAll('[data-custom-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const rule = customCosmetic().find((entry) => entry.id === button.dataset.customDelete);
        const confirmed = await confirmDialog({
          title: 'Remover regra cosmética',
          message: rule ? `A regra “${rule.rule}” será removida.` : 'Esta regra será removida.',
          confirmLabel: 'Remover',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await send('rules.delete', { id: button.dataset.customDelete });
          toast('Regra cosmética removida.', 'success');
          lastTest = null;
          await load();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  }

  function renderTest(result) {
    const box = view.querySelector('#cs-result');
    if (!box) return;
    if (!result.enabled) {
      setHtml(box, `<div class="notice">${icon('alert')}<div><strong>Cosméticos não estão sendo aplicados.</strong><div>Verifique a proteção global, a opção de ocultação cosmética, a pausa temporária ou a lista de sites permitidos.</div></div></div>`);
      return;
    }
    const preview = result.hide || [];
    setHtml(box, `
      <div class="stat-strip">
        <div><div class="label">Aplicados</div><div class="value">${esc(formatNumber(result.applied))}</div></div>
        <div><div class="label">Específicos</div><div class="value">${esc(formatNumber(result.specific))}</div></div>
        <div><div class="label">Genéricos</div><div class="value">${esc(formatNumber(result.generic))}</div></div>
        <div><div class="label">Exceções</div><div class="value">${esc(formatNumber((result.exceptions || []).length))}</div></div>
      </div>
      <div class="tiny muted mt-10">Domínio: <strong class="soft">${esc(result.hostname)}</strong>${result.truncated ? ' · prévia limitada aos primeiros 200 seletores' : ''}</div>
      ${preview.length ? `<div class="code-list mt-10" style="max-height:260px;overflow:auto">${preview
        .map((selector) => `<div class="code-item"><span title="${esc(selector)}">${esc(selector)}</span></div>`)
        .join('')}</div>` : '<div class="empty"><strong>Nenhum seletor para este domínio</strong><span>As listas ativas não ocultam elementos aqui.</span></div>'}
      ${result.exceptions?.length ? `<div class="tiny muted mt-10">Exceções consideradas: ${esc(result.exceptions.slice(0, 12).join(', '))}${result.exceptions.length > 12 ? '…' : ''}</div>` : ''}
    `);
  }

  async function saveSettings(patch, message) {
    try {
      const settings = await send('settings.update', { patch });
      ctx.state.status = { ...(ctx.state.status || {}), settings };
      toast(message, 'success');
      await load();
    } catch (error) {
      toast(error.message, 'error');
      await load();
    }
  }

  function openAddRule() {
    modal({
      title: 'Nova regra cosmética',
      body: `
        <div class="form-grid">
          <div class="field span-full">
            <label for="cs-rule">Regra</label>
            <textarea class="textarea" id="cs-rule" rows="3" spellcheck="false" placeholder="exemplo.com##.promo-overlay">${esc(EXAMPLE_SELECTOR)}</textarea>
            <div class="hint">Use <code>domínio##seletor</code> para escopo específico ou <code>##seletor</code> para genérico. Seletores amplos são recusados.</div>
          </div>
          <div class="field"><label for="cs-rule-category">Categoria</label><select class="select" id="cs-rule-category">${categoryOptions('annoyance')}</select></div>
          <div class="field"><label for="cs-rule-note">Nota (opcional)</label><input class="input" id="cs-rule-note" maxlength="300" placeholder="Motivo da regra"></div>
        </div>`,
      actions: [
        { label: 'Cancelar', value: null, className: 'btn-ghost' },
        {
          label: 'Adicionar',
          className: 'btn-primary',
          onClick: async ({ dialog, button, close }) => {
            const rule = dialog.querySelector('#cs-rule').value.trim();
            if (!rule) {
              toast('Informe a regra cosmética.', 'error');
              return false;
            }
            setBusy(button, true, 'Validando');
            try {
              await send('rules.add', {
                rule,
                category: dialog.querySelector('#cs-rule-category').value,
                note: dialog.querySelector('#cs-rule-note').value.trim(),
                enabled: true,
              });
              close(true);
              toast('Regra cosmética adicionada.', 'success');
              await load();
              return true;
            } catch (error) {
              toast(error.message, 'error');
              setBusy(button, false);
              return false;
            }
          },
        },
      ],
    });
  }

  const onEvent = (event) => {
    if (disposed) return;
    if (/^(lists|rules|settings|system|whitelist|protection)/.test(event.detail?.scope || '')) {
      setTimeout(() => {
        if (!disposed) load();
      }, 250);
    }
  };
  window.addEventListener('aegis:event', onEvent);

  await load();
  return () => {
    disposed = true;
    window.removeEventListener('aegis:event', onEvent);
  };
}
