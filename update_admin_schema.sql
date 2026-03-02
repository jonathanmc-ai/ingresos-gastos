-- update_admin_schema.sql

-- 1. Función para obtener la lista de empresas con su admin actual (Opcional, pero muy útil para el panel)
CREATE OR REPLACE FUNCTION get_companies_with_admins()
RETURNS TABLE (
    company_id UUID,
    company_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    admin_email TEXT
) AS $$
BEGIN
    IF NOT auth_user_is_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    RETURN QUERY
    SELECT 
        c.id as company_id,
        c.name as company_name,
        c.created_at,
        u.email::TEXT as admin_email
    FROM public.companies c
    LEFT JOIN public.profiles p ON p.company_id = c.id AND p.role = 'company_admin'
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY c.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Función para actualizar una empresa y las credenciales de su administrador
CREATE OR REPLACE FUNCTION update_company_admin(
    p_company_id UUID,
    p_company_name TEXT,
    p_admin_email TEXT,
    p_admin_password TEXT
) RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_encrypted_pw TEXT;
BEGIN
    -- Verificar que quien llama a esto es Superadmin
    IF NOT auth_user_is_superadmin() THEN
        RAISE EXCEPTION 'Solo los superadmins pueden editar empresas';
    END IF;

    -- Actualizar el nombre de la empresa
    IF p_company_name IS NOT NULL AND p_company_name != '' THEN
        UPDATE public.companies SET name = p_company_name WHERE id = p_company_id;
    END IF;

    -- Obtener el ID del administrador de esta empresa
    SELECT id INTO v_admin_id FROM public.profiles WHERE company_id = p_company_id AND role = 'company_admin' LIMIT 1;

    IF v_admin_id IS NOT NULL THEN
        -- Si enviaron nuevo password, encriptarlo y actualizar
        IF p_admin_password IS NOT NULL AND p_admin_password != '' THEN
            v_encrypted_pw := crypt(p_admin_password, gen_salt('bf'));
            UPDATE auth.users SET encrypted_password = v_encrypted_pw, updated_at = now() WHERE id = v_admin_id;
        END IF;

        -- Si enviaron nuevo email
        IF p_admin_email IS NOT NULL AND p_admin_email != '' THEN
            UPDATE auth.users SET email = p_admin_email, updated_at = now() WHERE id = v_admin_id;
            
            -- Actualizar auth.identities también por consistencia
            UPDATE auth.identities 
            SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(p_admin_email)) 
            WHERE user_id = v_admin_id AND provider = 'email';
        END IF;
    END IF;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
