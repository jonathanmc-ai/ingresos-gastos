-- granular_permissions_schema.sql
-- Ejecutar en el SQL Editor de Supabase para añadir soporte de permisos granulares

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Añadir columnas de permisos a la tabla profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS can_view BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS can_create BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_edit BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_delete BOOLEAN DEFAULT FALSE;

-- Por defecto, superadmins y company_admins deberían tener todos los permisos
UPDATE public.profiles 
SET can_view = true, can_create = true, can_edit = true, can_delete = true
WHERE role IN ('superadmin', 'company_admin');

-- 2. Funciones auxiliares para comprobar permisos granulares
CREATE OR REPLACE FUNCTION auth_user_can(permission_type TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
  has_permission BOOLEAN;
BEGIN
  -- Obtener rol y permisos del usuario actual
  SELECT 
    role,
    CASE 
      WHEN permission_type = 'view' THEN can_view
      WHEN permission_type = 'create' THEN can_create
      WHEN permission_type = 'edit' THEN can_edit
      WHEN permission_type = 'delete' THEN can_delete
      ELSE false
    END
  INTO user_role, has_permission
  FROM public.profiles 
  WHERE id = auth.uid() LIMIT 1;

  -- Superadmins y Company Admins siempre pueden hacer todo (override de seguridad extra)
  IF user_role IN ('superadmin', 'company_admin') THEN
    RETURN true;
  END IF;

  RETURN COALESCE(has_permission, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- 3. Actualizar Políticas RLS de TRANSACTIONS
-- Primero borramos las de la iteración anterior para no duplicar
DROP POLICY IF EXISTS "Usuarios pueden ver/editar transacciones de su empresa" ON transactions;
DROP POLICY IF EXISTS "Usuarios pueden ver transacciones de su empresa" ON transactions;
DROP POLICY IF EXISTS "Usuarios pueden crear transacciones en su empresa" ON transactions;
DROP POLICY IF EXISTS "Usuarios pueden editar transacciones de su empresa" ON transactions;
DROP POLICY IF EXISTS "Usuarios pueden borrar transacciones de su empresa" ON transactions;

-- A. Ver (SELECT)
CREATE POLICY "Usuarios pueden ver transacciones de su empresa" ON transactions
  FOR SELECT TO authenticated 
  USING (company_id = auth_user_company_id() AND auth_user_can('view'));

-- B. Crear (INSERT)
CREATE POLICY "Usuarios pueden crear transacciones en su empresa" ON transactions
  FOR INSERT TO authenticated 
  WITH CHECK (company_id = auth_user_company_id() AND auth_user_can('create'));

-- C. Editar (UPDATE)
CREATE POLICY "Usuarios pueden editar transacciones de su empresa" ON transactions
  FOR UPDATE TO authenticated 
  USING (company_id = auth_user_company_id() AND auth_user_can('edit'))
  WITH CHECK (company_id = auth_user_company_id() AND auth_user_can('edit'));

-- D. Borrar (DELETE)
CREATE POLICY "Usuarios pueden borrar transacciones de su empresa" ON transactions
  FOR DELETE TO authenticated 
  USING (company_id = auth_user_company_id() AND auth_user_can('delete'));


-- 4. Actualizar Políticas RLS de CATEGORIES
DROP POLICY IF EXISTS "Usuarios pueden ver/editar categorias de su empresa" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden ver categorias de su empresa" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden crear categorias en su empresa" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden editar categorias de su empresa" ON categories;
DROP POLICY IF EXISTS "Usuarios pueden borrar categorias de su empresa" ON categories;

CREATE POLICY "Usuarios pueden ver categorias de su empresa" ON categories
  FOR SELECT TO authenticated 
  USING (company_id = auth_user_company_id() AND auth_user_can('view'));

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


-- 5. Función para que el Superadmin cree un Company Admin y su Empresa
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

    -- Insertar silenciosamente en auth.users
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

    -- Asegurar que el perfil se crea/asigna de manera explícita (Ignorando fallos del trigger si los hay)
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

    RETURN json_build_object('success', true, 'company_id', new_company_id, 'user_id', new_user_id, 'email', admin_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Función para invitar/crear un usuario por parte de un Company Admin (con permisos)
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
BEGIN
    -- Obtener rol y empresa de quien llama a la función
    SELECT role, company_id INTO caller_role, caller_company_id FROM public.profiles WHERE id = auth.uid();

    -- Verificar permisos (Solo admins de la empresa o superadmins)
    IF caller_role != 'company_admin' AND caller_role != 'superadmin' THEN
        RAISE EXCEPTION 'No tienes permisos para crear usuarios en esta empresa';
    END IF;

    -- Generar UUID y hash de contraseña
    new_user_id := gen_random_uuid();
    encrypted_pw := crypt(user_password, gen_salt('bf'));

    -- Insertar en auth.users (Supabase Auth)
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

    -- Asegurar que el perfil se crea/asigna explícitamente y con los permisos solicitados
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

    RETURN json_build_object('success', true, 'user_id', new_user_id, 'email', user_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 7. Actualizar trigger para que por defecto si un usuario se registra de alguna otra forma (que no deberia pasar)
-- al menos los permisos de la BD esten alineados a FALSE excepto ver.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, can_view, can_create, can_edit, can_delete)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', 'company_user', true, false, false, false);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
