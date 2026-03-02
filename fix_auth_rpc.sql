-- fix_auth_rpc.sql
-- Este script soluciona los problemas de login para usuarios creados/editados desde el panel

-- 1. Actualizar creación de empresas y administradores
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
    -- Prevenir emails en mayúsculas que fallan en el login
    safe_email := LOWER(TRIM(admin_email));

    IF NOT auth_user_is_superadmin() THEN
        RAISE EXCEPTION 'Solo los superadmins pueden crear empresas y administradores';
    END IF;

    -- Comprobar si el email ya existe para evitar errores mudos
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = safe_email) THEN
        RAISE EXCEPTION 'El correo electrónico % ya está registrado', safe_email;
    END IF;

    INSERT INTO public.companies (name) VALUES (new_company_name) RETURNING id INTO new_company_id;

    new_user_id := gen_random_uuid();
    -- Usar coste 10 (estándar de Supabase) y eliminar espacios
    encrypted_pw := crypt(TRIM(admin_password), gen_salt('bf', 10));

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


-- 2. Actualizar Modificación de Empresas y Administradores (Contraseñas)
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
        -- Actualizar contraseña usando el mismo factor de coste y eliminando espacios
        IF p_admin_password IS NOT NULL AND TRIM(p_admin_password) != '' THEN
            v_encrypted_pw := crypt(TRIM(p_admin_password), gen_salt('bf', 10));
            UPDATE auth.users SET encrypted_password = v_encrypted_pw, updated_at = now() WHERE id = v_admin_id;
        END IF;

        -- Actualizar email (siempre en minúsculas)
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


-- 3. Actualizar creación de usuarios normales de empresa
CREATE OR REPLACE FUNCTION create_company_user(
    user_email TEXT,
    user_password TEXT,
    user_name TEXT,
    p_can_view BOOLEAN DEFAULT TRUE,
    p_can_create BOOLEAN DEFAULT FALSE,
    p_can_edit BOOLEAN DEFAULT FALSE,
    p_can_delete BOOLEAN DEFAULT FALSE
) RETURNS JSON AS $$
DECLARE
    caller_role TEXT;
    caller_company_id UUID;
    new_user_id UUID;
    encrypted_pw TEXT;
    safe_email TEXT;
BEGIN
    safe_email := LOWER(TRIM(user_email));

    SELECT role, company_id INTO caller_role, caller_company_id FROM public.profiles WHERE id = auth.uid();

    IF caller_role != 'company_admin' AND caller_role != 'superadmin' THEN
        RAISE EXCEPTION 'No tienes permisos para crear usuarios en esta empresa';
    END IF;

    IF EXISTS (SELECT 1 FROM auth.users WHERE email = safe_email) THEN
        RAISE EXCEPTION 'El correo electrónico % ya está registrado', safe_email;
    END IF;

    new_user_id := gen_random_uuid();
    -- Bcrypt coste 10
    encrypted_pw := crypt(TRIM(user_password), gen_salt('bf', 10));

    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 
        safe_email, encrypted_pw, now(), 
        '{"provider":"email","providers":["email"]}', 
        jsonb_build_object('full_name', user_name), now(), now(),
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
    VALUES (new_user_id, caller_company_id, 'company_user', user_name, p_can_view, p_can_create, p_can_edit, p_can_delete)
    ON CONFLICT (id) DO UPDATE 
    SET 
      company_id = EXCLUDED.company_id, 
      role = EXCLUDED.role,
      full_name = EXCLUDED.full_name,
      can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

    RETURN json_build_object('success', true, 'user_id', new_user_id, 'email', safe_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

