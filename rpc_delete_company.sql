-- rpc_delete_company.sql
-- Este script crea una función segura para que un superadmin elimine una empresa.
-- A diferencia del borrado simple de tabla que deja a los usuarios "huérfanos" en auth.users,
-- esta función se encarga de ir a la tabla interna de Supabase Auth y borrar a los usuarios reales,
-- lo cual desencadena en cascada el borrado de sus perfiles, y finalmente borra la empresa con
-- sus transacciones y categorías.

CREATE OR REPLACE FUNCTION delete_company_and_users(p_company_id UUID)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
BEGIN
    -- 1. Verificación de Seguridad
    IF NOT auth_user_is_superadmin() THEN
        RAISE EXCEPTION 'Acceso Denegado. Solo los superadmins pueden eliminar empresas.';
    END IF;

    -- 2. Recolectar a todos los usuarios que pertenezcan a esta empresa EXCEPTUANDO al superadmin
    -- (Por si acaso el superadmin estuviera linkeado a esta empresa)
    FOR v_user IN (SELECT id FROM public.profiles WHERE company_id = p_company_id AND role != 'superadmin') LOOP
        -- Borrar el usuario desde la raíz de Supabase (auth.users)
        -- Esto automáticamente dispara los ON DELETE CASCADE hacia public.profiles y auth.identities
        DELETE FROM auth.users WHERE id = v_user.id;
    END LOOP;

    -- 3. Borrar la empresa
    -- Esto disparará los ON DELETE CASCADE hacia transacciones y categorías.
    DELETE FROM public.companies WHERE id = p_company_id;

    RETURN json_build_object('success', true, 'message', 'Empresa y todos sus usuarios han sido eliminados.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
