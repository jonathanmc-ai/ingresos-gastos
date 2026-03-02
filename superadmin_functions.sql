-- superadmin_functions.sql
-- Estas funciones permiten al Superadmin y a los Company Admins crear usuarios usando la base de datos
-- porque el cliente Javascript de Supabase no permite crear otros usuarios directamente por seguridad.

-- 1. Activa y configura pgcrypto si no está instalado (necesario para contraseñas)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Función para que el Superadmin cree un Company Admin
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
BEGIN
    -- Verificar que quien llama a esto es Superadmin
    IF NOT auth_user_is_superadmin() THEN
        RAISE EXCEPTION 'Solo los superadmins pueden crear empresas y administradores';
    END IF;

    -- Crear la nueva Empresa
    INSERT INTO public.companies (name) VALUES (new_company_name) RETURNING id INTO new_company_id;

    -- Generar UUID y hash de contraseña para Supabase Auth
    new_user_id := gen_random_uuid();
    encrypted_pw := crypt(admin_password, gen_salt('bf'));

    -- Insertar silenciosamente en auth.users (sin enviar email de confirmación por ahora)
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', admin_email, encrypted_pw, now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', admin_name), now(), now()
    );

    -- Insertar en auth.identities
    INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
        gen_random_uuid(), new_user_id::text, new_user_id, jsonb_build_object('sub', new_user_id::text, 'email', admin_email), 'email', now(), now(), now()
    );

    -- Actualizar el perfil que se creó en el trigger anterior para asignarle la empresa y el rol
    UPDATE public.profiles 
    SET company_id = new_company_id, role = 'company_admin'
    WHERE id = new_user_id;

    RETURN json_build_object('success', true, 'company_id', new_company_id, 'user_id', new_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Función para que un Company Admin invite/cree usuarios en su propia empresa
CREATE OR REPLACE FUNCTION create_company_user(
    user_email TEXT,
    user_password TEXT,
    user_name TEXT
) RETURNS JSON AS $$
DECLARE
    caller_role TEXT;
    caller_company_id UUID;
    new_user_id UUID;
    encrypted_pw TEXT;
BEGIN
    -- Obtener rol y empresa de quien llama a la función
    SELECT role, company_id INTO caller_role, caller_company_id FROM public.profiles WHERE id = auth.uid();

    -- Verificar permisos (Solo admins de la empresa o superadmins)
    IF caller_role != 'company_admin' AND caller_role != 'superadmin' THEN
        RAISE EXCEPTION 'No tienes permisos para crear usuarios en esta empresa';
    END IF;

    -- Generar UUID y hash
    new_user_id := gen_random_uuid();
    encrypted_pw := crypt(user_password, gen_salt('bf'));

    -- Insertar en auth.users
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', user_email, encrypted_pw, now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', user_name), now(), now()
    );

    -- Insertar en auth.identities
    INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
        gen_random_uuid(), new_user_id::text, new_user_id, jsonb_build_object('sub', new_user_id::text, 'email', user_email), 'email', now(), now(), now()
    );

    -- Actualizar el perfil del nuevo empleado para asignarle la MISMA empresa que su admin
    UPDATE public.profiles 
    SET company_id = caller_company_id, role = 'company_user'
    WHERE id = new_user_id;

    RETURN json_build_object('success', true, 'user_id', new_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
