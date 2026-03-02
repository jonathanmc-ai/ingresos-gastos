-- multi_tenant_schema.sql
-- Este script actualiza tu base de datos actual para soportar Multi-empresa.
-- ADVERTENCIA: Las tablas de transacciones y categorías se vaciarán para evitar conflictos con datos sin empresa.

TRUNCATE TABLE transactions CASCADE;
TRUNCATE TABLE categories CASCADE;

-- 1. Crear tabla de Empresas (companies)
CREATE TABLE companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Crear tabla de Perfiles (profiles) ligada a Supabase Auth y a Companies
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('superadmin', 'company_admin', 'company_user')) NOT NULL DEFAULT 'company_user',
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Modificar tablas existentes para que pertenezcan a una empresa
ALTER TABLE categories ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- 4. Habilitar seguridad a nivel de fila (RLS) en todas las tablas
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 5. Eliminar las políticas antiguas (inseguras) de prueba
DROP POLICY IF EXISTS "Permitir todo a todos" ON categories;
DROP POLICY IF EXISTS "Permitir todo a todos" ON transactions;
DROP POLICY IF EXISTS "Enable all access for all users" ON categories;
DROP POLICY IF EXISTS "Enable all access for all users" ON transactions;

-- 6. Funciones Helper para las nuevas políticas seguras
CREATE OR REPLACE FUNCTION auth_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth_user_is_superadmin()
RETURNS BOOLEAN AS $$
  SELECT role = 'superadmin' FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 7. Crear Nuevas Políticas RLS Seguras

-- COMPANIES
CREATE POLICY "Superadmins pueden ver y modificar todas las empresas" ON companies
  FOR ALL TO authenticated USING (auth_user_is_superadmin() = true);

CREATE POLICY "Usuarios pueden ver su propia empresa" ON companies
  FOR SELECT TO authenticated USING (id = auth_user_company_id());

-- PROFILES
CREATE POLICY "Superadmins pueden todo en perfiles" ON profiles
  FOR ALL TO authenticated USING (auth_user_is_superadmin() = true);

CREATE POLICY "Usuarios pueden ver perfiles de su propia empresa" ON profiles
  FOR SELECT TO authenticated USING (company_id = auth_user_company_id());

CREATE POLICY "Usuarios pueden actualizar su propio perfil" ON profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

-- CATEGORIES
CREATE POLICY "Superadmins pueden todo en categorias" ON categories
  FOR ALL TO authenticated USING (auth_user_is_superadmin() = true);

CREATE POLICY "Usuarios pueden ver/editar categorias de su empresa" ON categories
  FOR ALL TO authenticated 
  USING (company_id = auth_user_company_id())
  WITH CHECK (company_id = auth_user_company_id());

-- TRANSACTIONS
CREATE POLICY "Superadmins pueden todo en transacciones" ON transactions
  FOR ALL TO authenticated USING (auth_user_is_superadmin() = true);

CREATE POLICY "Usuarios pueden ver/editar transacciones de su empresa" ON transactions
  FOR ALL TO authenticated 
  USING (company_id = auth_user_company_id())
  WITH CHECK (company_id = auth_user_company_id());

-- 8. Trigger automático para nuevos registros en Auth
-- Cuando alguien se registra o le invitas por Supabase Auth, se le crea un perfil automáticamente.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', 'company_user');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
