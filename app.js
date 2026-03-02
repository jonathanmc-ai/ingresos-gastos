// ============================================
// LÓGICA DE LA APLICACIÓN (app.js)
// ============================================

// Variables Globales
let transactions = [];
let categories = [];
let userProfile = null;
let currentFilter = 'month'; // 'week', 'month', 'year'

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
        const d = new Date(t.date);
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

    fetchTransactions().then(() => {
        updateDashboardUI();
        renderFullTransactions(); // update new view as well
    });
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
            <div class="card" style="display: flex; align-items: center; gap: 16px; padding: 16px;">
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
        `;
        grid.insertAdjacentHTML('beforeend', html);
    });
};

window.openCategoryModal = function () {
    document.getElementById('categoryModal').classList.add('active');
    document.getElementById('catNameInput').value = '';
    document.getElementById('catIconInput').value = '🏷️';
    document.getElementById('catColorInput').value = '#3b82f6';
};

window.closeCategoryModal = function () {
    document.getElementById('categoryModal').classList.remove('active');
};

window.setCatType = function (el, type) {
    document.querySelectorAll('#categoryModal .type-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
};

window.saveCategory = async function () {
    if (!userProfile || !userProfile.can_create) {
        alert("No tienes permisos para crear categorías.");
        return;
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

    const newCategory = {
        name,
        icon: icon || '🏷️',
        color,
        type
        // company_id se inserta automáticamente por base de datos o manejado por trigger?
        // Actualmente RLS exige que en el insert el user pase el company_id, 
        // a menos que tengamos un trigger, mejor pasarlo explícitamente.
    };

    // Obtenemos el company_id activo (el del user profile o del audit)
    const activeCompanyId = (userProfile.role === 'superadmin' && auditCompanyId) ? auditCompanyId : userProfile.company_id;
    newCategory.company_id = activeCompanyId;

    const { data, error } = await supabaseClient
        .from('categories')
        .insert([newCategory])
        .select();

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
        const d = new Date(t.date);
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
