'use client';

// Etapas propias de la empresa del usuario (migration-199): se piden una vez, se registran en pipeline.ts y los componentes que
// muestran etapas se vuelven a pintar al llegar. `recargarEtapasPropias()` la usa Mi empresa después de crear o editar.
import { useEffect, useState } from 'react';
import type { EtapaPropia } from '@/app/lib/etapas-core';
import { registrarEtapasPropias } from '@/app/lib/pipeline';

let cache: EtapaPropia[] | null = null;
let pendiente: Promise<EtapaPropia[]> | null = null;
const oyentes = new Set<(l: EtapaPropia[]) => void>();

function cargar(forzar = false): Promise<EtapaPropia[]> {
  if (cache && !forzar) return Promise.resolve(cache);
  if (pendiente && !forzar) return pendiente;
  pendiente = fetch('/api/mi-empresa/etapas')
    .then(r => r.json())
    .then(d => (Array.isArray(d?.etapas) ? d.etapas as EtapaPropia[] : []))
    .catch(() => [] as EtapaPropia[])
    .then(l => { cache = l; registrarEtapasPropias(l); pendiente = null; oyentes.forEach(f => f(l)); return l; });
  return pendiente;
}

export function recargarEtapasPropias() { return cargar(true); }

export function useEtapasPropias(): EtapaPropia[] {
  const [lista, setLista] = useState<EtapaPropia[]>(cache ?? []);
  useEffect(() => {
    oyentes.add(setLista);
    cargar().then(setLista);
    return () => { oyentes.delete(setLista); };
  }, []);
  return lista;
}
