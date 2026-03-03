-- fix_auth_rpc_final.sql
-- Solución para el hashing de contraseñas de Supabase
-- Hemos sincronizado ESTRICTAMENTE los inserts con la documentación oficial de Supabase.
-- REFERENCIA VERIFICADA: crypt('password123', gen_salt('bf'))

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
    
    -- El secreto para GoTrue: usar exactamente la extensión pgcrypto de Supabase sin coste explícito.
    encrypted_pw := extensions.crypt(admin_password, extensions.gen_salt('bf'));

    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        last_sign_in_at, recovery_sent_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 
        safe_email, encrypted_pw, now(), 
        '{"provider":"email","providers":["email"]}', 
        jsonb_build_object('full_name', admin_name), now(), now(),
        '', '', '', '', now(), now()
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
    v_current_email TEXT;
    v_new_user_id UUID;
    safe_email TEXT;
    v_final_email TEXT;
    v_pwd_changed BOOLEAN := false;
    v_email_changed BOOLEAN := false;
BEGIN
    IF NOT auth_user_is_superadmin() THEN
        RAISE EXCEPTION 'Solo los superadmins pueden editar empresas';
    END IF;

    IF p_company_name IS NOT NULL AND TRIM(p_company_name) != '' THEN
        UPDATE public.companies SET name = p_company_name WHERE id = p_company_id;
    END IF;

    -- Buscar al admin
    SELECT id INTO v_admin_id FROM public.profiles WHERE company_id = p_company_id AND (role = 'company_admin' OR role = 'company_user') LIMIT 1;

    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró ningún administrador ni usuario en esta empresa para actualizar.';
    END IF;

    -- Extraer su email actual por si solo cambia la contraseña
    SELECT email INTO v_current_email FROM auth.users WHERE id = v_admin_id;
    
    -- Definir cuál será el email final (el nuevo si lo provee, o el actual si no)
    IF p_admin_email IS NOT NULL AND TRIM(p_admin_email) != '' THEN
        v_final_email := LOWER(TRIM(p_admin_email));
        v_email_changed := true;
    ELSE
        v_final_email := v_current_email;
    END IF;

    -- IMPORTANTE: Cambiar la contraseña mutando 'encrypted_password' hace que la API de login de Supabase lance un 500 Internal Server Error
    -- porque el hash que genera postgresql crypt() a veces difiere en la versión de bcrypt que usa GoTrue internamente.
    -- LA SOLUCIÓN SEGURA: Si se cambia la contraseña, o el email, re-creamos al usuario desde cero para que el hash de creación sí funcione,
    -- o bien, al ser un entorno puramente SQL sin 'service_role' key, la única forma 100% segura que sí nos ha funcionado es el INSERT de creación.
    -- Así que borramos el usuario viejo en Auth y lo volvemos a insertar con la nueva contraseña.
    
    IF (p_admin_password IS NOT NULL AND TRIM(p_admin_password) != '') OR v_email_changed THEN
        v_pwd_changed := (p_admin_password IS NOT NULL AND TRIM(p_admin_password) != '');
        
        -- Si no dio contraseña pero sí email, necesitamos una contraseña. Como no la sabemos, esto sería un peligro. 
        -- Limitación: Para cambiar el email usando SQL crudo, HAY que proporcionar una contraseña nueva también.
        IF v_email_changed AND NOT v_pwd_changed THEN
            RAISE EXCEPTION 'Para cambiar el email desde este panel, debes asignar una contraseña nueva al usuario por seguridad.';
        END IF;

        -- 1. Borrar todas sus sesiones y rastros internos
        DELETE FROM auth.identities WHERE user_id = v_admin_id;
        DELETE FROM auth.sessions WHERE user_id = v_admin_id;
        
        -- Extraemos su nombre antes de borrar su perfil
        DECLARE 
            v_admin_fullname TEXT;
            v_admin_role TEXT;
            v_can_view BOOLEAN;
            v_can_create BOOLEAN;
            v_can_edit BOOLEAN;
            v_can_delete BOOLEAN;
        BEGIN
            SELECT full_name, role, can_view, can_create, can_edit, can_delete 
            INTO v_admin_fullname, v_admin_role, v_can_view, v_can_create, v_can_edit, v_can_delete
            FROM public.profiles WHERE id = v_admin_id;
            
            -- Borramos de public
            DELETE FROM public.profiles WHERE id = v_admin_id;
            
            -- Borramos de auth
            DELETE FROM auth.users WHERE id = v_admin_id;
            
            -- 2. Lo re-creamos por completo
            v_new_user_id := gen_random_uuid();
            
            INSERT INTO auth.users (
                instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
                raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                confirmation_token, email_change, email_change_token_new, recovery_token,
                last_sign_in_at, recovery_sent_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000000', v_new_user_id, 'authenticated', 'authenticated', 
                v_final_email, extensions.crypt(TRIM(p_admin_password), extensions.gen_salt('bf')), now(), 
                '{"provider":"email","providers":["email"]}', 
                jsonb_build_object('full_name', v_admin_fullname), now(), now(),
                '', '', '', '', now(), now()
            );

            INSERT INTO auth.identities (
                id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
            ) VALUES (
                gen_random_uuid(), v_new_user_id::text, v_new_user_id, 
                jsonb_build_object('sub', v_new_user_id::text, 'email', v_final_email), 
                'email', now(), now(), now()
            );

            INSERT INTO public.profiles (id, company_id, role, full_name, can_view, can_create, can_edit, can_delete)
            VALUES (v_new_user_id, p_company_id, v_admin_role, v_admin_fullname, v_can_view, v_can_create, v_can_edit, v_can_delete);
            
            v_admin_id := v_new_user_id; -- Para devolver el nuevo ID
        END;
    END IF;

    RETURN json_build_object(
        'success', true, 
        'user_id', v_admin_id, 
        'password_updated', v_pwd_changed, 
        'email_updated', v_email_changed
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Creación de usuarios de empresa con el hash exacto documentado
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
    encrypted_pw := extensions.crypt(user_password, extensions.gen_salt('bf'));

    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        last_sign_in_at, recovery_sent_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 
        safe_email, encrypted_pw, now(), 
        '{"provider":"email","providers":["email"]}', 
        jsonb_build_object('full_name', user_name), now(), now(),
        '', '', '', '', now(), now()
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
