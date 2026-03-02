-- script_borrar_fantasmas.sql
-- Este script elimina a la fuerza cualquier usuario de Supabase Auth
-- saltándose la interfaz del Dashboard de Supabase (que a veces da error "Database error loading user"
-- por culpa de identidades internas rotas).

-- Simplemente pon el correo del usuario que está "atascado" y pulsa RUN.
DO $$
DECLARE
    v_email_a_borrar TEXT := 'jmcabeo@gmail.com'; -- CAMBIA ESTO POR EL CORREO PROBLEMÁTICO A BORRAR
    v_user_id UUID;
BEGIN
    -- Busca al usuario
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_email_a_borrar;

    IF v_user_id IS NOT NULL THEN
        -- 1. Borrar todas sus identidades (logins) en cascada
        DELETE FROM auth.identities WHERE user_id = v_user_id;

        -- 2. Borrar las sesiones 
        DELETE FROM auth.sessions WHERE user_id = v_user_id;

        -- 3. Borrar el perfil en public si quedara algún rastro
        DELETE FROM public.profiles WHERE id = v_user_id;

        -- 4. Aniquilar la cuenta de auth.users directamente en la base de datos (fuerza bruta)
        DELETE FROM auth.users WHERE id = v_user_id;
        
        RAISE NOTICE '¡Fantasma aniquilado con éxito!';
    ELSE
        RAISE NOTICE 'Ese correo no existe en la base de datos interna.';
    END IF;
END $$;
