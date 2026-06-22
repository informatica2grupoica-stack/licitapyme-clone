// app/licitacion/[codigo]/sections/ResumenSection.tsx
'use client';

import {
  FileText, Building2, Shield, Phone, Mail, CheckCircle,
  ExternalLink, Clock, LayoutDashboard, Wallet, Loader2,
  AlertTriangle, Lightbulb, ThumbsUp, ListChecks,
} from 'lucide-react';
import { Oportunidad } from '@/app/types/search.types';
import { MODALIDAD_PAGO_MAP } from '@/app/types/mercado-publico.types';
import { InfoCard, InfoRow, AlertBanner, SectionHeader, AnalisisIA, IABadge, formatCLP } from '../utils';
import { Resaltar } from '@/app/components/Resaltar';

export function ResumenSection({ licitacion, tipoLabel, diasRestantes, analisisIA, analizandoIA, keywords = [] }: {
  licitacion: Oportunidad;
  tipoLabel: string | null;
  diasRestantes: number | null;
  analisisIA?: AnalisisIA | null;
  analizandoIA?: boolean;
  keywords?: string[];
}) {
  const tieneMontoMP = !!(licitacion.monto_total || licitacion.monto_estimado);
  const presupuestoIA = !tieneMontoMP ? analisisIA?.presupuesto : null;
  const tienePlazoMP = !!licitacion.caracteristicas?.plazo_contrato_dias;
  const plazoIA = !tienePlazoMP ? analisisIA?.plazoEjecucionDias : null;
  const experto = analisisIA?.analisisExperto;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<LayoutDashboard size={18} />}
        title="Resumen"
        subtitle="Información general del proceso de compra"
      />

      {analizandoIA && (
        <AlertBanner tipo="info" titulo="Analizando bases con IA...">
          <span className="inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            Estamos revisando los documentos para completar datos que Mercado Público no informó (presupuesto, plazos, criterios, etc.)
          </span>
        </AlertBanner>
      )}

      {diasRestantes !== null && diasRestantes >= 0 && (
        diasRestantes === 0 ? (
          <AlertBanner tipo="danger" titulo="¡Cierra hoy!" pulse>
            Esta licitación cierra hoy. Revisa que tu propuesta esté lista antes del horario límite.
          </AlertBanner>
        ) : diasRestantes <= 2 ? (
          <AlertBanner tipo="danger" titulo="Cierre muy próximo">
            Quedan <strong>{diasRestantes} día{diasRestantes !== 1 ? 's' : ''}</strong> para el cierre de recepción de ofertas.
          </AlertBanner>
        ) : diasRestantes <= 7 ? (
          <AlertBanner tipo="warning" titulo="Cierre próximo">
            Quedan <strong>{diasRestantes} días</strong> para el cierre. Revisa la sección &quot;Fechas&quot; y prepara tus documentos.
          </AlertBanner>
        ) : (
          <AlertBanner tipo="info" titulo="Plazo vigente">
            Quedan <strong>{diasRestantes} días</strong> para el cierre de recepción de ofertas.
          </AlertBanner>
        )
      )}
      {diasRestantes !== null && diasRestantes < 0 && (
        <AlertBanner tipo="info" titulo="Proceso finalizado">
          <span className="inline-flex items-center gap-1"><Clock size={12} /> El plazo de recepción de ofertas ya concluyó.</span>
        </AlertBanner>
      )}

      {licitacion.descripcion && (
        <InfoCard title="Descripción / Objeto" icon={<FileText size={15} />}>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line"><Resaltar texto={licitacion.descripcion} keywords={keywords} /></p>
        </InfoCard>
      )}

      <InfoCard title="Organismo comprador" icon={<Building2 size={15} />}>
        <div className="divide-y divide-slate-50">
          <InfoRow label="Nombre organismo"   value={licitacion.organismo} />
          <InfoRow label="Unidad compradora"  value={licitacion.comprador} />
          <InfoRow label="RUT"                value={licitacion.rut_organismo} />
          <InfoRow label="Dirección"          value={licitacion.direccion} />
          <InfoRow label="Comuna"             value={licitacion.comuna_unidad} />
          <InfoRow label="Región"             value={licitacion.region} />
        </div>
      </InfoCard>

      {(tipoLabel || licitacion.tipo_convocatoria || licitacion.caracteristicas?.modalidad_pago
        || licitacion.caracteristicas?.plazo_contrato_dias) && (
        <InfoCard title="Características del proceso" icon={<Shield size={15} />}>
          <div className="divide-y divide-slate-50">
            <InfoRow label="Tipo de licitación"  value={tipoLabel} />
            <InfoRow label="Tipo convocatoria"   value={licitacion.tipo_convocatoria} />
            <InfoRow label="Moneda"              value={licitacion.moneda} />
            <InfoRow label="Modalidad de pago"
              value={licitacion.caracteristicas?.modalidad_pago
                ? MODALIDAD_PAGO_MAP[parseInt(licitacion.caracteristicas.modalidad_pago)] || licitacion.caracteristicas.modalidad_pago
                : null} />
            <InfoRow label="Duración contrato"
              value={licitacion.caracteristicas?.plazo_contrato_dias
                ? `${licitacion.caracteristicas.plazo_contrato_dias} días` : null} />
            <InfoRow label="Subcontratación"
              value={licitacion.caracteristicas?.subcontratacion === true ? 'Permitida'
                : licitacion.caracteristicas?.subcontratacion === false ? 'No permitida' : null} />
            <InfoRow label="Renovable"
              value={licitacion.caracteristicas?.renovable === true ? 'Sí'
                : licitacion.caracteristicas?.renovable === false ? 'No' : null} />
          </div>
        </InfoCard>
      )}

      {(licitacion.contacto?.nombre || licitacion.contacto?.email || licitacion.contacto?.telefono) && (
        <InfoCard title="Responsable del contrato" icon={<Phone size={15} />}>
          <div className="divide-y divide-slate-50">
            <InfoRow label="Nombre"  value={licitacion.contacto?.nombre} />
            <InfoRow label="Cargo"   value={licitacion.contacto?.cargo} />
            {licitacion.contacto?.email && (
              <div className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <span className="text-[11.5px] text-slate-400 w-40 flex-shrink-0 pt-0.5 font-medium">Email</span>
                <a href={`mailto:${licitacion.contacto.email}`}
                  className="text-[13px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1">
                  <Mail size={12} /> {licitacion.contacto.email}
                </a>
              </div>
            )}
            {licitacion.contacto?.telefono && (
              <div className="flex gap-3 py-2.5">
                <span className="text-[11.5px] text-slate-400 w-40 flex-shrink-0 pt-0.5 font-medium">Teléfono</span>
                <a href={`tel:${licitacion.contacto.telefono}`}
                  className="text-[13px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1">
                  <Phone size={12} /> {licitacion.contacto.telefono}
                </a>
              </div>
            )}
          </div>
        </InfoCard>
      )}

      {(presupuestoIA?.monto || plazoIA) && (
        <InfoCard title="Presupuesto y plazos (extraído por IA)" icon={<Wallet size={15} />}>
          <div className="flex items-center gap-2 mb-3">
            <IABadge />
            <span className="text-xs text-slate-400">Mercado Público no informó este dato; se extrajo de las bases con IA.</span>
          </div>
          <div className="divide-y divide-slate-50">
            {presupuestoIA?.monto && (
              <InfoRow label="Presupuesto estimado" value={formatCLP(presupuestoIA.monto) || `${presupuestoIA.monto} ${presupuestoIA.moneda || ''}`} />
            )}
            {plazoIA && (
              <InfoRow label="Plazo de ejecución" value={`${plazoIA} días`} />
            )}
          </div>
        </InfoCard>
      )}

      {experto && (experto.puntosCriticos?.length || experto.oportunidades?.length || experto.riesgosDetectados?.length || experto.recomendaciones?.length) && (
        <InfoCard title="Análisis experto para el proveedor" icon={<Lightbulb size={15} />}>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <IABadge />
            {experto.complejidad && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full font-medium">
                Complejidad: {experto.complejidad}
              </span>
            )}
            {experto.atractivo && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full font-medium">
                Atractivo: {experto.atractivo}
              </span>
            )}
          </div>
          <div className="space-y-4">
            {!!experto.puntosCriticos?.length && (
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
                  <AlertTriangle size={12} className="text-amber-500" /> Puntos críticos
                </p>
                <ul className="space-y-1.5">
                  {experto.puntosCriticos.map((p, i) => (
                    <li key={i} className="text-[13px] text-slate-700 pl-4 relative before:content-[&#39;•&#39;] before:absolute before:left-0 before:text-amber-400">{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!experto.riesgosDetectados?.length && (
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
                  <AlertTriangle size={12} className="text-red-500" /> Riesgos detectados
                </p>
                <ul className="space-y-1.5">
                  {experto.riesgosDetectados.map((p, i) => (
                    <li key={i} className="text-[13px] text-slate-700 pl-4 relative before:content-[&#39;•&#39;] before:absolute before:left-0 before:text-red-400">{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!experto.oportunidades?.length && (
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
                  <ThumbsUp size={12} className="text-emerald-500" /> Oportunidades
                </p>
                <ul className="space-y-1.5">
                  {experto.oportunidades.map((p, i) => (
                    <li key={i} className="text-[13px] text-slate-700 pl-4 relative before:content-[&#39;•&#39;] before:absolute before:left-0 before:text-emerald-400">{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!experto.recomendaciones?.length && (
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
                  <ListChecks size={12} className="text-indigo-500" /> Recomendaciones
                </p>
                <ul className="space-y-1.5">
                  {experto.recomendaciones.map((p, i) => (
                    <li key={i} className="text-[13px] text-slate-700 pl-4 relative before:content-[&#39;•&#39;] before:absolute before:left-0 before:text-indigo-400">{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </InfoCard>
      )}

      {(licitacion.url_acta || licitacion.numero_oferentes) && (
        <InfoCard title="Adjudicación" icon={<CheckCircle size={15} />}>
          <div className="space-y-2">
            {licitacion.numero_oferentes !== undefined && licitacion.numero_oferentes > 0 && (
              <p className="text-sm text-slate-700">
                <strong className="text-slate-900">{licitacion.numero_oferentes}</strong> proveedor{licitacion.numero_oferentes !== 1 ? 'es' : ''} participaron
              </p>
            )}
            {licitacion.url_acta && (
              <a href={licitacion.url_acta} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:underline">
                <ExternalLink size={13} /> Ver acta de adjudicación
              </a>
            )}
          </div>
        </InfoCard>
      )}
    </div>
  );
}
