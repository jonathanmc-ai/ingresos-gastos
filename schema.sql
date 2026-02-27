-- Crear tabla de Categorías
CREATE TABLE categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '🏷️',
  color TEXT DEFAULT '#94a3b8',
  type TEXT CHECK (type in ('income', 'expense')) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear tabla de Transacciones (Ingresos o Gastos)
CREATE TABLE transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  type TEXT CHECK (type in ('income', 'expense')) NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS (Seguridad) temporalmente abierta para desarrollo sin Login
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo a anon users en categories" ON categories FOR ALL USING (true);
CREATE POLICY "Permitir todo a anon users en transactions" ON transactions FOR ALL USING (true);

-- Insertar algunas categorías por defecto para empezar
INSERT INTO categories (name, icon, color, type) VALUES
  ('Salario', '💰', '#10b981', 'income'),
  ('Freelance', '💻', '#3b82f6', 'income'),
  ('Alimentación', '🍕', '#f97316', 'expense'),
  ('Hogar', '🏠', '#3b82f6', 'expense'),
  ('Transporte', '🚗', '#10b981', 'expense'),
  ('Ocio', '🎮', '#a855f7', 'expense'),
  ('Salud', '💊', '#ef4444', 'expense'),
  ('Otros', '📦', '#eab308', 'expense');
