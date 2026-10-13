'use client';

// LA PRIMERA COTIZACIÓN DE CADA PRODUCTO ES SU LINK. Reusa el Auditor del negocio (/api/negocios/:id/auditor): visita el link del costeo,
// lee el precio de la página (con el criterio de IVA del Lector: «+IVA» es neto; si no dice nada se asume con IVA y se rebaja) y deja
// el resultado como una opción de la línea. Aquí solo se muestra y se dispara «Leer link»; nada se calcula por separado.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import type { PanelAuditorDTO } from '@/app/lib/auditor-opciones';
import type { LinksCosteo } from './LinksProducto';

export interface LecturaLink {
  opcionId: number; url: string | null; host: string; proveedor: string | null;
  neto: number | null;            // precio neto por unidad que sacó el Auditor del link
  precioPagina: number | null;    // lo que dice la página tal cual
  ivaSupuesto: boolean;           // la página no decía el IVA: se asumió con IVA y se rebajó
  ivaDeclarado: string | null;
  capturaAt: string | null;
  estadoLink: string | null;
  agotado: boolean;               // la página dice «producto agotado» (o su ficha estructurada marca OutOfStock)
}

const host = (u: string | null) => { if (!u) return ''; try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export function useLinksLeidos(negocioId: number, linksCosteo: LinksCosteo, activo: boolean) {
  const toast = useToast();
  const [panel, setPanel] = useState<PanelAuditorDTO | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [leyendo, setLeyendo] = useState<{ actual: number; total: number } | null>(null);
  const [leyendoProducto, setLeyendoProducto] = useState<number | null>(null);
  const [releyendo, setReleyendo] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/negocios/${negocioId}/auditor`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) { setSinAcceso(true); return; }
      const d = await res.json();
      if (res.ok && d.success) setPanel(d as PanelAuditorDTO);
    } catch { /* sin lectura de links: la tabla sigue funcionando con las cotizaciones */ }
  }, [negocioId]);
  useEffect(() => { if (activo) cargar(); }, [cargar, activo]);

  const lecturas = useMemo(() => {
    const out: Record<number, LecturaLink[]> = {};
    if (!panel) return out;
    for (const [pid, info] of Object.entries(linksCosteo)) {
      const linea = info.filaId ? panel.lineas.find(l => l.filaId === info.filaId) : null;
      if (!linea) continue;
      const lista: LecturaLink[] = [];
      for (const o of linea.opciones) {
        if (o.estado === 'descartada') continue;
        const r = o.respaldos.find(x => x.tipo === 'link_web' && x.vigente) ?? o.respaldos.find(x => x.tipo === 'link_web');
        if (!r) continue;
        lista.push({
          opcionId: o.id, url: r.url, host: host(r.url), proveedor: o.proveedorRazonSocial,
          neto: o.verificacion?.costoNetoUnitario ?? null, precioPagina: o.producto?.precio ?? null,
          ivaSupuesto: !!o.producto?.ivaSupuesto, ivaDeclarado: o.producto?.iva ?? null,
          capturaAt: o.capturas[0]?.capturadoAt ?? null, estadoLink: o.estadoLink,
          agotado: !!o.capturas[0]?.agotado,
        });
      }
      if (lista.length) out[Number(pid)] = lista;
    }
    return out;
  }, [panel, linksCosteo]);

  // Links del costeo que todavía no se han leído, por producto.
  const pendientesDe = useCallback((productoId: number) => {
    const fila = linksCosteo[productoId]?.filaId;
    return fila ? (panel?.linksPendientes || []).filter(x => x.filaId === fila) : [];
  }, [panel, linksCosteo]);
  const totalPendientes = useMemo(() => Object.keys(linksCosteo).reduce((n, pid) => n + pendientesDe(Number(pid)).length, 0), [linksCosteo, pendientesDe]);

  /** Lee los links pendientes de un producto, o de todos si no se indica. De a uno: cada link se visita, se captura y se lee. */
  const leer = async (productoId?: number) => {
    const lista = productoId != null ? pendientesDe(productoId) : Object.keys(linksCosteo).flatMap(pid => pendientesDe(Number(pid)));
    if (lista.length === 0 || leyendo) return;
    if (productoId != null) setLeyendoProducto(productoId);
    let fallos = 0;
    for (let i = 0; i < lista.length; i++) {
      setLeyendo({ actual: i + 1, total: lista.length });
      try {
        const res = await fetch(`/api/negocios/${negocioId}/auditor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'agregar_link', filaId: lista[i].filaId, url: lista[i].url }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.success === false) throw new Error(d.error || 'No se pudo leer');
        if (d.error) { fallos++; toast.error(`No se pudo leer el precio de ${host(lista[i].url)}`, d.error); }
      } catch (e: any) { fallos++; toast.error(`No se pudo leer ${host(lista[i].url)}`, e.message); }
    }
    setLeyendo(null); setLeyendoProducto(null);
    await cargar();
    if (fallos < lista.length) toast.success('Links leídos', `${lista.length - fallos} de ${lista.length} con precio.`);
  };

  /** Vuelve a visitar un link ya leído: el precio de una captura vieja no se usa para comprar. */
  const releer = async (opcionId: number) => {
    if (releyendo != null) return;
    setReleyendo(opcionId);
    try {
      const res = await fetch(`/api/negocios/${negocioId}/auditor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'revisitar_link', opcionId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.success === false) throw new Error(d.error || 'No se pudo volver a leer');
      const cambios: string[] = d.cambios || [];
      if (cambios.length) toast.success('Link leído de nuevo', cambios.join(' ')); else toast.success('Link leído de nuevo', 'El precio sigue igual.');
    } catch (e: any) { toast.error('No se pudo volver a leer el link', e.message); }
    finally { setReleyendo(null); await cargar(); }
  };

  return { lecturas, leer, releer, releyendo, leyendo, leyendoProducto, totalPendientes, pendientesDe, sinAcceso, disponible: !!panel && !sinAcceso, recargar: cargar };
}
