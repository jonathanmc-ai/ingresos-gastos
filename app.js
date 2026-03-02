// ============================================
// LÓGICA DE LA APLICACIÓN (app.js)
// ============================================

// Variables Globales
let transactions = [];
let categories = [];
let userProfile = null;
let currentFilter = 'month'; // 'week', 'month', 'year'

// 1. Inicialización y Autenticación
document.addEventListener('DOMContentLoaded', async () => {
    // Verificar si hay sesión activa
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        // Redirigir al login si no está autenticado
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
        }
    }

    updateDashboardUI();
    setupEventListeners();
});

// 2. Obtener Datos de Supabase
async function fetchCategories() {
    const { data, error } = await supabaseClient
        .from('categories')
        .select('*')
        .order('name', { ascending: true });

    if (error) {
        console.error('Error fetching categories:', error);
        return;
    }
    categories = data;
}

async function fetchTransactions() {
    const { data, error } = await supabaseClient
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

    if (error) {
        console.error('Error fetching transactions:', error);
        return;
    }
    transactions = data;
}

// 3. Actualizar la UI del Dashboard
function updateDashboardUI() {
    if (!document.getElementById('view-dashboard').classList.contains('active')) return;

    // Filtrar según el mes actual (por defecto para el resumen)
    const now = new Date();
    const currentMonthTxns = transactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    // Calcular totales
    let totalIncome = 0;
    let totalExpense = 0;

    currentMonthTxns.forEach(t => {
        if (t.type === 'income') totalIncome += parseFloat(t.amount);
        else if (t.type === 'expense') totalExpense += parseFloat(t.amount);
    });

    const balance = totalIncome - totalExpense;

    // Actualizar Tarjetas Superiores
    document.querySelector('.summary-card.income .card-amount').textContent = `€${totalIncome.toFixed(2).replace('.', ',')}`;
    document.querySelector('.summary-card.expense .card-amount').textContent = `€${totalExpense.toFixed(2).replace('.', ',')}`;
    document.querySelector('.summary-card.balance .card-amount').textContent = `€${balance.toFixed(2).replace('.', ',')}`;

    // Actualizar Lista de Últimas Transacciones
    renderRecentTransactions();
    // Actualizar Categorías
    renderCategoryProgress(totalExpense);

    // (Nota: El gráfico visual sigue estático por el momento en el DOM de maqueta)
}

// 4. Renderizar Transacciones Recientes (Máx 5)
function renderRecentTransactions() {
    const listContainer = document.querySelector('.txn-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (transactions.length === 0) {
        listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No hay transacciones todavía.</div>';
        return;
    }

    const recentTxns = transactions.slice(0, 5);

    recentTxns.forEach(t => {
        const isIncome = t.type === 'income';
        const amountClass = isIncome ? 'amount-positive' : 'amount-negative';
        const prefix = isIncome ? '+' : '-';

        // Fallbacks
        const catName = t.categories ? t.categories.name : 'Sin categoría';
        const catIcon = t.categories ? t.categories.icon : (isIncome ? '💰' : '💸');
        const catColor = t.categories ? t.categories.color : (isIncome ? '#10b981' : '#ef4444');

        // Formatear fecha
        const d = new Date(t.date);
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

// 5. Renderizar Progreso por Categorías (Solo Gastos)
function renderCategoryProgress(totalExpense) {
    const catListContainer = document.querySelector('.category-list');
    if (!catListContainer) return;

    catListContainer.innerHTML = '';

    if (totalExpense === 0) {
        catListContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No hay gastos para mostrar este mes.</div>';
        return;
    }

    // Agrupar gastos actuales por categoría
    const now = new Date();
    const expensesByCategory = {};

    transactions.forEach(t => {
        if (t.type !== 'expense') return;
        const d = new Date(t.date);
        if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
            const catId = t.category_id || 'unknown';
            if (!expensesByCategory[catId]) {
                expensesByCategory[catId] = {
                    name: t.categories ? t.categories.name : 'Otros',
                    color: t.categories ? t.categories.color : '#eab308',
                    amount: 0
                };
            }
            expensesByCategory[catId].amount += parseFloat(t.amount);
        }
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

    const transactionData = {
        amount: rawAmount,
        description: descInput || null,
        date: dateInput || new Date().toISOString().split('T')[0],
        type: type,
        category_id: categoryId
    };

    const { error } = await supabaseClient
        .from('transactions')
        .insert([transactionData]);

    if (error) {
        console.error('Error saving transaction:', error);
        alert('Error al guardar la transacción. Revisa la consola.');
        return;
    }

    // Éxito: Cerrar modal, recargar datos y resetear campos
    closeModal();
    document.querySelector('.amount-input').value = '€0,00';
    document.querySelector('.form-input[placeholder="Ej: Compra semanal..."]').value = '';

    await fetchTransactions();
    updateDashboardUI();
}

// Hookeando las funciones globales del HTML para el Modal
window.openModal = function () {
    document.getElementById('modal').classList.add('active');
    // Por defecto carga categorías de Gasto
    const currentType = document.querySelector('.type-btn.income-type').classList.contains('active') ? 'income' : 'expense';
    updateModalCategories(currentType);
    // Poner fecha de hoy
    document.querySelector('.form-input[type="date"]').value = new Date().toISOString().split('T')[0];
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
