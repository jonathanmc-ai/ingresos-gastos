-- fix_superadmin_delete.sql
-- Solución al borrado accidental del perfil Superadmin cuando se elimina una empresa

-- 1. Evitar que borrar una empresa borre a sus usuarios
-- Cambiamos ON DELETE CASCADE por ON DELETE SET NULL en la columna company_id de la tabla profiles.
-- IMPORTANTE: Para hacer esto, primero debemos saber cómo se llama la restricción (constraint) actual.
DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT constraint_name INTO fk_name
    FROM information_schema.key_column_usage
    WHERE table_name = 'profiles' AND column_name = 'company_id' AND position_in_unique_constraint = 1;

    IF fk_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT ' || fk_name;
        EXECUTE 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL';
    END IF;
END $$;

-- 2. Recuperar al Superadmin
-- Como el sistema de Login (GoTrue) de Supabase sigue teniendo al Superadmin
-- registrado en auth.users (porque la eliminación solo borró datos de la tabla profiles public),
-- su cuenta "existe" pero le falta el "perfil" público con rol superadmin.
-- Vamos a coger TODOS los usuarios que estén en auth.users y que NO TENGAN perfil,
-- y vamos a asignarle un perfil. Al usuario más antiguo (el primero que se registró, que serás tú),
-- le devolveremos su corona de superadmin.

DO $$
DECLARE
    v_first_user_id UUID;
BEGIN
    -- Obtenemos el ID del primer usuario creado en la historia de tu base de datos (seguramente el tuyo)
    SELECT id INTO v_first_user_id FROM auth.users ORDER BY created_at ASC LIMIT 1;

    IF v_first_user_id IS NOT NULL THEN
        -- Insertar o actualizar el perfil de ese usuario como superadmin absoluto, sin empresa (company_id = NULL)
        INSERT INTO public.profiles (id, company_id, role, full_name, can_view, can_create, can_edit, can_delete)
        VALUES (v_first_user_id, NULL, 'superadmin', 'Master Admin', true, true, true, true)
        ON CONFLICT (id) DO UPDATE 
        SET 
          company_id = NULL,
          role = 'superadmin',
          full_name = 'Master Admin',
          can_view = true,
          can_create = true,
          can_edit = true,
          can_delete = true;
    END IF;
    
    -- Si tuvieras más usuarios "huérfanos" sin perfil, les creamos perfiles básicos por si acaso
    INSERT INTO public.profiles (id, role, full_name, can_view)
    SELECT id, 'company_user', raw_user_meta_data->>'full_name', true 
    FROM auth.users
    WHERE id != v_first_user_id AND id NOT IN (SELECT id FROM public.profiles)
    ON CONFLICT (id) DO NOTHING;
END $$;
