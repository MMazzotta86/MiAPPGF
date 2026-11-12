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
const nextDueMonth = (item, date) => {
  for (let offset = 0; offset < 12; offset += 1) {
    const month = new Date(date.getFullYear(), date.getMonth() + offset, 1);
    if (isDueInMonth(item, month)) return month;
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
};
const $ = (selector) => document.querySelector(selector);
let currentUser = null;
let expenses = [];
let fixedTemplates = [];
let occurrenceSnapshots = [];
let yearFixedSnapshots = [];
let yearVariableExpenses = [];
let cardPurchases = [];
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
  label.id = `${id}-field`;
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
setOptions(typeFilterSelect, [['all', 'Todos los tipos'], ['fixed', 'Gastos fijos'], ['variable', 'Gastos variables'], ['credit_card', 'Tarjeta de crédito']]);
bankFilterSelect.insertAdjacentElement('afterend', typeFilterSelect);
const frequencyFilterSelect = document.createElement('select');
frequencyFilterSelect.id = 'frequency-filter';
frequencyFilterSelect.setAttribute('aria-label', 'Filtrar por frecuencia');
setOptions(frequencyFilterSelect, [['all', 'Todas las frecuencias'], ['monthly', 'Mensuales'], ['quarterly', 'Trimestrales'], ['annual', 'Anuales'], ['variable', 'Gastos variables'], ['credit_card', 'Tarjeta de crédito']]);
typeFilterSelect.insertAdjacentElement('afterend', frequencyFilterSelect);
const cardFilterSelect = document.createElement('select');
cardFilterSelect.id = 'card-filter';
cardFilterSelect.setAttribute('aria-label', 'Filtrar por tarjeta');
cardFilterSelect.addEventListener('change', render);
frequencyFilterSelect.insertAdjacentElement('afterend', cardFilterSelect);
const refreshCardFilter = () => {
  const selected = cardFilterSelect.value;
  const cardNames = [...new Set(cardPurchases.map((purchase) => purchase.card_name))].sort((a, b) => a.localeCompare(b, 'es'));
  cardFilterSelect.replaceChildren();
  setOptions(cardFilterSelect, [['all', 'Todas las tarjetas'], ...cardNames.map((name) => [name, name])]);
  cardFilterSelect.value = cardNames.includes(selected) ? selected : 'all';
};
const monthKey = (date = viewedMonth) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const isPaid = (expense) => expense.paid;
const dayLabel = (day) => day === 1 ? '1 de cada mes' : `Día ${day}`;
const installmentAmount = (purchase, number) => {
  const totalCents = Math.round(Number(purchase.amount) * 100);
  const count = Number(purchase.installment_count);
  const baseCents = Math.floor(totalCents / count);
  const extraCents = totalCents % count;
  return (baseCents + (number <= extraCents ? 1 : 0)) / 100;
};
const installmentDate = (purchase, number) => {
  const firstMonth = new Date(`${purchase.first_installment_month}T00:00:00`);
  return new Date(firstMonth.getFullYear(), firstMonth.getMonth() + number - 1, 1);
};
const cardInstallment = (purchase, number) => {
  const paymentDate = installmentDate(purchase, number);
  return {
    ...purchase,
    id: `${purchase.id}-${number}`,
    purchase_id: purchase.id,
    purchase_amount: purchase.amount,
    source: 'credit_card',
    frequency: 'credit_card',
    installment_number: number,
    payment_month: monthKey(paymentDate),
    amount: installmentAmount(purchase, number),
    paid: (purchase.paid_installments || []).includes(number),
    bank: 'Sin asignar',
    due_day: 1,
  };
};
const purchaseInstallments = (purchase) => Array.from(
  { length: Number(purchase.installment_count) },
  (_, index) => cardInstallment(purchase, index + 1),
);

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
  occurrenceSnapshots = [];
  const frequency = frequencyFilterSelect.value;
  if (frequency === 'quarterly' || frequency === 'annual') {
    const scheduled = fixedTemplates
      .filter((item) => item.frequency === frequency)
      .map((item) => {
        const paymentMonth = frequency === 'annual'
          ? new Date(viewedMonth.getFullYear(), Number(item.annual_month) - 1, 1)
          : nextDueMonth(item, viewedMonth);
        return { item, month: monthKey(paymentMonth) };
      });
    const futurePayments = scheduled
      .filter(({ month: paymentMonth }) => paymentMonth >= currentMonth)
      .map(({ item, month: paymentMonth }) => ({ user_id: currentUser.id, fixed_expense_id: item.id, month: paymentMonth, name: item.name, amount: item.amount, due_day: item.due_day, category: item.category, bank: item.bank || 'Sin asignar', frequency: item.frequency, annual_month: item.annual_month }));
    if (futurePayments.length) {
      const { error: paymentSeedError } = await supabase.from('monthly_expenses').upsert(futurePayments, {
        onConflict: 'user_id,fixed_expense_id,month',
        ignoreDuplicates: true,
      });
      if (paymentSeedError) return showError(paymentSeedError);
    }
    if (scheduled.length) {
      const months = [...new Set(scheduled.map(({ month: paymentMonth }) => paymentMonth))];
      const ids = scheduled.map(({ item }) => item.id);
      const { data: snapshots, error: snapshotError } = await supabase.from('monthly_expenses').select('*').in('month', months).in('fixed_expense_id', ids);
      if (snapshotError) return showError(snapshotError);
      occurrenceSnapshots = snapshots || [];
    }
  }
  const { data, error } = await supabase.from('monthly_expenses').select('*').eq('month', month).order('due_day').order('name');
  if (error) return showError(error);
  const nextMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 1);
  const { data: variableData, error: variableError } = await supabase.from('variable_expenses').select('*').gte('expense_date', month).lt('expense_date', dateKey(nextMonth)).order('expense_date').order('name');
  if (variableError) return showError(variableError);
  const yearStart = `${viewedMonth.getFullYear()}-01-01`;
  const nextYearStart = `${viewedMonth.getFullYear() + 1}-01-01`;
  const { data: yearFixedData, error: yearFixedError } = await supabase.from('monthly_expenses').select('*').gte('month', yearStart).lt('month', nextYearStart);
  if (yearFixedError) return showError(yearFixedError);
  const { data: yearVariableData, error: yearVariableError } = await supabase.from('variable_expenses').select('*').gte('expense_date', yearStart).lt('expense_date', nextYearStart);
  if (yearVariableError) return showError(yearVariableError);
  const { data: cardPurchaseData, error: cardPurchaseError } = await supabase.from('credit_card_purchases').select('*').order('first_installment_month').order('name');
  if (cardPurchaseError) return showError(cardPurchaseError);
  yearFixedSnapshots = yearFixedData || [];
  yearVariableExpenses = yearVariableData || [];
  cardPurchases = cardPurchaseData || [];
  refreshCardFilter();
  const cardMonthItems = cardPurchases.flatMap(purchaseInstallments).filter((item) => item.payment_month === month);
  expenses = [
    ...(data || []).map((item) => ({ ...item, source: 'fixed' })),
    ...(variableData || []).map((item) => ({ ...item, source: 'variable', frequency: 'variable', paid: true, due_day: new Date(`${item.expense_date}T00:00:00`).getDate() })),
    ...cardMonthItems,
  ];
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
  const recurringItems = frequencyFilter === 'all' || frequencyFilter === 'variable' || frequencyFilter === 'credit_card'
    ? monthExpenses.filter((item) => frequencyFilter === 'all' || item.source === (frequencyFilter === 'credit_card' ? 'credit_card' : 'variable'))
    : fixedTemplates
      .filter((item) => item.frequency === frequencyFilter)
      .map((template) => {
        const paymentDate = frequencyFilter === 'annual'
          ? new Date(viewedMonth.getFullYear(), Number(template.annual_month) - 1, 1)
          : nextDueMonth(template, viewedMonth);
        const paymentMonth = monthKey(paymentDate);
        const snapshot = occurrenceSnapshots.find((item) => item.fixed_expense_id === template.id && item.month === paymentMonth)
          || monthExpenses.find((item) => item.source === 'fixed' && item.fixed_expense_id === template.id && item.month === paymentMonth);
        return {
          ...(snapshot || {}),
          ...template,
          id: snapshot?.id || template.id,
          fixed_expense_id: template.id,
          source: 'fixed',
          monthly_expense_id: snapshot?.id || null,
          hasSnapshot: Boolean(snapshot),
          paid: snapshot?.paid || false,
          payment_month: paymentMonth,
        };
      });
  listExpenses = recurringItems.sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name, 'es'));
  const matchesBankTypeAndCard = (item) => (bankFilter === 'all' || (item.bank || 'Sin asignar') === bankFilter)
    && (typeFilter === 'all' || item.source === typeFilter)
    && (cardFilterSelect.value === 'all' || (item.source === 'credit_card' && item.card_name === cardFilterSelect.value));
  const filtered = listExpenses.filter(matchesBankTypeAndCard);
  const year = viewedMonth.getFullYear();
  const now = new Date();
  const currentMonth = monthKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const yearFixedItems = yearFixedSnapshots.map((item) => ({ ...item, source: 'fixed' }));
  fixedTemplates.forEach((template) => {
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const paymentDate = new Date(year, monthIndex, 1);
      if (!isDueInMonth(template, paymentDate)) continue;
      const paymentMonth = monthKey(paymentDate);
      const hasSnapshot = yearFixedSnapshots.some((item) => item.fixed_expense_id === template.id && item.month === paymentMonth);
      if (!hasSnapshot && paymentMonth >= currentMonth) {
        yearFixedItems.push({ ...template, source: 'fixed', month: paymentMonth, paid: false });
      }
    }
  });
  const yearVariableItems = yearVariableExpenses.map((item) => ({
    ...item,
    source: 'variable',
    frequency: 'variable',
    paid: true,
    due_day: new Date(`${item.expense_date}T00:00:00`).getDate(),
  }));
  const yearCardItems = cardPurchases.flatMap(purchaseInstallments).filter((item) => item.payment_month.slice(0, 4) === String(year));
  const yearItems = [...yearFixedItems, ...yearVariableItems, ...yearCardItems];
  const matchesBankAndType = matchesBankTypeAndCard;
  const summaryItems = (frequencyFilter === 'all' ? monthExpenses : yearItems)
    .filter((item) => matchesBankAndType(item) && (frequencyFilter === 'all' || item.frequency === frequencyFilter));
  const fixedItems = summaryItems.filter((item) => item.source === 'fixed');
  const variableItems = summaryItems.filter((item) => item.source === 'variable');
  const cardItems = summaryItems.filter((item) => item.source === 'credit_card');
  const fixedPaidItems = fixedItems.filter(isPaid);
  const fixedPendingItems = fixedItems.filter((item) => !isPaid(item));
  const cardPaidItems = cardItems.filter(isPaid);
  const cardPendingItems = cardItems.filter((item) => !isPaid(item));
  const fixedPaidTotal = fixedPaidItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const variablePaidTotal = variableItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const cardPaidTotal = cardPaidItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const fixedPaidLabel = `${fixedPaidItems.length} ${fixedPaidItems.length === 1 ? 'fijo pagado' : 'fijos pagados'}`;
  const variablePaidLabel = `${variableItems.length} ${variableItems.length === 1 ? 'variable pagado' : 'variables pagados'}`;
  const paidTotal = fixedPaidTotal + variablePaidTotal + cardPaidTotal;
  const pendingTotal = fixedPendingItems.reduce((sum, item) => sum + Number(item.amount), 0)
    + cardPendingItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const periodTotal = paidTotal + pendingTotal;
  const progress = periodTotal ? Math.round(paidTotal / periodTotal * 100) : 0;
  const totalLabels = {
    monthly: `Pagos mensuales pagados · ${year}`,
    quarterly: `Pagos trimestrales pagados · ${year}`,
    annual: `Pagos anuales pagados · ${year}`,
    variable: `Gastos variables pagados · ${year}`,
    credit_card: `Cuotas pagadas · ${year}`,
  };
  const totalFooters = {
    monthly: `${fixedPaidItems.length} pagos mensuales pagados en ${year}`,
    quarterly: `${fixedPaidItems.length} pagos trimestrales pagados en ${year}`,
    annual: `${fixedPaidItems.length} pagos anuales pagados en ${year}`,
    variable: `${variableItems.length} gastos variables pagados en ${year}`,
    credit_card: `${cardPaidItems.length} cuotas pagadas en ${year}`,
  };
  const hasFrequencyFilter = frequencyFilter !== 'all';
  $('.total-card .stat-top span').textContent = totalLabels[frequencyFilter] || 'Gastos pagados este mes';
  $('#total-value').textContent = money.format(paidTotal);
  $('#pending-title').textContent = hasFrequencyFilter ? `Programados en ${year}` : 'Gastos por pagar';
  $('#paid-title').textContent = hasFrequencyFilter ? `Fijos pagados en ${year}` : 'Fijos pagados';
  $('#variable-paid-title').textContent = hasFrequencyFilter ? `Variables pagados en ${year}` : 'Variables pagados';
  $('#card-paid-title').textContent = hasFrequencyFilter ? `Cuotas pagadas en ${year}` : 'Cuotas pagadas';
  $('#pending-value').textContent = money.format(pendingTotal);
  $('#paid-value').textContent = money.format(fixedPaidTotal);
  $('#variable-paid-value').textContent = money.format(variablePaidTotal);
  $('#card-paid-value').textContent = money.format(cardPaidTotal);
  $('#total-foot').textContent = totalFooters[frequencyFilter] || `${fixedPaidLabel} + ${variablePaidLabel} + ${cardPaidItems.length} ${cardPaidItems.length === 1 ? 'cuota pagada' : 'cuotas pagadas'}`;
  const pendingCount = fixedPendingItems.length + cardPendingItems.length;
  $('#pending-foot').textContent = `${pendingCount} ${hasFrequencyFilter ? (pendingCount === 1 ? 'pago programado' : 'pagos programados') : (pendingCount === 1 ? 'gasto por pagar' : 'gastos por pagar')}`;
  $('#paid-foot').textContent = `${fixedPaidItems.length} de ${fixedItems.length} gastos fijos pagados`;
  $('#variable-paid-foot').textContent = `${variableItems.length} ${variableItems.length === 1 ? 'gasto variable pagado' : 'gastos variables pagados'}`;
  $('#card-paid-foot').textContent = `${cardPaidItems.length} ${cardPaidItems.length === 1 ? 'cuota pagada' : 'cuotas pagadas'}`;
  $('#progress-title').textContent = hasFrequencyFilter ? `Este año · ${year}` : 'Tu mes en marcha';
  $('#progress-label').textContent = `${progress} % pagado`;
  $('#progress-fill').style.width = `${progress}%`;
  const annualFixedItems = yearFixedItems.filter(matchesBankAndType);
  const annualVariableItems = yearVariableItems.filter(matchesBankAndType);
  const annualCardItems = yearCardItems.filter(matchesBankAndType);
  const annualPaidItems = [...annualFixedItems.filter(isPaid), ...annualVariableItems, ...annualCardItems.filter(isPaid)];
  const annualPendingItems = [...annualFixedItems.filter((item) => !isPaid(item)), ...annualCardItems.filter((item) => !isPaid(item))];
  const annualPaidTotal = annualPaidItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const annualPendingTotal = annualPendingItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const annualTotalCount = annualPaidItems.length + annualPendingItems.length;
  $('#annual-summary-title').textContent = `Acumulado anual · ${year}`;
  $('#annual-paid-value').textContent = money.format(annualPaidTotal);
  $('#annual-paid-count').textContent = `${annualPaidItems.length} ${annualPaidItems.length === 1 ? 'gasto' : 'gastos'}`;
  $('#annual-pending-value').textContent = money.format(annualPendingTotal);
  $('#annual-pending-count').textContent = `${annualPendingItems.length} ${annualPendingItems.length === 1 ? 'gasto programado' : 'gastos programados'}`;
  $('#annual-total-value').textContent = money.format(annualPaidTotal + annualPendingTotal);
  $('#annual-total-count').textContent = `${annualTotalCount} ${annualTotalCount === 1 ? 'gasto' : 'gastos'}`;
  $('#footer-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'gasto' : 'gastos'} mostrados`;
  $('#today-label').textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  $('.progress-section').hidden = false;
  const query = $('#search').value.trim().toLocaleLowerCase('es');
  const filter = $('#filter').value;
  const visible = filtered.filter((item) => `${item.name} ${item.category} ${item.bank || 'Sin asignar'} ${item.card_name || ''}`.toLocaleLowerCase('es').includes(query) && (filter === 'all' || (filter === 'paid' ? isPaid(item) : !isPaid(item))));
  const list = $('#expense-list');
  if (!visible.length) {
    const noExpenses = monthExpenses.length === 0 && fixedTemplates.length === 0 && cardPurchases.length === 0;
    const noMatches = filtered.length === 0 && !noExpenses;
    list.innerHTML = `<div class="empty-state"><div class="empty-illustration">${noExpenses ? '✳' : '⌕'}</div><h3>${noExpenses ? 'Tu lista empieza aquí' : noMatches ? 'No hay gastos para estos filtros' : 'No encontramos ese gasto'}</h3><p>${noExpenses ? 'Añade un gasto fijo, registra un gasto puntual o una compra con tarjeta.' : noMatches ? 'Prueba otro banco, tipo, frecuencia o tarjeta.' : 'Prueba otra búsqueda o cambia el filtro.'}</p>${noExpenses ? '<button class="primary-button" data-action="add-fixed"><span>＋</span> Añadir gasto fijo</button> <button class="cancel-button" data-action="add-variable">Registrar gasto variable</button> <button class="cancel-button" data-action="add-card">Compra con tarjeta</button>' : ''}</div>`;
    return;
  }
  list.innerHTML = visible.map((item) => {
    const category = categoryIcons[item.category] ? item.category : 'Otros';
    const frequency = item.source === 'variable'
      ? 'Gasto variable'
      : item.source === 'credit_card'
        ? `Cuota ${item.installment_number}/${item.installment_count}`
        : item.frequency === 'annual'
          ? `Anual · ${monthName(item.annual_month)}`
          : item.frequency === 'quarterly'
            ? `Trimestral · desde ${monthName(item.annual_month)}`
            : 'Mensual';
    const dateLabel = item.source === 'variable'
      ? expenseDateLabel(item.expense_date)
      : item.source === 'credit_card'
        ? `${monthName(Number(item.payment_month.slice(5, 7)))} ${item.payment_month.slice(0, 4)}`
      : item.payment_month
        ? `${dayLabel(item.due_day)} · ${monthName(Number(item.payment_month.slice(5, 7)))} ${item.payment_month.slice(0, 4)}`
        : dayLabel(item.due_day);
    const status = item.source === 'variable'
      ? '<span class="status-pill status-paid">✓ Pagado</span>'
      : `<button class="status-pill ${item.paid ? 'status-paid' : 'status-pending'}" data-action="toggle">${item.paid ? '✓ Pagado' : '◷ Programado'}</button>`;
    const institution = item.source === 'credit_card' ? item.card_name : item.bank || 'Sin asignar';
    return `<article class="expense-row" data-id="${escapeHtml(item.id)}" data-source="${item.source}"><div class="expense-name"><span class="category-icon ${categoryClasses[category]}" aria-hidden="true">${categoryIcons[category]}</span><div><div class="expense-title">${escapeHtml(item.name)}</div><div class="expense-category-label">${escapeHtml(category)} · ${escapeHtml(institution)}</div></div></div><div class="row-meta"><div class="row-label">${item.source === 'variable' ? 'FECHA' : 'VENCIMIENTO'}</div><div class="row-value">${escapeHtml(dateLabel)}</div></div><div class="row-meta"><div class="row-label">TIPO</div><div class="row-value">${escapeHtml(frequency)}</div></div><div class="amount-meta"><div class="row-label">IMPORTE</div><div class="row-value amount-value">${money.format(item.amount)}</div></div>${status}<div class="row-actions"><button class="icon-button" data-action="edit" aria-label="Editar ${escapeHtml(item.name)}" title="Editar">✎</button><button class="icon-button" data-action="delete" aria-label="Eliminar ${escapeHtml(item.name)}" title="Eliminar">×</button></div></article>`;
  }).join('');
}

function openDialog(item = null, source = 'fixed') {
  $('#expense-form').reset();
  const purchase = source === 'credit_card' ? cardPurchases.find((entry) => entry.id === item?.purchase_id) : null;
  const purchaseHasPaidInstallments = Boolean(purchase?.paid_installments?.length);
  $('#expense-id').value = source === 'variable' ? (item?.id || '') : source === 'credit_card' ? (purchase?.id || '') : (item?.fixed_expense_id || '');
  $('#expense-source').value = source;
  $('#expense-name').value = item?.name || '';
  $('#expense-amount').value = source === 'credit_card' ? (purchase?.amount ?? '') : item?.amount ?? '';
  $('#expense-day').value = item?.due_day ?? 1;
  $('#expense-category').value = item?.category || 'Vivienda';
  $('#expense-bank').value = item?.bank || (item ? 'Sin asignar' : '');
  $('#expense-frequency').value = item?.frequency || 'monthly';
  $('#expense-annual-month').value = item?.annual_month ?? viewedMonth.getMonth() + 1;
  const now = new Date();
  const defaultDate = viewedMonth.getFullYear() === now.getFullYear() && viewedMonth.getMonth() === now.getMonth() ? now : viewedMonth;
  $('#expense-date').value = item?.expense_date || dateKey(defaultDate);
  $('#expense-card-name').value = purchase?.card_name || '';
  $('#expense-installment-count').value = purchase?.installment_count || 1;
  const defaultFirstInstallment = new Date(defaultDate.getFullYear(), defaultDate.getMonth() + 1, 1);
  $('#first-installment-month').value = purchase?.first_installment_month.slice(0, 7) || monthKey(defaultFirstInstallment).slice(0, 7);
  $('#expense-date').disabled = source !== 'variable';
  $('#expense-day').disabled = source !== 'fixed';
  $('#expense-frequency').disabled = source !== 'fixed';
  $('#expense-annual-month').disabled = source !== 'fixed';
  $('#expense-card-name').disabled = source !== 'credit_card';
  $('#expense-installment-count').disabled = source !== 'credit_card' || purchaseHasPaidInstallments;
  $('#first-installment-month').disabled = source !== 'credit_card' || purchaseHasPaidInstallments;
  $('#expense-amount').disabled = source === 'credit_card' && purchaseHasPaidInstallments;
  $('#card-edit-note').hidden = source !== 'credit_card' || !purchaseHasPaidInstallments;
  $('#expense-bank').disabled = source === 'credit_card';
  $('#expense-bank-field').hidden = source === 'credit_card';
  $('#expense-date-field').hidden = source !== 'variable';
  $('#fixed-frequency-field').hidden = source !== 'fixed';
  $('#fixed-month-field').hidden = source !== 'fixed';
  $('#fixed-day-field').hidden = source !== 'fixed';
  $('#card-name-field').hidden = source !== 'credit_card';
  $('#installment-fields').hidden = source !== 'credit_card';
  updateFrequencyFields();
  $('#dialog-title').textContent = source === 'credit_card'
    ? item ? 'Edita la compra con tarjeta' : 'Registra una compra con tarjeta'
    : item ? (source === 'variable' ? 'Edita tu gasto variable' : 'Edita tu gasto fijo') : (source === 'variable' ? 'Registra un gasto variable' : 'Añade un gasto fijo');
  $('#expense-dialog').showModal();
  $('#expense-name').focus();
}
function updateFrequencyFields() {
  const frequency = $('#expense-frequency').value;
  const source = $('#expense-source').value;
  const scheduled = frequency !== 'monthly';
  $('#fixed-month-field').hidden = !scheduled || source !== 'fixed';
  $('#annual-month-label').textContent = frequency === 'annual' ? 'Mes de pago' : 'Mes del primer pago';
  $('#expense-amount-label').textContent = source === 'credit_card' ? 'Importe total de la compra' : 'Importe';
  $('#expense-amount-unit').textContent = source === 'credit_card' ? '€ total' : source === 'variable' ? '€' : frequency === 'annual' ? '€ / año' : frequency === 'quarterly' ? '€ / trimestre' : '€ / mes';
}
$('#add-expense').addEventListener('click', () => openDialog());
$('#add-variable-expense').addEventListener('click', () => openDialog(null, 'variable'));
$('#add-card-expense').addEventListener('click', () => openDialog(null, 'credit_card'));
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
  if (source === 'credit_card') {
    const installmentCount = Number($('#expense-installment-count').value);
    if (installmentCount > Math.round(values.amount * 100)) {
      $('#expense-installment-count').setCustomValidity('Cada cuota debe ser de al menos 0,01 €.');
      $('#expense-installment-count').reportValidity();
      $('#expense-installment-count').setCustomValidity('');
      busy = false;
      return;
    }
    const existingPurchase = cardPurchases.find((purchase) => purchase.id === id);
    const purchaseValues = {
      user_id: currentUser.id,
      name: values.name,
      amount: values.amount,
      installment_count: installmentCount,
      first_installment_month: `${$('#first-installment-month').value}-01`,
      card_name: $('#expense-card-name').value.trim(),
      category: values.category,
      paid_installments: (existingPurchase?.paid_installments || []).filter((number) => number <= installmentCount),
      updated_at: new Date().toISOString(),
    };
    const result = id
      ? await supabase.from('credit_card_purchases').update(purchaseValues).eq('id', id)
      : await supabase.from('credit_card_purchases').insert(purchaseValues);
    error = result.error;
  } else if (source === 'variable') {
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
  if (button.dataset.action === 'add-card') return openDialog(null, 'credit_card');
  const row = button.closest('[data-id]');
  const item = listExpenses.find((expense) => expense.id === row?.dataset.id && expense.source === row?.dataset.source);
  if (!item) return;
  busy = true;
  let error;
  if (button.dataset.action === 'toggle' && item.source === 'credit_card') {
    const purchase = cardPurchases.find((entry) => entry.id === item.purchase_id);
    if (!purchase) error = new Error('No se encontró la compra de tarjeta para actualizar la cuota.');
    else {
      const paidInstallments = new Set(purchase.paid_installments || []);
      if (item.paid) paidInstallments.delete(item.installment_number);
      else paidInstallments.add(item.installment_number);
      ({ error } = await supabase.from('credit_card_purchases').update({
        paid_installments: [...paidInstallments].sort((a, b) => a - b),
        updated_at: new Date().toISOString(),
      }).eq('id', purchase.id));
    }
  } else if (button.dataset.action === 'toggle' && item.source !== 'variable') {
    const snapshotId = item.monthly_expense_id || (item.hasSnapshot === false ? null : item.id);
    if (snapshotId) {
      ({ error } = await supabase.from('monthly_expenses').update({ paid: !item.paid, paid_at: item.paid ? null : new Date().toISOString() }).eq('id', snapshotId));
    } else {
      const { error: insertError } = await supabase.from('monthly_expenses').insert({
        user_id: currentUser.id,
        fixed_expense_id: item.fixed_expense_id,
        month: item.payment_month,
        name: item.name,
        amount: item.amount,
        due_day: item.due_day,
        category: item.category,
        bank: item.bank || 'Sin asignar',
        frequency: item.frequency,
        annual_month: item.annual_month,
        paid: true,
        paid_at: new Date().toISOString(),
      });
      error = insertError;
    }
  } else if (button.dataset.action === 'edit') {
    busy = false;
    return openDialog(item, item.source);
  } else if (button.dataset.action === 'delete' && window.confirm(`¿Eliminar «${item.name}»${item.source === 'variable' ? ' de tus gastos variables' : item.source === 'credit_card' ? ' y todas sus cuotas' : ' de tus gastos fijos'}?`)) {
    if (item.source === 'variable') ({ error } = await supabase.from('variable_expenses').delete().eq('id', item.id));
    else if (item.source === 'credit_card') ({ error } = await supabase.from('credit_card_purchases').delete().eq('id', item.purchase_id));
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
frequencyFilterSelect.addEventListener('change', () => loadMonth());

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
