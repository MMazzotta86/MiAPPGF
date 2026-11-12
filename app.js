import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const categoryIcons = { Vivienda: '⌂', Suministros: 'ϟ', Transporte: '↗', Suscripciones: '♫', Seguros: '✳', Otros: '◈' };
const categoryClasses = { Vivienda: 'cat-vivienda', Suministros: 'cat-suministros', Transporte: 'cat-transporte', Suscripciones: 'cat-suscripciones', Seguros: 'cat-seguros', Otros: 'cat-otros' };
const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const monthFormatter = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const monthName = (month) => new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(new Date(2025, Number(month) - 1, 1));
const isDueInMonth = (item, date) => {
  const month = date.getMonth() + 1;
  if (item.frequency === 'annual') return Number(item.annual_month) === month;
  if (item.frequency === 'quarterly') return (month - Number(item.annual_month) + 12) % 3 === 0;
  return true;
};
const $ = (selector) => document.querySelector(selector);
let currentUser = null;
let expenses = [];
let viewedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let busy = false;
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
  // Only create recurring snapshots for the current and future months. A missing
  // past month means there is no historical record; never invent one from today's template.
  if (month >= currentMonth) {
    const { data: templates, error: templateError } = await supabase.from('fixed_expenses').select('*').eq('active', true).order('created_at');
    if (templateError) return showError(templateError);
    const dueTemplates = templates.filter((item) => isDueInMonth(item, viewedMonth));
    if (dueTemplates.length) {
      const { error: seedError } = await supabase.from('monthly_expenses').upsert(
        dueTemplates.map((item) => ({ user_id: currentUser.id, fixed_expense_id: item.id, month, name: item.name, amount: item.amount, due_day: item.due_day, category: item.category, frequency: item.frequency, annual_month: item.annual_month })),
        { onConflict: 'user_id,fixed_expense_id,month', ignoreDuplicates: true },
      );
      if (seedError) return showError(seedError);
    }
  }
  const { data, error } = await supabase.from('monthly_expenses').select('*').eq('month', month).order('due_day').order('name');
  if (error) return showError(error);
  expenses = data || [];
  render();
}

function showError(error) {
  console.error(error);
  $('#expense-list').innerHTML = `<div class="empty-state"><h3>No se pudieron cargar tus gastos</h3><p>${escapeHtml(error.message || 'Revisa la conexión y las políticas RLS de Supabase.')}</p></div>`;
}

function render() {
  const label = monthFormatter.format(viewedMonth);
  $('#month-label').textContent = label.charAt(0).toLocaleUpperCase('es-ES') + label.slice(1);
  const sorted = [...expenses].sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name, 'es'));
  const total = sorted.reduce((sum, item) => sum + Number(item.amount), 0);
  const paidItems = sorted.filter(isPaid);
  const paidTotal = paidItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const pendingTotal = total - paidTotal;
  const progress = total ? Math.round(paidTotal / total * 100) : 0;
  $('#total-value').textContent = money.format(total);
  $('#pending-value').textContent = money.format(pendingTotal);
  $('#paid-value').textContent = money.format(paidTotal);
  $('#total-foot').textContent = `${sorted.length} ${sorted.length === 1 ? 'gasto fijo' : 'gastos fijos'} este mes`;
  $('#pending-foot').textContent = `${sorted.length - paidItems.length} ${sorted.length - paidItems.length === 1 ? 'recibo pendiente' : 'recibos pendientes'}`;
  $('#paid-foot').textContent = `${paidItems.length} de ${sorted.length} recibos`;
  $('#progress-label').textContent = `${progress} % pagado`;
  $('#progress-fill').style.width = `${progress}%`;
  $('#footer-count').textContent = `${sorted.length} ${sorted.length === 1 ? 'gasto fijo' : 'gastos fijos'}`;
  $('#today-label').textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());
  const query = $('#search').value.trim().toLocaleLowerCase('es');
  const filter = $('#filter').value;
  const visible = sorted.filter((item) => `${item.name} ${item.category}`.toLocaleLowerCase('es').includes(query) && (filter === 'all' || (filter === 'paid' ? isPaid(item) : !isPaid(item))));
  const list = $('#expense-list');
  if (!visible.length) {
    const noExpenses = sorted.length === 0;
    list.innerHTML = `<div class="empty-state"><div class="empty-illustration">${noExpenses ? '✳' : '⌕'}</div><h3>${noExpenses ? 'Tu lista empieza aquí' : 'No encontramos ese gasto'}</h3><p>${noExpenses ? 'Añade tus pagos recurrentes y tendrás el mes más claro.' : 'Prueba otra búsqueda o cambia el filtro.'}</p>${noExpenses ? '<button class="primary-button" data-action="add"><span>＋</span> Añadir mi primer gasto</button>' : ''}</div>`;
    return;
  }
  list.innerHTML = visible.map((item) => {
    const category = categoryIcons[item.category] ? item.category : 'Otros';
    const frequency = item.frequency === 'annual' ? `Anual · ${monthName(item.annual_month)}` : item.frequency === 'quarterly' ? `Trimestral · desde ${monthName(item.annual_month)}` : 'Mensual';
    return `<article class="expense-row" data-id="${escapeHtml(item.id)}"><div class="expense-name"><span class="category-icon ${categoryClasses[category]}" aria-hidden="true">${categoryIcons[category]}</span><div><div class="expense-title">${escapeHtml(item.name)}</div><div class="expense-category-label">${escapeHtml(category)}</div></div></div><div class="row-meta"><div class="row-label">VENCIMIENTO</div><div class="row-value">${dayLabel(item.due_day)}</div></div><div class="row-meta"><div class="row-label">FRECUENCIA</div><div class="row-value">${escapeHtml(frequency)}</div></div><div class="amount-meta"><div class="row-label">IMPORTE</div><div class="row-value amount-value">${money.format(item.amount)}</div></div><button class="status-pill ${item.paid ? 'status-paid' : 'status-pending'}" data-action="toggle">${item.paid ? '✓ Pagado' : '◷ Por pagar'}</button><div class="row-actions"><button class="icon-button" data-action="edit" aria-label="Editar ${escapeHtml(item.name)}" title="Editar">✎</button><button class="icon-button" data-action="delete" aria-label="Eliminar ${escapeHtml(item.name)}" title="Eliminar">×</button></div></article>`;
  }).join('');
}

function openDialog(item = null) {
  $('#expense-form').reset();
  $('#expense-id').value = item?.fixed_expense_id || '';
  $('#expense-name').value = item?.name || '';
  $('#expense-amount').value = item?.amount ?? '';
  $('#expense-day').value = item?.due_day ?? 1;
  $('#expense-category').value = item?.category || 'Vivienda';
  $('#expense-frequency').value = item?.frequency || 'monthly';
  $('#expense-annual-month').value = item?.annual_month ?? viewedMonth.getMonth() + 1;
  updateFrequencyFields();
  $('#dialog-title').textContent = item ? 'Edita tu gasto' : 'Añade un gasto';
  $('#expense-dialog').showModal();
  $('#expense-name').focus();
}
function updateFrequencyFields() {
  const frequency = $('#expense-frequency').value;
  const scheduled = frequency !== 'monthly';
  $('#annual-month-field').hidden = !scheduled;
  $('#annual-month-label').textContent = frequency === 'annual' ? 'Mes de pago' : 'Mes del primer pago';
  $('#expense-amount-unit').textContent = frequency === 'annual' ? '€ / año' : frequency === 'quarterly' ? '€ / trimestre' : '€ / mes';
}
$('#add-expense').addEventListener('click', () => openDialog());
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
  const frequency = $('#expense-frequency').value;
  const values = { user_id: currentUser.id, name: $('#expense-name').value.trim(), amount: Math.round(Number($('#expense-amount').value) * 100) / 100, due_day: Math.min(31, Math.max(1, Number($('#expense-day').value))), category: $('#expense-category').value, frequency, annual_month: frequency === 'annual' ? Number($('#expense-annual-month').value) : 1 };
  let templateId = id;
  let error;
  if (id) {
    ({ error } = await supabase.from('fixed_expenses').update(values).eq('id', id));
    if (!error) ({ error } = await supabase.from('monthly_expenses').update({ name: values.name, amount: values.amount, due_day: values.due_day, category: values.category, frequency: values.frequency, annual_month: values.annual_month }).eq('fixed_expense_id', id).eq('month', monthKey()));
  } else {
    const result = await supabase.from('fixed_expenses').insert(values).select('id').single();
    error = result.error;
    templateId = result.data?.id;
    const isDueThisMonth = isDueInMonth(values, viewedMonth);
    if (!error && isDueThisMonth) ({ error } = await supabase.from('monthly_expenses').insert({ user_id: currentUser.id, fixed_expense_id: templateId, month: monthKey(), name: values.name, amount: values.amount, due_day: values.due_day, category: values.category, frequency: values.frequency, annual_month: values.annual_month }));
  }
  busy = false;
  if (error) return showError(error);
  $('#expense-dialog').close();
  await loadMonth();
});

$('#expense-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || busy) return;
  if (button.dataset.action === 'add') return openDialog();
  const item = expenses.find((expense) => expense.id === button.closest('[data-id]')?.dataset.id);
  if (!item) return;
  busy = true;
  let error;
  if (button.dataset.action === 'toggle') {
    ({ error } = await supabase.from('monthly_expenses').update({ paid: !item.paid, paid_at: item.paid ? null : new Date().toISOString() }).eq('id', item.id));
  } else if (button.dataset.action === 'edit') {
    busy = false;
    return openDialog(item);
  } else if (button.dataset.action === 'delete' && window.confirm(`¿Eliminar «${item.name}» de tus gastos fijos? Se conservarán los meses anteriores.`)) {
    ({ error } = await supabase.from('fixed_expenses').update({ active: false }).eq('id', item.fixed_expense_id));
    if (!error) ({ error } = await supabase.from('monthly_expenses').delete().eq('id', item.id));
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

const { data: { user } } = await supabase.auth.getUser();
if (user) await showApp(user);
else { $('#auth-screen').hidden = false; document.querySelector('.app-shell').hidden = true; }
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session) { currentUser = null; $('#auth-screen').hidden = false; document.querySelector('.app-shell').hidden = true; }
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch((error) => console.error('No se pudo registrar la app móvil:', error)));
}
