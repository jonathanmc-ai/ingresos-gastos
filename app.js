// ============================================
// LÓGICA DE LA APLICACIÓN (app.js)
// ============================================

// Variables Globales
let transactions = [];
let categories = [];
let userProfile = null;
let currentFilter = 'month'; // 'week', 'month', 'year', 'all', 'custom'
let customDateFrom = null;
let customDateTo = null;

// Variables de Auditoría
let auditCompanyId = localStorage.getItem('audit_company_id');
let auditCompanyName = localStorage.getItem('audit_company_name');

// 1. Inicialización y Autenticación
document.addEventListener('DOMContentLoaded', async () => {
    // Escuchar cambios de estado para una sesión persistente
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            window.location.href = 'login.html';
        }
    });

    // Verificar si hay sesión activa (con un pequeño retraso por si acaso tarda en leer Storage)
    let { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

    if (!session) {
        // Redirigir al login si definitivamente no está autenticado
        window.location.href = 'login.html';
        return;
    }

    // Obtener perfil y permisos del usuario
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

    userProfile = profile;

    // Si hay sesión, cargar datos
    await fetchCategories();
    await fetchTransactions();

    // Obtener nombre del usuario para la UI
    const username = session.user.user_metadata?.full_name || session.user.email;
    const userEmail = session.user.email;

    // Actualizar Avatar
    const avatarInitials = username.substring(0, 2).toUpperCase();
    document.querySelector('.avatar').textContent = avatarInitials;
    document.querySelector('.user-name').textContent = username;
    document.querySelector('.user-email').textContent = userEmail;

    // Control de UI basado en Roles y Permisos
    if (userProfile) {
        // Mostrar enlaces de admin según rol
        if (userProfile.role === 'superadmin') {
            const superadminLink = document.getElementById('nav-superadmin');
            if (superadminLink) superadminLink.style.display = 'flex';
        }
        if (userProfile.role === 'company_admin') {
            const equipoLink = document.getElementById('nav-equipo');
            if (equipoLink) equipoLink.style.display = 'flex';
        }

        // Bloquear creación de transacciones si no tiene permiso `can_create`
        if (!userProfile.can_create) {
            const addBtn = document.querySelector('.btn-primary[onclick="openModal()"]');
            if (addBtn) addBtn.style.display = 'none';
            // También ocultamos el botón de crear categoría nueva
            const addCatBtn = document.getElementById('btn-new-category');
            if (addCatBtn) addCatBtn.style.display = 'none';
        } else {
            // Mostrar si tiene permiso
            const addCatBtn = document.getElementById('btn-new-category');
            if (addCatBtn) addCatBtn.style.display = 'inline-block';
        }

        // --- MODO AUDITORÍA DE SUPERADMIN ---
        if (userProfile.role === 'superadmin' && auditCompanyId) {
            const banner = document.getElementById('auditBanner');
            const nameEl = document.getElementById('auditCompanyName');

            if (banner && nameEl) {
                banner.style.display = 'block';
                nameEl.textContent = auditCompanyName || 'Desconocida';
            }
        }
    }

    updateDashboardUI();
    setupEventListeners();
});

// 2. Obtener Datos de Supabase
async function fetchCategories() {
    let query = supabaseClient
        .from('categories')
        .select('*')
        .order('name', { ascending: true });

    // Si estamos en modo auditoría como superadmin, forzamos el filtro por empresa
    if (userProfile?.role === 'superadmin' && auditCompanyId) {
        query = query.eq('company_id', auditCompanyId);
    } // Si NO estamos auditando pero somos superadmin, por RLS veríamos todo (no ideal para el dashboard), 
    // pero asumimos que el superadmin casi siempre entrará desde su panel seleccionando auditar.

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching categories:', error);
        return;
    }
    categories = data;
}

async function fetchTransactions() {
    let query = supabaseClient
        .from('transactions')
        .select(`
      *,
      categories (
        name,
        icon,
        color
      )
    `)
        .order('date', { ascending: false });

    // Forzar filtro en modo auditoría
    if (userProfile?.role === 'superadmin' && auditCompanyId) {
        query = query.eq('company_id', auditCompanyId);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching transactions:', error);
        return;
    }
    transactions = data;
}

// Helper para parsear fechas sin problemas de zona horaria
// new Date('2026-03-07') se interpreta como UTC, lo que en UTC+1 (España) puede dar el día/mes anterior
function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const parts = String(dateStr).split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2] || 1));
}

// Helper para obtener la fecha local de hoy como 'YYYY-MM-DD' sin desfase UTC
function todayLocalStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 3. Obtener transacciones filtradas según el filtro activo del Dashboard
function getFilteredTransactions() {
    const now = new Date();

    if (currentFilter === 'all') {
        return transactions;
    }

    if (currentFilter === 'custom' && customDateFrom && customDateTo) {
        const from = parseLocalDate(customDateFrom);
        const to = parseLocalDate(customDateTo);
        // Set "to" to end of day
        to.setHours(23, 59, 59, 999);
        return transactions.filter(t => {
            const d = parseLocalDate(t.date);
            return d >= from && d <= to;
        });
    }

    if (currentFilter === 'week') {
        // Últimos 7 días
        const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
        return transactions.filter(t => {
            const d = parseLocalDate(t.date);
            return d >= weekAgo && d <= now;
        });
    }

    if (currentFilter === 'year') {
        // Año actual completo
        return transactions.filter(t => {
            const d = parseLocalDate(t.date);
            return d.getFullYear() === now.getFullYear();
        });
    }

    // Default: 'month' — Mes actual
    return transactions.filter(t => {
        const d = parseLocalDate(t.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
}

// 3.a Obtener texto descriptivo del filtro activo
function getFilterLabel() {
    const now = new Date();
    if (currentFilter === 'week') return 'Últimos 7 días';
    if (currentFilter === 'year') return now.getFullYear().toString();
    if (currentFilter === 'all') return 'Todo el historial';
    if (currentFilter === 'custom' && customDateFrom && customDateTo) {
        const from = parseLocalDate(customDateFrom);
        const to = parseLocalDate(customDateTo);
        const fmt = (d) => d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        return `${fmt(from)} — ${fmt(to)}`;
    }
    // Default: month
    return now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

// 3.b Cambiar el filtro del Dashboard
window.setDashboardFilter = function (filter, el) {
    currentFilter = filter;

    // Actualizar botones activos
    document.querySelectorAll('#dashboardFilterTabs .chart-tab').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');

    // Mostrar/ocultar picker de fechas personalizado
    const customPicker = document.getElementById('customDateRange');
    if (customPicker) {
        customPicker.style.display = filter === 'custom' ? 'flex' : 'none';
    }

    // Si no es custom, actualizar directamente
    if (filter !== 'custom') {
        updateDashboardUI();
    }
};

// 3.c Aplicar filtro de fechas personalizado
window.applyCustomDateFilter = function () {
    const fromInput = document.getElementById('dashFilterFrom');
    const toInput = document.getElementById('dashFilterTo');

    if (!fromInput.value || !toInput.value) {
        alert('Por favor selecciona ambas fechas (Desde y Hasta).');
        return;
    }

    if (fromInput.value > toInput.value) {
        alert('La fecha "Desde" no puede ser posterior a la fecha "Hasta".');
        return;
    }

    customDateFrom = fromInput.value;
    customDateTo = toInput.value;
    currentFilter = 'custom';
    updateDashboardUI();
};

// 3.d Actualizar la UI del Dashboard
function updateDashboardUI() {
    if (!document.getElementById('view-dashboard').classList.contains('active')) return;

    // Filtrar transacciones según el filtro activo
    const filteredTxns = getFilteredTransactions();

    // Actualizar subtítulo del topbar
    const topbarSub = document.querySelector('.topbar-left p');
    if (topbarSub) topbarSub.textContent = getFilterLabel();

    // Calcular totales
    let totalIncome = 0;
    let totalExpense = 0;

    filteredTxns.forEach(t => {
        if (t.type === 'income') totalIncome += parseFloat(t.amount);
        else if (t.type === 'expense') totalExpense += parseFloat(t.amount);
    });

    const balance = totalIncome - totalExpense;

    // Actualizar Tarjetas Superiores
    document.querySelector('.summary-card.income .card-amount').textContent = `€${totalIncome.toFixed(2).replace('.', ',')}`;
    document.querySelector('.summary-card.expense .card-amount').textContent = `€${totalExpense.toFixed(2).replace('.', ',')}`;
    document.querySelector('.summary-card.balance .card-amount').textContent = `€${balance.toFixed(2).replace('.', ',')}`;

    // Actualizar Lista de Últimas Transacciones (las últimas 5 del rango filtrado)
    renderRecentTransactions(filteredTxns);
    // Actualizar Categorías (gastos del rango filtrado)
    renderCategoryProgress(totalExpense, filteredTxns);
    // Actualizar Gráfico
    renderDashboardChart();
}

// 3.b Renderizar Gráfico de Ingresos vs Gastos (Últimos 6 meses)
function renderDashboardChart() {
    const chartContainer = document.getElementById('dashboardChartContainer');
    if (!chartContainer) return;

    chartContainer.innerHTML = '';

    const now = new Date();
    const last6Months = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        last6Months.push({
            month: d.getMonth(),
            year: d.getFullYear(),
            label: d.toLocaleDateString('es-ES', { month: 'short' }),
            income: 0,
            expense: 0
        });
    }

    // Agrupar datos por mes
    transactions.forEach(t => {
        const tDate = parseLocalDate(t.date);
        const mIdx = last6Months.findIndex(m => m.month === tDate.getMonth() && m.year === tDate.getFullYear());

        if (mIdx !== -1) {
            if (t.type === 'income') last6Months[mIdx].income += parseFloat(t.amount);
            else last6Months[mIdx].expense += parseFloat(t.amount);
        }
    });

    // Encontrar el valor máximo para escalar las barras (mínimo 100 para evitar división por 0)
    const maxVal = Math.max(...last6Months.map(m => Math.max(m.income, m.expense)), 100);

    last6Months.forEach(m => {
        const incHeight = (m.income / maxVal) * 100;
        const expHeight = (m.expense / maxVal) * 100;

        const html = `
            <div class="chart-bar-group">
                <div class="bar-pair">
                    <div class="bar income" style="height:${incHeight}%" title="Ingresos: €${m.income.toFixed(2)}"></div>
                    <div class="bar expense" style="height:${expHeight}%" title="Gastos: €${m.expense.toFixed(2)}"></div>
                </div>
                <span class="bar-label">${m.label.charAt(0).toUpperCase() + m.label.slice(1)}</span>
            </div>
        `;
        chartContainer.insertAdjacentHTML('beforeend', html);
    });
}

// 4. Renderizar Transacciones Recientes (Máx 5)
function renderRecentTransactions(txnSource) {
    const listContainer = document.querySelector('.txn-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const source = txnSource || transactions;

    if (source.length === 0) {
        listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No hay transacciones en este periodo.</div>';
        return;
    }

    const recentTxns = source.slice(0, 5);

    recentTxns.forEach(t => {
        const isIncome = t.type === 'income';
        const amountClass = isIncome ? 'amount-positive' : 'amount-negative';
        const prefix = isIncome ? '+' : '-';

        // Fallbacks
        const catName = t.categories ? t.categories.name : 'Sin categoría';
        const catIcon = t.categories ? t.categories.icon : (isIncome ? '💰' : '💸');
        const catColor = t.categories ? t.categories.color : (isIncome ? '#10b981' : '#ef4444');

        // Formatear fecha
        const d = parseLocalDate(t.date);
        const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

        const html = `
      <div class="txn-item">
        <div class="txn-icon" style="background:${catColor}20;color:${catColor};">${catIcon}</div>
        <div class="txn-details">
          <div class="txn-name">${t.description || 'Sin descripción'}</div>
          <div class="txn-category">${catName} · ${isIncome ? 'Ingreso' : 'Gasto'}</div>
        </div>
        <div class="txn-amount">
          <div class="amount ${amountClass}">${prefix}€${parseFloat(t.amount).toFixed(2).replace('.', ',')}</div>
          <div class="date">${dateStr}</div>
        </div>
      </div>
    `;
        listContainer.insertAdjacentHTML('beforeend', html);
    });
}

// 4.b Renderizar Transacciones Completas (Vista Transacciones)
function renderFullTransactions(filter = 'all') {
    const tbody = document.getElementById('fullTransactionsList');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Aplicar filtro de tipo (all, income, expense)
    const filteredTxns = transactions.filter(t => {
        if (filter === 'all') return true;
        return t.type === filter;
    });

    if (filteredTxns.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--text-muted);">No hay transacciones registradas.</td></tr>`;
        return;
    }

    filteredTxns.forEach(t => {
        const isIncome = t.type === 'income';
        const amountClass = isIncome ? 'amount-positive' : '';
        const prefix = isIncome ? '+' : '';
        const catName = t.categories ? t.categories.name : 'Otra';
        const catColor = t.categories ? t.categories.color : '#eab308';
        const catIcon = t.categories ? t.categories.icon : '📌';

        // Formatear fecha
        const d = parseLocalDate(t.date);
        const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

        const html = `
      <tr>
        <td style="padding: 16px; border-bottom: 1px solid var(--border); color: var(--text-secondary);">${dateStr}</td>
        <td style="padding: 16px; border-bottom: 1px solid var(--border); font-weight: 500;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="background:${catColor}20; color:${catColor}; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px;">
              ${catIcon}
            </div>
            ${t.description || 'Sin descripción'}
          </div>
        </td>
        <td style="padding: 16px; border-bottom: 1px solid var(--border); color: var(--text-secondary);">${catName}</td>
        <td style="padding: 16px; border-bottom: 1px solid var(--border); text-align: right; font-weight: 600;" class="${amountClass}">
          ${prefix}€${parseFloat(t.amount).toFixed(2).replace('.', ',')}
        </td>
        <td style="padding: 16px; border-bottom: 1px solid var(--border); text-align: right;">
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button class="btn btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="editTransaction('${t.id}')">✏️</button>
            <button class="btn btn-outline" style="padding: 4px 8px; font-size: 11px; color: var(--red); border-color: var(--red)20;" onclick="deleteTransaction('${t.id}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
        tbody.insertAdjacentHTML('beforeend', html);
    });
}

// 4.c Filtros de Transacciones Completas
window.setTxnFilter = function (filter) {
    // Quitar activo a todos los botones
    document.getElementById('filterAllTxn').classList.remove('active');
    document.getElementById('filterIncomeTxn').classList.remove('active');
    document.getElementById('filterExpenseTxn').classList.remove('active');

    // Añadir activo al seleccionado
    if (filter === 'all') document.getElementById('filterAllTxn').classList.add('active');
    if (filter === 'income') document.getElementById('filterIncomeTxn').classList.add('active');
    if (filter === 'expense') document.getElementById('filterExpenseTxn').classList.add('active');

    renderFullTransactions(filter);
};

// 5. Renderizar Progreso por Categorías (Solo Gastos)
function renderCategoryProgress(totalExpense, txnSource) {
    const catListContainer = document.querySelector('.category-list');
    if (!catListContainer) return;

    catListContainer.innerHTML = '';

    if (totalExpense === 0) {
        catListContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No hay gastos en este periodo.</div>';
        return;
    }

    // Agrupar gastos del rango filtrado por categoría
    const source = txnSource || transactions;
    const expensesByCategory = {};

    source.forEach(t => {
        if (t.type !== 'expense') return;
        const catId = t.category_id || 'unknown';
        if (!expensesByCategory[catId]) {
            expensesByCategory[catId] = {
                name: t.categories ? t.categories.name : 'Otros',
                color: t.categories ? t.categories.color : '#eab308',
                amount: 0
            };
        }
        expensesByCategory[catId].amount += parseFloat(t.amount);
    });

    // Convertir a array y ordenar de mayor a menor gasto
    const sortedCategories = Object.values(expensesByCategory).sort((a, b) => b.amount - a.amount);

    sortedCategories.forEach(cat => {
        const percentage = Math.min((cat.amount / totalExpense) * 100, 100);

        const html = `
      <div class="category-item">
        <div class="category-dot" style="background:${cat.color};"></div>
        <div class="category-info">
          <div class="category-name">${cat.name}</div>
          <div class="category-bar-bg"><div class="category-bar-fill" style="width:${percentage}%;background:${cat.color};"></div></div>
        </div>
        <div class="category-amount">€${cat.amount.toFixed(0)}</div>
      </div>
    `;
        catListContainer.insertAdjacentHTML('beforeend', html);
    });
}

// 6. Configurar Formulario Modal
function setupEventListeners() {
    const submitBtn = document.getElementById('btn-save-modal');
    const cancelBtn = document.getElementById('btn-cancel-modal');
    const logoutBtn = document.getElementById('logoutBtn');

    if (submitBtn) {
        submitBtn.onclick = async (e) => {
            e.preventDefault();
            await saveTransaction();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = (e) => {
            e.preventDefault();
            closeModal();
            // Reset input values to avoid confusion on next open
            document.querySelector('.amount-input').value = '€0,00';
            document.querySelector('.form-input[placeholder="Ej: Compra semanal..."]').value = '';
        }
    }

    if (logoutBtn) {
        logoutBtn.onclick = async (e) => {
            e.preventDefault();
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        }
    }
}

// Rellenar las "pills" de categorías en el modal según si es ingreso/gasto
function updateModalCategories(type) {
    const pillsContainer = document.querySelector('.category-pills');
    if (!pillsContainer) return;

    pillsContainer.innerHTML = '';

    const filteredCats = categories.filter(c => c.type === type);

    filteredCats.forEach((cat, index) => {
        const isSelected = index === 0 ? 'selected' : '';
        const html = `
      <button class="cat-pill ${isSelected}" data-id="${cat.id}" data-color="${cat.color}" onclick="selectPill(this)">
        ${cat.icon} ${cat.name}
      </button>
    `;
        pillsContainer.insertAdjacentHTML('beforeend', html);
    });
}

// 7. Guardar Nueva Transacción
async function saveTransaction() {
    const amountInput = document.querySelector('.amount-input').value;
    const rawAmount = parseFloat(amountInput.replace('€', '').replace(',', '.').trim());
    const descInput = document.querySelector('.form-input[placeholder="Ej: Compra semanal..."]').value;
    const dateInput = document.querySelector('.form-input[type="date"]').value;
    const isIncome = document.querySelector('.type-btn.income-type').classList.contains('active');
    const type = isIncome ? 'income' : 'expense';

    const selectedPill = document.querySelector('.cat-pill.selected');
    const categoryId = selectedPill ? selectedPill.getAttribute('data-id') : null;

    if (isNaN(rawAmount) || rawAmount <= 0) {
        alert('Por favor introduce una cantidad válida mayor que 0');
        return;
    }

    const saveBtn = document.getElementById('btn-save-modal');
    const editId = saveBtn.getAttribute('data-edit-id');
    const activeCompanyId = (userProfile.role === 'superadmin' && auditCompanyId) ? auditCompanyId : userProfile.company_id;

    const transactionData = {
        amount: rawAmount,
        description: descInput || null,
        date: dateInput || todayLocalStr(),
        type: type,
        category_id: categoryId,
        company_id: activeCompanyId
    };

    let error = null;

    if (editId) {
        const { error: updateError } = await supabaseClient
            .from('transactions')
            .update(transactionData)
            .eq('id', editId);
        error = updateError;
    } else {
        const { error: insertError } = await supabaseClient
            .from('transactions')
            .insert([transactionData]);
        error = insertError;
    }

    if (error) {
        console.error('Error saving transaction:', error);
        alert('Error al guardar la transacción. Revisa la consola.');
        return;
    }

    // Éxito: Cerrar modal, recargar datos y resetear campos
    closeModal();
    document.querySelector('.amount-input').value = '€0,00';
    document.querySelector('.form-input[placeholder="Ej: Compra semanal..."]').value = '';

    fetchTransactions().then(() => {
        updateDashboardUI();
        renderFullTransactions(); // update new view as well
    });
}

// Hookeando las funciones globales del HTML para el Modal
window.openModal = function () {
    document.getElementById('modal').classList.add('active');
    document.querySelector('#modal .modal-title').textContent = "Nueva Transacción";

    // Limpiar estado de edición
    const saveBtn = document.getElementById('btn-save-modal');
    saveBtn.removeAttribute('data-edit-id');
    saveBtn.textContent = 'Guardar';

    // Por defecto carga categorías de Gasto
    const currentType = document.querySelector('.type-btn.income-type').classList.contains('active') ? 'income' : 'expense';
    updateModalCategories(currentType);
    // Poner fecha de hoy
    document.querySelector('.form-input[type="date"]').value = todayLocalStr();
};

window.editTransaction = function (id) {
    const t = transactions.find(txn => txn.id === id);
    if (!t) return;

    document.getElementById('modal').classList.add('active');
    document.querySelector('#modal .modal-title').textContent = "Editar Transacción";

    // Marcar como edición
    const saveBtn = document.getElementById('btn-save-modal');
    saveBtn.setAttribute('data-edit-id', id);
    saveBtn.textContent = 'Actualizar';

    // Rellenar campos
    document.querySelector('.amount-input').value = `€${parseFloat(t.amount).toFixed(2).replace('.', ',')}`;
    document.querySelector('.form-input[placeholder="Ej: Compra semanal..."]').value = t.description || '';
    document.querySelector('.form-input[type="date"]').value = t.date;

    // Set type
    const incomeBtn = document.querySelector('.type-btn.income-type');
    const expenseBtn = document.querySelector('.type-btn.expense-type');
    if (t.type === 'income') {
        setType(incomeBtn, 'income');
    } else {
        setType(expenseBtn, 'expense');
    }

    // Seleccionar categoría (pill)
    setTimeout(() => {
        const pill = document.querySelector(`.cat-pill[data-id="${t.category_id}"]`);
        if (pill) selectPill(pill);
    }, 100);
};

window.deleteTransaction = async function (id) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta transacción?')) return;

    const { error } = await supabaseClient
        .from('transactions')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting transaction:', error);
        alert('Error al eliminar la transacción.');
        return;
    }

    await fetchTransactions();
    updateDashboardUI();
    renderFullTransactions();
};

window.closeModal = function () {
    document.getElementById('modal').classList.remove('active');
};

window.setType = function (el, type) {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    updateModalCategories(type); // Refresca las pills
};

window.selectPill = function (el) {
    document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('selected'));
    el.classList.add('selected');

    // Cambia sutilmente el color del input al seleccionar para feedback visual
    const color = el.getAttribute('data-color') || 'var(--green)';
    el.style.borderColor = color;
    el.style.backgroundColor = color + '20';
    el.style.color = color;

    // Resetea los no seleccionados
    document.querySelectorAll('.cat-pill:not(.selected)').forEach(p => {
        p.style = '';
    });
};

// ============================================
// GESTIÓN DE CATEGORÍAS (VISTA)
// ============================================

window.renderCategoriesView = function () {
    const grid = document.getElementById('fullCategoriesGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (categories.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted);">No hay categorías creadas.</div>';
        return;
    }

    categories.forEach(cat => {
        const typeLabel = cat.type === 'income' ? 'Ingreso' : 'Gasto';
        const typeColor = cat.type === 'income' ? 'var(--green)' : 'var(--orange)';
        const typeBg = cat.type === 'income' ? 'var(--green-bg)' : 'var(--orange-bg)';

        const html = `
            <div class="card category-item-card" style="display: flex; align-items: center; justify-content: space-between; padding: 16px;">
                <div style="display: flex; gap: 16px; align-items: center;">
                    <div style="background:${cat.color}20; color:${cat.color}; width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px;">
                        ${cat.icon}
                    </div>
                    <div>
                        <h4 style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">${cat.name}</h4>
                        <span style="background:${typeBg}; color:${typeColor}; font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 500;">
                            ${typeLabel}
                        </span>
                    </div>
                </div>
                <div class="category-actions" style="display: flex; gap: 8px;">
                    <button class="btn btn-outline" style="padding: 6px 10px; font-size: 12px; border-color: var(--border);" onclick="editCategory('${cat.id}')">Editar</button>
                    ${userProfile?.can_delete ? `<button class="btn btn-outline" style="padding: 6px 10px; font-size: 12px; border-color: var(--red); color: var(--red);" onclick="deleteCategory('${cat.id}')">Eliminar</button>` : ''}
                </div>
            </div>
        `;
        grid.insertAdjacentHTML('beforeend', html);
    });
};

window.editCategory = function (id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;

    // We will reuse the category modal for editing by adding a hidden ID field
    document.getElementById('categoryModal').classList.add('active');
    document.querySelector('#categoryModal .modal-title').textContent = "Editar Categoría";
    document.getElementById('catNameInput').value = cat.name;
    document.getElementById('catIconInput').value = cat.icon;
    document.getElementById('catColorInput').value = cat.color;

    // Configurar el tipo
    document.querySelectorAll('#categoryModal .type-btn').forEach(b => b.classList.remove('active'));
    if (cat.type === 'income') {
        document.getElementById('btn-cat-income').classList.add('active');
    } else {
        document.getElementById('btn-cat-expense').classList.add('active');
    }

    // Guardar el ID en el botón de guardar
    const saveBtn = document.getElementById('btn-save-cat-modal');
    saveBtn.setAttribute('data-edit-id', id);
    saveBtn.textContent = 'Actualizar';
};

window.deleteCategory = async function (id) {
    if (!userProfile || !userProfile.can_delete) {
        alert("No tienes permisos para eliminar categorías.");
        return;
    }

    if (!confirm("¿Seguro que quieres eliminar esta categoría? Las transacciones asociadas perderán su categoría.")) return;

    const { error } = await supabaseClient
        .from('categories')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting category:', error);
        alert('Hubo un error al eliminar. ' + error.message);
        return;
    }

    await fetchCategories();
    renderCategoriesView();
};

window.openCategoryModal = function () {
    document.getElementById('categoryModal').classList.add('active');
    document.querySelector('#categoryModal .modal-title').textContent = "Nueva Categoría";
    document.getElementById('catNameInput').value = '';
    document.getElementById('catIconInput').value = '🏷️';
    document.getElementById('catColorInput').value = '#3b82f6';

    // Limpiar modo edición
    const saveBtn = document.getElementById('btn-save-cat-modal');
    saveBtn.removeAttribute('data-edit-id');
    saveBtn.textContent = 'Crear';
};

window.closeCategoryModal = function () {
    document.getElementById('categoryModal').classList.remove('active');
};

window.setCatType = function (el, type) {
    document.querySelectorAll('#categoryModal .type-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
};

window.saveCategory = async function () {
    const editId = document.getElementById('btn-save-cat-modal').getAttribute('data-edit-id');

    // Check permissions
    if (editId) {
        if (!userProfile || !userProfile.can_edit) {
            alert("No tienes permisos para editar categorías.");
            return;
        }
    } else {
        if (!userProfile || !userProfile.can_create) {
            alert("No tienes permisos para crear categorías.");
            return;
        }
    }

    const name = document.getElementById('catNameInput').value.trim();
    const icon = document.getElementById('catIconInput').value.trim();
    const color = document.getElementById('catColorInput').value;
    const isIncome = document.getElementById('btn-cat-income').classList.contains('active');
    const type = isIncome ? 'income' : 'expense';

    if (!name || name.length < 2) {
        alert("El nombre de la categoría es obligatorio y debe tener al menos 2 letras.");
        return;
    }

    const categoryPayload = {
        name,
        icon: icon || '🏷️',
        color,
        type
    };

    let error = null;

    if (editId) {
        // Update existing category
        const { error: updateError } = await supabaseClient
            .from('categories')
            .update(categoryPayload)
            .eq('id', editId);
        error = updateError;
    } else {
        // Insert new category
        const activeCompanyId = (userProfile.role === 'superadmin' && auditCompanyId) ? auditCompanyId : userProfile.company_id;
        categoryPayload.company_id = activeCompanyId;

        const { error: insertError } = await supabaseClient
            .from('categories')
            .insert([categoryPayload]);
        error = insertError;
    }

    if (error) {
        console.error('Error saving category:', error);
        alert('Hubo un error al guardar la categoría.');
        return;
    }

    window.closeCategoryModal();
    // Recargar datos y vistas
    await fetchCategories();
    renderCategoriesView();
};

// Cerrar modal categoria pinchando fuera
document.getElementById('categoryModal')?.addEventListener('click', function (e) {
    if (e.target === this) window.closeCategoryModal();
});

// ============================================
// INFORMES Y ANALÍTICAS (VISTA)
// ============================================

window.renderReportsView = function () {
    let totalIncome = 0;
    let totalExpense = 0;
    const expensesList = [];

    // Calcular totales históricos
    transactions.forEach(t => {
        const amount = parseFloat(t.amount);
        if (t.type === 'income') {
            totalIncome += amount;
        } else {
            totalExpense += amount;
            expensesList.push(t);
        }
    });

    const balance = totalIncome - totalExpense;

    // Actualizar tarjetas de Totales
    const incomeEl = document.getElementById('repTotalIncome');
    if (incomeEl) incomeEl.textContent = `€${totalIncome.toFixed(2).replace('.', ',')}`;

    const expenseEl = document.getElementById('repTotalExpense');
    if (expenseEl) expenseEl.textContent = `€${totalExpense.toFixed(2).replace('.', ',')}`;

    const balanceEl = document.getElementById('repTotalBalance');
    const balanceCard = document.getElementById('repBalanceCard');

    if (balanceEl && balanceCard) {
        // Formatear balance
        const prefix = balance > 0 ? '+' : '';
        balanceEl.textContent = `${prefix}€${balance.toFixed(2).replace('.', ',')}`;
        // Cambiar color sutil si es negativo
        if (balance < 0) {
            balanceEl.style.color = 'var(--red)';
        } else {
            balanceEl.style.color = 'var(--text-primary)';
        }
    }

    // Top 3 Gastos Históricos
    const topExpensesContainer = document.getElementById('repTopExpensesList');
    if (!topExpensesContainer) return;

    topExpensesContainer.innerHTML = '';

    // Ordenar gastos de mayor a menor y coger los 3 primeros
    expensesList.sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
    const top3 = expensesList.slice(0, 3);

    if (top3.length === 0) {
        topExpensesContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 16px;">No hay gastos registrados todavía.</p>';
        return;
    }

    top3.forEach((t, i) => {
        const catName = t.categories ? t.categories.name : 'Otra';
        const catColor = t.categories ? t.categories.color : '#eab308';
        const catIcon = t.categories ? t.categories.icon : '📌';
        const d = parseLocalDate(t.date);
        const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

        // Medalla para el Top 1, 2 y 3
        const medals = ['🥇', '🥈', '🥉'];
        const medal = medals[i];

        const html = `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border); ${i === 2 ? 'border-bottom: none;' : ''}">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="font-size: 24px; width: 32px; text-align: center;">${medal}</div>
                    <div style="background:${catColor}20; color:${catColor}; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">
                        ${catIcon}
                    </div>
                    <div>
                        <div style="font-weight: 500; color: var(--text-primary);">${t.description || 'Sin descripción'}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">${catName} · ${dateStr}</div>
                    </div>
                </div>
                <div style="font-weight: 600; font-size: 16px; color: var(--red);">
                    -€${parseFloat(t.amount).toFixed(2).replace('.', ',')}
                </div>
            </div>
        `;
        topExpensesContainer.insertAdjacentHTML('beforeend', html);
    });

};

// ============================================
// AJUSTES Y PERFIL (VISTA)
// ============================================

window.renderSettingsView = function () {
    const avatarEl = document.getElementById('setAvatar');
    const nameEl = document.getElementById('setUserName');
    const emailEl = document.getElementById('setUserEmail');
    const roleEl = document.getElementById('setUserRole');

    if (!avatarEl || !nameEl || !emailEl || !roleEl) return;

    if (!userProfile) {
        nameEl.textContent = 'Cargando perfil...';
        return;
    }

    // Set Name & Avatar chars
    const fullName = userProfile.full_name || 'Usuario Anónimo';
    nameEl.textContent = fullName;

    // Configurar iniciales para Avatar
    let initials = 'UA';
    const nameParts = fullName.split(' ');
    if (nameParts.length > 1) {
        initials = nameParts[0].charAt(0).toUpperCase() + nameParts[1].charAt(0).toUpperCase();
    } else if (nameParts.length === 1 && nameParts[0] !== '') {
        initials = nameParts[0].substring(0, 2).toUpperCase();
    }
    avatarEl.textContent = initials;

    // Email dummy, en auth Supabase está en getUser().email pero
    // userProfile solo tiene refs. 
    // Mostraremos un placeholder si no lo consultamos de Supabase Auth
    emailEl.textContent = 'Miembro de ' + (userProfile.companies ? userProfile.companies.name : 'Empresa');

    // Mapeo Roles de inglés a Castellano
    let roleText = 'Usuario';
    switch (userProfile.role) {
        case 'superadmin': roleText = 'Super Administrador'; break;
        case 'company_admin': roleText = 'Administrador de Empresa'; break;
        case 'company_user': roleText = 'Empleado'; break;
    }

    if (auditCompanyId) {
        roleText += ' (Auditor)';
    }

    roleEl.textContent = roleText;
};

// 12. Salir del Modo Auditoría
window.exitAuditMode = function () {
    localStorage.removeItem('audit_company_id');
    localStorage.removeItem('audit_company_name');
    window.location.href = 'superadmin.html';
};
