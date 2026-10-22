-- Rendimiento real de cada estrategia: cuántas candidatas quedaron verificadas en el tema (requisitos duros), no solo filtros macro.
ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS verified integer NOT NULL DEFAULT 0;
