'use client';

// Aviso dentro de una pantalla cuando la sección pertenece a un módulo que la empresa no tiene contratado.
// La activación la hace el superusuario de LICITANK; aquí solo se explica y se invita a pedirla.
import { IconLock as Lock } from '@tabler/icons-react';
import { NOMBRE_MODULO, type Modulo } from '@/app/lib/modulos';

const BAJADA: Partial<Record<Modulo, string>> = {
  viabilidad: 'Analiza cada licitación con IA y te dice si conviene postular: semáforo, riesgos y criterios.',
  ia_chat: 'Consulta a la IA sobre los documentos de la licitación, sin leerlos uno por uno.',
  auditor: 'Revisa los requisitos técnicos y comerciales de tu oferta antes de postular.',
  costeo: 'Arma el costeo de tu oferta con precios de mercado y márgenes.',
  anexos: 'Genera y rellena los anexos de la postulación.',
  compras: 'Gestiona las compras, proveedores y pagos de los proyectos ganados.',
  entregas: 'Controla la entrega de los proyectos ganados.',
  competencia: 'Mira contra quién compitiste y qué ofertaron.',
};

export function ModuloBloqueadoPanel({ modulo }: { modulo: Modulo }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <Lock size={18} />
      </div>
      <p className="text-[14px] font-semibold text-zinc-800">{NOMBRE_MODULO[modulo]} no está incluido en tu plan</p>
      {BAJADA[modulo] && <p className="mt-1.5 text-[12.5px] text-zinc-500">{BAJADA[modulo]}</p>}
      <p className="mt-3 text-[12.5px] text-zinc-500">Escríbenos y lo activamos en tu cuenta.</p>
    </div>
  );
}
