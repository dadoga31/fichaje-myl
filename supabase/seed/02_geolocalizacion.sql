-- =====================================================================
--  OPCIONAL — Activar el registro de ubicación al fichar
--
--  Solo si su empresa lo necesita y puede justificar su proporcionalidad
--  (art. 90 LOPDGDD). La base de datos IMPIDE activarlo sin publicar antes
--  el aviso informativo, y cada persona debe consentir además desde Ajustes.
-- =====================================================================

update public.companies
   set geolocation_policy = 'optional',   -- 'optional' | 'required'
       geolocation_notice =
         'Al fichar se registran las coordenadas del momento exacto del fichaje, '
         'con la finalidad de acreditar el lugar de prestación de servicios. No se '
         'realiza ningún seguimiento continuo de su ubicación. Puede retirar su '
         'consentimiento en cualquier momento desde Ajustes, sin que ello impida fichar.'
 where cif = 'B00000000';   -- ← el CIF de su empresa
