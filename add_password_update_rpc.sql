-- add_password_update_rpc.sql
-- Ejecuta este script en el SQL Editor de Supabase para añadir la función de cambio de contraseña
-- permitiendo a un Administrador de Empresa cambiar la contraseña de sus empleados.

CREATE OR REPLACE FUNCTION update_company_user_password(
    p_user_id UUID,
    p_new_password TEXT
) RETURNS JSON AS $$
DECLARE
    caller_role TEXT;
    caller_company_id UUID;
    target_company_id UUID;
    encrypted_pw TEXT;
BEGIN
    -- Validar que la contraseña no esté vacía
    IF p_new_password IS NULL OR TRIM(p_new_password) = '' THEN
        RAISE EXCEPTION 'La contraseña no puede estar vacía.';
    END IF;

    -- Obtener rol y empresa de quien llama a la función
    SELECT role, company_id INTO caller_role, caller_company_id 
    FROM public.profiles WHERE id = auth.uid();
    
    -- Obtener la empresa del usuario objetivo
    SELECT company_id INTO target_company_id 
    FROM public.profiles WHERE id = p_user_id;

    -- Verificar permisos (Solo admins de la MISMA empresa o superadmins)
    IF caller_role = 'superadmin' THEN
        -- Permitido
        NULL;
    ELSIF caller_role = 'company_admin' THEN
        IF caller_company_id != target_company_id THEN
            RAISE EXCEPTION 'No puedes modificar la contraseña de un usuario de otra empresa.';
        END IF;
    ELSE
        RAISE EXCEPTION 'No tienes permisos de administrador para cambiar contraseñas.';
    END IF;

    -- Encriptar nueva contraseña usando pgcrypto
    encrypted_pw := extensions.crypt(p_new_password, extensions.gen_salt('bf'));

    -- Actualizar contraseña en auth.users
    UPDATE auth.users 
    SET encrypted_password = encrypted_pw, updated_at = now() 
    WHERE id = p_user_id;
    
    -- Opcional pero recomendado: forzar cierre de sesión del usuario en todos los dispositivos
    DELETE FROM auth.refresh_tokens WHERE session_id IN (SELECT id FROM auth.sessions WHERE user_id = p_user_id);
    DELETE FROM auth.sessions WHERE user_id = p_user_id;

    RETURN json_build_object('success', true, 'user_id', p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
