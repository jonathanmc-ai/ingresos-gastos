-- fix_categories_and_add_delete_user.sql
-- 1. Arreglar el leak de categorías (asegurando que se borran las políticas viejas)
DROP POLICY IF EXISTS "Permitir todo a todos" ON categories;
DROP POLICY IF EXISTS "Enable all access for all users" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden ver/editar categorias de su empresa" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden ver categorias de su empresa" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden crear categorias en su empresa" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden editar categorias de su empresa" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden borrar categorias de su empresa" ON categories;

CREATE POLICY "Usuarios pueden ver categorias de su empresa" ON categories
  FOR SELECT TO authenticated 
  USING (company_id = auth_user_company_id()); -- Quitamos el auth_user_can('view') de categorias porque siempre se deben poder ver

CREATE POLICY "Usuarios pueden crear categorias en su empresa" ON categories
  FOR INSERT TO authenticated 
  WITH CHECK (company_id = auth_user_company_id() AND auth_user_can('create'));

CREATE POLICY "Usuarios pueden editar categorias de su empresa" ON categories
  FOR UPDATE TO authenticated 
  USING (company_id = auth_user_company_id() AND auth_user_can('edit'))
  WITH CHECK (company_id = auth_user_company_id() AND auth_user_can('edit'));

CREATE POLICY "Usuarios pueden borrar categorias de su empresa" ON categories
  FOR DELETE TO authenticated 
  USING (company_id = auth_user_company_id() AND auth_user_can('delete'));


-- 2. Añadir función para que los Administradores de Empresa puedan borrar a sus empleados
CREATE OR REPLACE FUNCTION delete_company_user(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    caller_role TEXT;
    caller_company_id UUID;
    target_company_id UUID;
BEGIN
    -- Verificar quién llama
    SELECT role, company_id INTO caller_role, caller_company_id 
    FROM public.profiles WHERE id = auth.uid();
    
    -- Verificar la empresa del usuario objetivo
    SELECT company_id INTO target_company_id 
    FROM public.profiles WHERE id = p_user_id;

    IF caller_role = 'superadmin' THEN
        -- El superadmin puede borrar a quien quiera
        NULL;
    ELSIF caller_role = 'company_admin' THEN
        -- El admin normal solo puede borrar a gente de SU MISMA EMPRESA
        IF caller_company_id != target_company_id THEN
            RAISE EXCEPTION 'No tienes permiso para borrar usuarios de otra empresa';
        END IF;
    ELSE
        RAISE EXCEPTION 'Solo los administradores pueden borrar usuarios';
    END IF;

    -- Prevenir auto-borrado accidental
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'No puedes borrarte a ti mismo desde aquí.';
    END IF;

    -- Procedemos con la eliminación limpia (identidades, sesiones, auth y profile)
    DELETE FROM auth.identities WHERE user_id = p_user_id;
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    DELETE FROM auth.refresh_tokens WHERE session_id IN (SELECT id FROM auth.sessions WHERE user_id = p_user_id);
    DELETE FROM public.profiles WHERE id = p_user_id;
    DELETE FROM auth.users WHERE id = p_user_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
