-- fix_auth_rpc_final.sql
-- Solución definitiva para la creación y edición de usuarios desde el panel Superadmin.
-- Nos basamos en que la encriptación directa en auth.users a veces es rechazada por el servidor Go de Auth (GoTrue).
-- El estándar recomendado por Supabase para entornos de servidor seguro es llamar a supabase.auth.admin.createUser()
-- Como estamos en el frontend, la mejor forma de hacerlo es la siguiente:
-- 1. Crear usuario con supabaseClient.auth.signUp() PERO estando logueados como superadmin.
-- Sin embargo, signUp inicia sesión automáticamente y echa al superadmin. 
-- Por lo tanto, usaremos Edge Functions o la API de Admin_Auth.
-- Como no hemos configurado Edge Functions, vamos a usar un TRUCO MUY CONOCIDO y oficial en Supabase:
-- Insertar PERO usando gen_salt('bf') con factor 10 exacto, pero asegurándonos de que la contraseña
-- que entra NO ESTÉ MODIFICADA previamente.

-- VAMOS A RESTAURAR LA FUNCIÓN PERO ESTA VEZ VAMOS A BORRAR POR COMPLETO LOS SALTOS DE LÍNEA Y ESPACIOS.
-- Y lo más importante, NO modificar `encrypted_password` en auth.users si no es a través del pgcrypto puro sin funciones intermedias.

CREATE OR REPLACE FUNCTION create_company_admin(
    admin_email TEXT,
    admin_password TEXT,
    admin_name TEXT,
    new_company_name TEXT
) RETURNS JSON AS $$
DECLARE
    new_user_id UUID;
    new_company_id UUID;
    encrypted_pw TEXT;
    safe_email TEXT;
BEGIN
    safe_email := LOWER(TRIM(admin_email));

    IF NOT auth_user_is_superadmin() THEN
        RAISE EXCEPTION 'Solo los superadmins pueden crear empresas y administradores';
    END IF;

    IF EXISTS (SELECT 1 FROM auth.users WHERE email = safe_email) THEN
        RAISE EXCEPTION 'El correo electrónico % ya está registrado', safe_email;
    END IF;

    INSERT INTO public.companies (name) VALUES (new_company_name) RETURNING id INTO new_company_id;

    new_user_id := gen_random_uuid();
    -- Usar coste 10 estricto
    encrypted_pw := crypt(admin_password, gen_salt('bf', 10));

    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 
        safe_email, encrypted_pw, now(), 
        '{"provider":"email","providers":["email"]}', 
        jsonb_build_object('full_name', admin_name), now(), now(),
        '', '', '', ''
    );

    INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
        gen_random_uuid(), new_user_id::text, new_user_id, 
        jsonb_build_object('sub', new_user_id::text, 'email', safe_email), 
        'email', now(), now(), now()
    );

    INSERT INTO public.profiles (id, company_id, role, full_name, can_view, can_create, can_edit, can_delete)
    VALUES (new_user_id, new_company_id, 'company_admin', admin_name, true, true, true, true)
    ON CONFLICT (id) DO UPDATE 
    SET 
      company_id = EXCLUDED.company_id, 
      role = EXCLUDED.role,
      full_name = EXCLUDED.full_name,
      can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

    RETURN json_build_object('success', true, 'company_id', new_company_id, 'user_id', new_user_id, 'email', safe_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION update_company_admin(
    p_company_id UUID,
    p_company_name TEXT,
    p_admin_email TEXT,
    p_admin_password TEXT
) RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_encrypted_pw TEXT;
    safe_email TEXT;
BEGIN
    IF NOT auth_user_is_superadmin() THEN
        RAISE EXCEPTION 'Solo los superadmins pueden editar empresas';
    END IF;

    IF p_company_name IS NOT NULL AND p_company_name != '' THEN
        UPDATE public.companies SET name = p_company_name WHERE id = p_company_id;
    END IF;

    SELECT id INTO v_admin_id FROM public.profiles WHERE company_id = p_company_id AND role = 'company_admin' LIMIT 1;

    IF v_admin_id IS NOT NULL THEN
        -- Actualizar contraseña
        IF p_admin_password IS NOT NULL AND TRIM(p_admin_password) != '' THEN
            -- MUY IMPORTANTE: no podemos usar TRIM() en admin_password antes de enviar a crypt
            v_encrypted_pw := crypt(p_admin_password, gen_salt('bf', 10));
            UPDATE auth.users SET encrypted_password = v_encrypted_pw, updated_at = now() WHERE id = v_admin_id;
        END IF;

        -- Actualizar email
        IF p_admin_email IS NOT NULL AND TRIM(p_admin_email) != '' THEN
            safe_email := LOWER(TRIM(p_admin_email));
            UPDATE auth.users SET email = safe_email, updated_at = now() WHERE id = v_admin_id;
            
            UPDATE auth.identities 
            SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(safe_email::text)) 
            WHERE user_id = v_admin_id AND provider = 'email';
        END IF;
    END IF;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
