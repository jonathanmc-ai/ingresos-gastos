-- fix_rls_leaks.sql
-- Borrar cualquier política antigua que estuviera dejando los datos totalmente públicos

DROP POLICY IF EXISTS "Permitir todo a anon users en categories" ON categories;
DROP POLICY IF EXISTS "Permitir todo a anon users en transactions" ON transactions;
DROP POLICY IF EXISTS "Permitir todo a todos" ON categories;
DROP POLICY IF EXISTS "Permitir todo a todos" ON transactions;
DROP POLICY IF EXISTS "Enable all access for all users" ON categories;
DROP POLICY IF EXISTS "Enable all access for all users" ON transactions;

-- Nos aseguramos que las políticas actuales son únicas y sólidas.
-- Estas son las políticas ya creadas antes pero sólo para RE-CONFIRMAR.
-- Confirmar RLS habilitado en todo
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Asignar categorías por defecto a las empresas existentes que no tengan ninguna
DO $$
DECLARE
    empresa RECORD;
BEGIN
    FOR empresa IN SELECT id FROM public.companies LOOP
        IF NOT EXISTS (SELECT 1 FROM public.categories WHERE company_id = empresa.id) THEN
            INSERT INTO public.categories (name, icon, color, type, company_id) VALUES
              ('Salario', '💰', '#10b981', 'income', empresa.id),
              ('Freelance', '💻', '#3b82f6', 'income', empresa.id),
              ('Alimentación', '🍕', '#f97316', 'expense', empresa.id),
              ('Hogar', '🏠', '#3b82f6', 'expense', empresa.id),
              ('Transporte', '🚗', '#10b981', 'expense', empresa.id),
              ('Ocio', '🎮', '#a855f7', 'expense', empresa.id),
              ('Salud', '💊', '#ef4444', 'expense', empresa.id),
              ('Otros', '📦', '#eab308', 'expense', empresa.id);
        END IF;
    END LOOP;
END;
$$;
