-- La bandera "cuenta de negocio" de Instagram apagada no prueba que sea creadora: esos claims (0,97) tapaban
-- la lectura de la bio y dejaban pasar negocios. Se eliminan; las facetas se recalculan en la siguiente corrida.
DELETE FROM claims WHERE predicate_key = 'account.kind' AND extractor->>'provider' = 'platform_flag' AND value = '"creator"'::jsonb;
