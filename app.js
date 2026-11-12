import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const categoryIcons = { Vivienda: '⌂', Suministros: 'ϟ', Transporte: '↗', Suscripciones: '♫', Seguros: '✳', Otros: '◈' };
const categoryClasses = { Vivienda: 'cat-vivienda', Suministros: 'cat-suministros', Transporte: 'cat-transporte', Suscripciones: 'cat-suscripciones', Seguros: 'cat-seguros', Otros: 'cat-otros' };
const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const monthFormatter = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const monthName = (month) => new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(new Date(2025, Number(month) - 1, 1));
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const expenseDateLabel = (value) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00`));
const isDueInMonth = (item, date) => {
  const month = date.getMonth() + 1;
  if (item.frequency === 'annual') return Number(item.annual_month) === month;
  if (item.frequency === 'quarterly') return (month - Number(item.annual_month) + 12) % 3 === 0;
  return true;
};
const $ = (selector) => document.querySelector(selector);
let currentUser = null;
let expenses = [];
let fixedTemplates = [];
let listExpenses = [];
let viewedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let busy = false;
const bankNames = ['Santander', 'ING', 'Revolut'];
const setOptions = (select, options) => {
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
};
function createBankField(id, labelText, parent, before) {
  const label = document.createElement('label');
  label.className = 'form-field';
  label.htmlFor = id;
  label.append(document.createTextNode(labelText));
  const select = document.createElement('select');
  select.id = id;
  select.required = true;
  setOptions(select, [['', 'Selecciona un banco'], ...bankNames.map((name) => [name, name]), ['Sin asignar', 'Sin asignar']]);
  label.append(select);
  parent.insertBefore(label, before);
  return select;
}
const expenseBankSelect = createBankField('expense-bank', 'Banco', $('#expense-form'), $('#expense-form .dialog-actions'));
const csvBankSelect = createBankField('csv-bank', 'Banco del extracto', $('#csv-dialog'), $('#csv-summary'));
const bankFilterSelect = document.createElement('select');
bankFilterSelect.id = 'bank-filter';
bankFilterSelect.setAttribute('aria-label', 'Filtrar por banco');
setOptions(bankFilterSelect, [['all', 'Todos los bancos'], ...bankNames.map((name) => [name, name]), ['Sin asignar', 'Sin asignar']]);
$('#filter').insertAdjacentElement('afterend', bankFilterSelect);
const typeFilterSelect = document.createElement('select');
typeFilterSelect.id = 'type-filter';
typeFilterSelect.setAttribute('aria-label', 'Filtrar por tipo de gasto');
setOptions(typeFilterSelect, [['all', 'Fijos y variables'], ['fixed', 'Gastos fijos'], ['variable', 'Gastos variables']]);
bankFilterSelect.insertAdjacentElement('afterend', typeFilterSelect);
const frequencyFilterSelect = document.createElement('select');
frequencyFilterSelect.id = 'frequency-filter';
frequencyFilterSelect.setAttribute('aria-label', 'Filtrar por frecuencia');
setOptions(frequencyFilterSelect, [['all', 'Todas las frecuencias'], ['monthly', 'Mensuales'], ['quarterly', 'Trimestrales'], ['annual', 'Anuales'], ['variable', 'Gastos variables']]);
typeFilterSelect.insertAdjacentElement('afterend', frequencyFilterSelect);
const monthKey = (date = viewedMonth) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const isPaid = (expense) => expense.paid;
const dayLabel = (day) => day === 1 ? '1 de cada mes' : `Día ${day}`;

function message(text, error = false) {
  const target = $('#auth-message');
  target.textContent = text;
  target.style.color = error ? '#b23d48' : '#55535c';
}

async function showApp(user) {
  currentUser = user;
  $('#auth-screen').hidden = true;
  document.querySelector('.app-shell').hidden = false;
  await loadMonth();
}

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  message('Comprobando acceso…');
  const { error } = await supabase.auth.signInWithPassword({ email: $('#auth-email').value.trim(), password: $('#auth-password').value });
  if (error) return message('No se pudo iniciar sesión. Comprueba el correo y la contraseña.', true);
  const { data } = await supabase.auth.getUser();
  await showApp(data.user);
});
$('#sign-out')?.addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });

async function loadMonth() {
  if (!currentUser) return;
  const month = monthKey();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const { data: templates, error: templateError } = await supabase.from('fixed_expenses').select('*').eq('active', true).order('created_at');
  if (templateError) return showError(templateError);
  fixedTemplates = templates || [];
  // Only create recurring snapshots for the current and future months. A missing
  // past month means there is no historical record; never invent one from today's template.
  if (month >= currentMonth) {
    const dueTemplates = fixedTemplates.filter((item) => isDueInMonth(item, viewedMonth));
    if (dueTemplates.length) {
      const { error: seedError } = await supabase.from('monthly_expenses').upsert(
        dueTemplates.map((item) => ({ user_id: currentUser.id, fixed_expense_id: item.id, month, name: item.name, amount: item.amount, due_day: item.due_day, category: item.category, bank: item.bank || 'Sin asignar', frequency: item.frequency, annual_month: item.annual_month })),
        { onConflict: 'user_id,fixed_expense_id,month', ignoreDuplicates: true },
      );
      if (seedError) return showError(seedError);
    }
  }
  const { data, error } = await supabase.from('monthly_expenses').select('*').eq('month', month).order('due_day').order('name');
  if (error) return showError(error);
  const nextMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 1);
  const { data: variableData, error: variableError } = await supabase.from('variable_expenses').select('*').gte('expense_date', month).lt('expense_date', dateKey(nextMonth)).order('expense_date').order('name');
  if (variableError) return showError(variableError);
  expenses = [...(data || []).map((item) => ({ ...item, source: 'fixed' })), ...(variableData || []).map((item) => ({ ...item, source: 'variable', frequency: 'variable', paid: true, due_day: new Date(`${item.expense_date}T00:00:00`).getDate() }))];
  render();
}

function showError(error) {
  console.error(error);
  $('#expense-list').innerHTML = `<div class="empty-state"><h3>No se pudieron cargar tus gastos</h3><p>${escapeHtml(error.message || 'Revisa la conexión y las políticas RLS de Supabase.')}</p></div>`;
}

function render() {
  const label = monthFormatter.format(viewedMonth);
  $('#month-label').textContent = label.charAt(0).toLocaleUpperCase('es-ES') + label.slice(1);
  const monthExpenses = [...expenses].sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name, 'es'));
  const bankFilter = bankFilterSelect.value;
  const typeFilter = typeFilterSelect.value;
  const frequencyFilter = frequencyFilterSelect.value;
  const recurringItems = frequencyFilter === 'all' || frequencyFilter === 'variable'
    ? monthExpenses.filter((item) => frequencyFilter === 'all' || item.source === 'variable')
    : fixedTemplates
      .filter((item) => item.frequency === frequencyFilter)
      .map((template) => {
        const snapshot = monthExpenses.find((item) => item.source === 'fixed' && item.fixed_expense_id === template.id);
        return {
          ...(snapshot || {}),
          ...template,
          id: snapshot?.id || template.id,
          fixed_expense_id: template.id,
          source: 'fixed',
          monthly_expense_id: snapshot?.id || null,
          hasSnapshot: Boolean(snapshot),
          paid: snapshot?.paid || false,
        };
      });
  listExpenses = recurringItems.sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name, 'es'));
  const filtered = listExpenses.filter((item) => (bankFilter === 'all' || (item.bank || 'Sin asignar') === bankFilter) && (typeFilter === 'all' || item.source === typeFilter));
  const summaryItems = monthExpenses.filter((item) => (bankFilter === 'all' || (item.bank || 'Sin asignar') === bankFilter) && (typeFilter === 'all' || item.source === typeFilter) && (frequencyFilter === 'all' || item.frequency === frequencyFilter));
  const monthlyTotal = summaryItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const cycleTotal = frequencyFilter === 'all' ? null : filtered.reduce((sum, item) => sum + Number(item.amount), 0);
  const fixedItems = summaryItems.filter((item) => item.source !== 'variable');
  const variableItems = summaryItems.filter((item) => item.source === 'variable');
  const fixedPaidItems = fixedItems.filter(isPaid);
  const fixedPendingItems = fixedItems.filter((item) => !isPaid(item));
  const fixedPaidTotal = fixedPaidItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const variablePaidTotal = variableItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const fixedPaidLabel = `${fixedPaidItems.length} ${fixedPaidItems.length === 1 ? 'fijo pagado' : 'fijos pagados'}`;
  const variablePaidLabel = `${variableItems.length} ${variableItems.length === 1 ? 'variable pagado' : 'variables pagados'}`;
  const paidTotal = fixedPaidTotal + variablePaidTotal;
  const pendingTotal = fixedPendingItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const progress = monthlyTotal ? Math.round(paidTotal / monthlyTotal * 100) : 0;
  const totalLabels = { monthly: 'Pagos mensuales', quarterly: 'Pagos trimestrales', annual: 'Pagos anuales', variable: 'Gastos variables del mes' };
  const totalFooters = { monthly: 'Suma de los importes mensuales', quarterly: 'Suma de los importes trimestrales', annual: 'Suma anual, independientemente del mes de pago', variable: `${variableItems.length} gastos variables del mes` };
  const hasFrequencyFilter = frequencyFilter !== 'all';
  $('.total-card .stat-top span').textContent = totalLabels[frequencyFilter] || 'Gastos del mes';
  $('#total-value').textContent = money.format(cycleTotal ?? paidTotal);
  $('#pending-title').textContent = hasFrequencyFilter ? 'Por pagar este mes' : 'Gastos por pagar';
  $('#paid-title').textContent = hasFrequencyFilter ? 'Fijos pagados este mes' : 'Fijos pagados';
  $('#variable-paid-title').textContent = hasFrequencyFilter ? 'Variables este mes' : 'Variables pagados';
  $('#pending-value').textContent = money.format(pendingTotal);
  $('#paid-value').textContent = money.format(fixedPaidTotal);
  $('#variable-paid-value').textContent = money.format(variablePaidTotal);
  $('#total-foot').textContent = totalFooters[frequencyFilter] || `${fixedPaidLabel} + ${variablePaidLabel}`;
  $('#pending-foot').textContent = `${fixedPendingItems.length} ${fixedPendingItems.length === 1 ? 'fijo' : 'fijos'} por pagar`;
  $('#paid-foot').textContent = `${fixedPaidItems.length} de ${fixedItems.length} gastos fijos pagados`;
  $('#variable-paid-foot').textContent = `${variableItems.length} ${variableItems.length === 1 ? 'gasto variable registrado' : 'gastos variables registrados'}`;
  $('#progress-label').textContent = `${progress} % pagado`;
  $('#progress-fill').style.width = `${progress}%`;
  $('#footer-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'gasto' : 'gastos'} mostrados`;
  $('#today-label').textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  $('.progress-section').hidden = frequencyFilter !== 'all';
  const query = $('#search').value.trim().toLocaleLowerCase('es');
  const filter = $('#filter').value;
  const visible = filtered.filter((item) => `${item.name} ${item.category} ${item.bank || 'Sin asignar'}`.toLocaleLowerCase('es').includes(query) && (filter === 'all' || (item.hasSnapshot !== false && (filter === 'paid' ? isPaid(item) : !isPaid(item)))));
  const list = $('#expense-list');
  if (!visible.length) {
    const noExpenses = monthExpenses.length === 0 && fixedTemplates.length === 0;
    const noMatches = filtered.length === 0 && !noExpenses;
    list.innerHTML = `<div class="empty-state"><div class="empty-illustration">${noExpenses ? '✳' : '⌕'}</div><h3>${noExpenses ? 'Tu lista empieza aquí' : noMatches ? 'No hay gastos para estos filtros' : 'No encontramos ese gasto'}</h3><p>${noExpenses ? 'Añade un gasto fijo o registra un gasto puntual con su fecha.' : noMatches ? 'Prueba otro banco, tipo o frecuencia.' : 'Prueba otra búsqueda o cambia el filtro.'}</p>${noExpenses ? '<button class="primary-button" data-action="add-fixed"><span>＋</span> Añadir gasto fijo</button> <button class="cancel-button" data-action="add-variable">Registrar gasto variable</button>' : ''}</div>`;
    return;
  }
  list.innerHTML = visible.map((item) => {
    const category = categoryIcons[item.category] ? item.category : 'Otros';
    const frequency = item.source === 'variable' ? 'Gasto variable' : item.frequency === 'annual' ? `Anual · ${monthName(item.annual_month)}` : item.frequency === 'quarterly' ? `Trimestral · desde ${monthName(item.annual_month)}` : 'Mensual';
    const dateLabel = item.source === 'variable' ? expenseDateLabel(item.expense_date) : dayLabel(item.due_day);
    const status = item.source === 'variable' ? '<span class="status-pill status-paid">✓ Registrado</span>' : item.hasSnapshot === false ? '<span class="status-pill status-pending">Programado</span>' : `<button class="status-pill ${item.paid ? 'status-paid' : 'status-pending'}" data-action="toggle">${item.paid ? '✓ Pagado' : '◷ Por pagar'}</button>`;
    return `<article class="expense-row" data-id="${escapeHtml(item.id)}" data-source="${item.source}"><div class="expense-name"><span class="category-icon ${categoryClasses[category]}" aria-hidden="true">${categoryIcons[category]}</span><div><div class="expense-title">${escapeHtml(item.name)}</div><div class="expense-category-label">${escapeHtml(category)} · ${escapeHtml(item.bank || 'Sin asignar')}</div></div></div><div class="row-meta"><div class="row-label">${item.source === 'variable' ? 'FECHA' : 'VENCIMIENTO'}</div><div class="row-value">${escapeHtml(dateLabel)}</div></div><div class="row-meta"><div class="row-label">TIPO</div><div class="row-value">${escapeHtml(frequency)}</div></div><div class="amount-meta"><div class="row-label">IMPORTE</div><div class="row-value amount-value">${money.format(item.amount)}</div></div>${status}<div class="row-actions"><button class="icon-button" data-action="edit" aria-label="Editar ${escapeHtml(item.name)}" title="Editar">✎</button><button class="icon-button" data-action="delete" aria-label="Eliminar ${escapeHtml(item.name)}" title="Eliminar">×</button></div></article>`;
  }).join('');
}

function openDialog(item = null, source = 'fixed') {
  $('#expense-form').reset();
  $('#expense-id').value = source === 'variable' ? (item?.id || '') : (item?.fixed_expense_id || '');
  $('#expense-source').value = source;
  $('#expense-name').value = item?.name || '';
  $('#expense-amount').value = item?.amount ?? '';
  $('#expense-day').value = item?.due_day ?? 1;
  $('#expense-category').value = item?.category || 'Vivienda';
  $('#expense-bank').value = item?.bank || (item ? 'Sin asignar' : '');
  $('#expense-frequency').value = item?.frequency || 'monthly';
  $('#expense-annual-month').value = item?.annual_month ?? viewedMonth.getMonth() + 1;
  const now = new Date();
  const defaultDate = viewedMonth.getFullYear() === now.getFullYear() && viewedMonth.getMonth() === now.getMonth() ? now : viewedMonth;
  $('#expense-date').value = item?.expense_date || dateKey(defaultDate);
  $('#expense-date').disabled = source !== 'variable';
  $('#expense-day').disabled = source === 'variable';
  $('#expense-frequency').disabled = source === 'variable';
  $('#expense-annual-month').disabled = source === 'variable';
  $('#expense-date-field').hidden = source !== 'variable';
  $('#fixed-frequency-field').hidden = source === 'variable';
  $('#fixed-month-field').hidden = source === 'variable';
  $('#fixed-day-field').hidden = source === 'variable';
  updateFrequencyFields();
  $('#dialog-title').textContent = item ? (source === 'variable' ? 'Edita tu gasto variable' : 'Edita tu gasto fijo') : (source === 'variable' ? 'Registra un gasto variable' : 'Añade un gasto fijo');
  $('#expense-dialog').showModal();
  $('#expense-name').focus();
}
function updateFrequencyFields() {
  const frequency = $('#expense-frequency').value;
  const scheduled = frequency !== 'monthly';
  $('#fixed-month-field').hidden = !scheduled || $('#expense-source').value === 'variable';
  $('#annual-month-label').textContent = frequency === 'annual' ? 'Mes de pago' : 'Mes del primer pago';
  $('#expense-amount-unit').textContent = $('#expense-source').value === 'variable' ? '€' : frequency === 'annual' ? '€ / año' : frequency === 'quarterly' ? '€ / trimestre' : '€ / mes';
}
$('#add-expense').addEventListener('click', () => openDialog());
$('#add-variable-expense').addEventListener('click', () => openDialog(null, 'variable'));
$('#mobile-add')?.addEventListener('click', () => openDialog());
$('#expense-frequency').addEventListener('change', updateFrequencyFields);
$('#close-dialog').addEventListener('click', () => $('#expense-dialog').close());
$('#cancel-dialog').addEventListener('click', () => $('#expense-dialog').close());
$('#expense-dialog').addEventListener('click', (event) => { if (event.target === $('#expense-dialog')) $('#expense-dialog').close(); });
$('#expense-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const id = $('#expense-id').value;
  const source = $('#expense-source').value;
  const frequency = $('#expense-frequency').value;
  const values = { user_id: currentUser.id, name: $('#expense-name').value.trim(), amount: Math.round(Number($('#expense-amount').value) * 100) / 100, due_day: Math.min(31, Math.max(1, Number($('#expense-day').value))), category: $('#expense-category').value, bank: $('#expense-bank').value, frequency, annual_month: frequency === 'annual' ? Number($('#expense-annual-month').value) : 1 };
  let templateId = id;
  let error;
  if (source === 'variable') {
    const variableValues = { user_id: currentUser.id, name: values.name, amount: values.amount, category: values.category, bank: values.bank, expense_date: $('#expense-date').value };
    const result = id
      ? await supabase.from('variable_expenses').update(variableValues).eq('id', id)
      : await supabase.from('variable_expenses').insert(variableValues);
    error = result.error;
  } else if (id) {
    ({ error } = await supabase.from('fixed_expenses').update(values).eq('id', id));
    if (!error) ({ error } = await supabase.from('monthly_expenses').update({ name: values.name, amount: values.amount, due_day: values.due_day, category: values.category, bank: values.bank, frequency: values.frequency, annual_month: values.annual_month }).eq('fixed_expense_id', id).eq('month', monthKey()));
  } else {
    const result = await supabase.from('fixed_expenses').insert(values).select('id').single();
    error = result.error;
    templateId = result.data?.id;
    const isDueThisMonth = isDueInMonth(values, viewedMonth);
    if (!error && isDueThisMonth) ({ error } = await supabase.from('monthly_expenses').insert({ user_id: currentUser.id, fixed_expense_id: templateId, month: monthKey(), name: values.name, amount: values.amount, due_day: values.due_day, category: values.category, bank: values.bank, frequency: values.frequency, annual_month: values.annual_month }));
  }
  busy = false;
  if (error) return showError(error);
  $('#expense-dialog').close();
  await loadMonth();
});

$('#expense-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || busy) return;
  if (button.dataset.action === 'add-fixed') return openDialog();
  if (button.dataset.action === 'add-variable') return openDialog(null, 'variable');
  const row = button.closest('[data-id]');
  const item = listExpenses.find((expense) => expense.id === row?.dataset.id && expense.source === row?.dataset.source);
  if (!item) return;
  busy = true;
  let error;
  if (button.dataset.action === 'toggle' && item.source !== 'variable') {
    ({ error } = await supabase.from('monthly_expenses').update({ paid: !item.paid, paid_at: item.paid ? null : new Date().toISOString() }).eq('id', item.monthly_expense_id || item.id));
  } else if (button.dataset.action === 'edit') {
    busy = false;
    return openDialog(item, item.source);
  } else if (button.dataset.action === 'delete' && window.confirm(`¿Eliminar «${item.name}»${item.source === 'variable' ? ' de tus gastos variables' : ' de tus gastos fijos'}?`)) {
    if (item.source === 'variable') ({ error } = await supabase.from('variable_expenses').delete().eq('id', item.id));
    else {
      ({ error } = await supabase.from('fixed_expenses').update({ active: false }).eq('id', item.fixed_expense_id));
      if (!error && item.hasSnapshot !== false) ({ error } = await supabase.from('monthly_expenses').delete().eq('id', item.monthly_expense_id || item.id));
    }
  }
  busy = false;
  if (error) return showError(error);
  await loadMonth();
});

$('#prev-month').addEventListener('click', async () => { viewedMonth.setMonth(viewedMonth.getMonth() - 1); await loadMonth(); });
$('#next-month').addEventListener('click', async () => { viewedMonth.setMonth(viewedMonth.getMonth() + 1); await loadMonth(); });
$('#this-month').addEventListener('click', async () => { viewedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); await loadMonth(); });
$('#search').addEventListener('input', render);
$('#filter').addEventListener('change', render);
bankFilterSelect.addEventListener('change', render);
typeFilterSelect.addEventListener('change', render);
frequencyFilterSelect.addEventListener('change', render);

// Bank statements are handled locally in the browser. No bank credentials or
// original statement files are uploaded; only the reviewed expense rows go to Supabase.
const csvDialog = $('#csv-dialog');
let csvImportRows = [];
const normalizeHeader = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[\s_\-]+/g, ' ').trim();
function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => value.trim())) rows.push(row); }
  const dateAliases = ['fecha', 'date', 'completed date', 'booking date', 'transaction date', 'started date', 'fecha operacion', 'fecha valor'];
  const nameAliases = ['concepto', 'descripcion', 'description', 'details', 'merchant', 'counterparty', 'payee', 'beneficiario', 'nombre'];
  const amountAliases = ['importe', 'amount', 'cantidad', 'transaction amount', 'importe eur', 'amount eur'];
  let headerIndex = -1, headers = [];
  for (let i = 0; i < Math.min(rows.length, 12); i += 1) {
    const candidate = rows[i].map((value) => normalizeHeader(value.replace(/^\uFEFF/, '')));
    if (candidate.some((value) => dateAliases.includes(value)) && candidate.some((value) => amountAliases.includes(value) || ['debe', 'debit', 'withdrawal', 'cargo'].includes(value))) {
      headerIndex = i; headers = candidate; break;
    }
  }
  if (headerIndex < 0) throw new Error('No encuentro columnas reconocibles de fecha e importe. Usa un CSV con encabezados como Fecha, Concepto e Importe.');
  const dateIndex = dateAliases.map((alias) => headers.indexOf(alias)).find((index) => index >= 0);
  const nameIndex = nameAliases.map((alias) => headers.indexOf(alias)).find((index) => index >= 0);
  let amountIndex = headers.findIndex((value) => amountAliases.includes(value));
  let debitMode = false;
  if (amountIndex < 0) { amountIndex = headers.findIndex((value) => ['debe', 'debit', 'withdrawal', 'cargo'].includes(value)); debitMode = true; }
  const parseDate = (value) => {
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const local = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
    if (iso || local) {
      const [, year, month, day] = iso ? [null, iso[1], iso[2], iso[3]] : [null, local[3], local[2], local[1]];
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      if (date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)) return '';
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return '';
  };
  const parseAmount = (value) => {
    let raw = String(value || '').replace(/[\s€$£]/g, '');
    if (!raw) return NaN;
    const comma = raw.lastIndexOf(','), dot = raw.lastIndexOf('.');
    if (comma > dot) raw = raw.replace(/\./g, '').replace(',', '.');
    else if (dot > comma) raw = raw.replace(/,/g, '');
    else if (comma >= 0) raw = raw.replace(',', '.');
    return Number(raw);
  };
  const categoryFor = (name) => {
    const value = normalizeHeader(name);
    if (/alquiler|hipoteca|vivienda/.test(value)) return 'Vivienda';
    if (/luz|agua|gas|electric|internet|telefono/.test(value)) return 'Suministros';
    if (/metro|taxi|transporte|parking|gasolin|tren|uber|cabify/.test(value)) return 'Transporte';
    if (/netflix|spotify|suscrip|prime|icloud/.test(value)) return 'Suscripciones';
    if (/seguro|mutua/.test(value)) return 'Seguros';
    return 'Otros';
  };
  const output = [];
  for (const values of rows.slice(headerIndex + 1)) {
    const amount = parseAmount(values[amountIndex]);
    const date = parseDate(values[dateIndex]);
    const name = String(values[nameIndex] || '').trim().slice(0, 120);
    if (!date || !name || !Number.isFinite(amount) || amount === 0) continue;
    if (!debitMode && amount > 0) continue; // Ignore income and refunds.
    output.push({ name, amount: Math.round(Math.abs(amount) * 100) / 100, expense_date: date, category: categoryFor(name) });
  }
  return output;
}

$('#import-bank-csv').addEventListener('click', () => $('#bank-csv-file').click());
$('#bank-csv-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  csvBankSelect.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return window.alert('El CSV supera el límite de 5 MB. Exporta un periodo más corto.');
  try {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    csvImportRows = parseCsv(text);
    if (!csvImportRows.length) return window.alert('No se encontraron gastos. Se importan importes negativos; los ingresos y las filas incompletas se omiten.');
    if (csvImportRows.length > 1000) return window.alert('Este extracto contiene más de 1.000 gastos. Divide el CSV en periodos más pequeños para importarlo con seguridad.');
    $('#csv-summary').textContent = `${csvImportRows.length} gastos encontrados en «${file.name}». Revisa la vista previa antes de importarlos. No vuelvas a importar el mismo extracto para evitar duplicados.`;
    $('#csv-preview-body').innerHTML = csvImportRows.slice(0, 8).map((item) => `<tr><td>${escapeHtml(expenseDateLabel(item.expense_date))}</td><td>${escapeHtml(item.name)}</td><td>${money.format(item.amount)}</td></tr>`).join('');
    if (csvImportRows.length > 8) $('#csv-preview-body').insertAdjacentHTML('beforeend', `<tr><td colspan="3" class="csv-more">y ${csvImportRows.length - 8} movimientos m&aacute;s</td></tr>`);
    $('#confirm-csv-import').disabled = !csvBankSelect.value;
    csvDialog.showModal();
  } catch (error) {
    window.alert(error.message || 'No se pudo leer el archivo CSV.');
  }
});
csvBankSelect.addEventListener('change', () => { $('#confirm-csv-import').disabled = !csvBankSelect.value; });
const closeCsvDialog = () => { csvDialog.close(); csvImportRows = []; csvBankSelect.value = ''; $('#csv-preview-body').replaceChildren(); };
$('#close-csv-dialog').addEventListener('click', closeCsvDialog);
$('#cancel-csv-import').addEventListener('click', closeCsvDialog);
$('#confirm-csv-import').addEventListener('click', async () => {
  if (busy || !currentUser || !csvImportRows.length || !csvBankSelect.value) return;
  busy = true;
  const button = $('#confirm-csv-import');
  button.disabled = true;
  button.textContent = 'Importando…';
  const latest = csvImportRows.reduce((max, item) => item.expense_date > max ? item.expense_date : max, csvImportRows[0].expense_date);
  const rows = csvImportRows.map((item) => ({ ...item, bank: csvBankSelect.value, user_id: currentUser.id }));
  const { error } = await supabase.from('variable_expenses').insert(rows);
  busy = false;
  button.disabled = false;
  button.textContent = 'Importar gastos';
  if (error) { console.error(error); window.alert(`No se pudo importar el extracto: ${error.message || 'error de conexión'}`); return; }
  const count = csvImportRows.length;
  closeCsvDialog();
  window.alert(`Se han importado ${count} gastos variables.`);
  const latestDate = new Date(`${latest}T00:00:00`);
  viewedMonth = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  await loadMonth();
});

const { data: { user } } = await supabase.auth.getUser();
if (user) await showApp(user);
else { $('#auth-screen').hidden = false; document.querySelector('.app-shell').hidden = true; }
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session) { currentUser = null; $('#auth-screen').hidden = false; document.querySelector('.app-shell').hidden = true; }
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch((error) => console.error('No se pudo registrar la app móvil:', error)));
}
