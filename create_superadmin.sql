-- create_superadmin.sql
-- Ejecuta este script en el SQL Editor de Supabase para crear un superadmin

-- Variables (Cambia el email y la contraseña según lo que necesites)
DO $$
DECLARE
    v_admin_email TEXT := 'sebastianm2s@icloud.com';
    v_admin_password TEXT := 'Voxera_2026*secure';
    v_admin_name TEXT := 'Sebastian';
    v_user_id UUID := gen_random_uuid();
    v_encrypted_pw TEXT;
BEGIN
    -- Validar que no exista ya
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_admin_email) THEN
        RAISE EXCEPTION 'El correo electrónico % ya está registrado', v_admin_email;
    END IF;

    -- Generar el hash de la contraseña usando pgcrypto
    v_encrypted_pw := crypt(v_admin_password, gen_salt('bf'));

    -- 1. Insertar el usuario en Supabase Auth
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        last_sign_in_at, recovery_sent_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', 
        v_admin_email, v_encrypted_pw, now(), 
        '{"provider":"email","providers":["email"]}', 
        jsonb_build_object('full_name', v_admin_name), now(), now(),
        '', '', '', '', now(), now()
    );

    -- 2. Insertar la identidad
    INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
        gen_random_uuid(), v_user_id::text, v_user_id, 
        jsonb_build_object('sub', v_user_id::text, 'email', v_admin_email), 
        'email', now(), now(), now()
    );

    -- 3. Actualizar su perfil (creado automáticamente por el trigger) para forzar el rol de superadmin
    UPDATE public.profiles 
    SET role = 'superadmin', full_name = v_admin_name, can_view = true, can_create = true, can_edit = true, can_delete = true
    WHERE id = v_user_id;

END;
$$;
