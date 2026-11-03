'use client';

// MARGEN DEL COSTEO INICIAL vs MARGEN CON LAS COTIZACIONES (27-oct-2026, pedido de Carolina, que supervisa Compras).
// Reemplaza al «Resumen contra lo costeado», que solo comparaba costos. Todo sale de compras-margen-vs-costeo.ts (puro, con tests):
// misma venta neta en los dos lados; el costo inicial es lo costeado y el costo con cotizaciones es la mejor cotización de cada línea
// (las líneas sin cotizar siguen al costo costeado). Cada cifra dice qué es y cómo se calcula: es un documento de supervisión.
// Ajuste del dueño (mismo día): letra más grande, lo relevante en negrita y color, y el detalle por línea cerrado por defecto
// y mejor detallado (verde = mejora el margen, rojo = lo baja, gris = sin cotizar).
import { GASTO_ENTREGA_PCT, type BloqueMargen, type ResumenMargen } from '@/app/lib/compras-margen-vs-costeo';

const clp = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('es-CL')}`;
/** Cambios en palabras (sin signos + ni −, que se confunden): «sube $X», «baja $X» o «sin cambio». */
const clpFirmado = (n: number) => (Math.round(n) === 0 ? 'sin cambio' : `${n > 0 ? 'sube' : 'baja'} ${clp(n)}`);
const pct = (n: number | null) => n == null ? '—' : `${n.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const pts = (n: number | null) => n == null ? '—' : n === 0 ? 'sin cambio' : `${n > 0 ? 'sube' : 'baja'} ${Math.abs(n).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} puntos`;
/** Verde cuando el margen sube, rojo cuando baja, gris si no cambia. El color nunca es la única señal: siempre va con palabra o flecha. */
const tono = (n: number | null) => n == null || n === 0 ? 'text-slate-500' : n > 0 ? 'text-emerald-700' : 'text-red-600';
const flecha = (n: number | null) => n == null || n === 0 ? '' : n > 0 ? '▲ ' : '▼ ';

const TH = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap';
const THR = `${TH} text-right`;
const TD = 'px-3 py-2 text-[13px] tabular-nums text-right whitespace-nowrap';

function FilaResumen({ rotulo, nota, a, b, dif, difTono, fuerte, compras, comprasTono, flete, fleteTono }: { rotulo: string; nota?: string; a: string; b: string; dif: string; difTono?: string; fuerte?: boolean; compras?: string; comprasTono?: string; flete?: string; fleteTono?: string }) {
  const t = difTono ?? 'text-slate-500';
  return (
    <tr className={fuerte ? 'border-y border-zinc-200 bg-slate-50' : ''}>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className={fuerte ? 'text-base font-bold text-slate-900' : 'text-[13px] font-medium text-slate-800'}>{rotulo}</span>
        {nota && <span className="block text-xs text-slate-500">{nota}</span>}
      </th>
      <td className={`${TD} ${fuerte ? 'text-lg font-bold text-slate-900' : 'text-slate-700'}`}>{a}</td>
      {compras != null && <td className={`${TD} ${fuerte ? 'text-lg font-bold' : 'font-medium'} ${comprasTono ?? 'text-slate-700'}`}>{compras}</td>}
      <td className={`${TD} ${fuerte ? `text-lg font-bold ${t}` : 'text-slate-700'}`}>{b}</td>
      {flete != null && <td className={`${TD} ${fuerte ? 'text-lg font-bold' : 'font-medium'} ${fleteTono ?? 'text-slate-700'}`}>{flete}</td>}
      <td className={`${TD} ${fuerte ? 'text-lg font-bold' : 'font-semibold'} ${t}`}>{dif}</td>
    </tr>
  );
}

function FilaGrupo({ rotulo, b }: { rotulo: string; b: BloqueMargen }) {
  return (
    <tr>
      <th scope="row" className="px-3 py-2 text-left text-[13px] font-medium text-slate-800">{rotulo} <span className="font-normal text-slate-500">({b.n})</span></th>
      <td className={`${TD} text-slate-700`}>{clp(b.venta)}</td>
      <td className={`${TD} text-slate-700`}>{clp(b.costoInicial)}</td>
      <td className={`${TD} text-slate-700`}>{clp(b.costoNuevo)}</td>
      <td className={`${TD} text-slate-700`}>{pct(b.pctInicial)}</td>
      <td className={`${TD} font-bold ${tono(b.puntos)}`}>{pct(b.pctNuevo)}</td>
      <td className={`${TD} font-bold ${tono(b.puntos)}`}>{b.puntos === 0 ? 'sin cambio' : `${flecha(b.puntos)}${pts(b.puntos)}`}</td>
    </tr>
  );
}

export function MargenCosteoVsCotizaciones({ resumen: r, fletesCotizados = [] }: { resumen: ResumenMargen; fletesCotizados?: Array<{ proveedor: string; cotizacionId: number; monto: number; nombre?: string }> }) {
  const t = r.total;
  if (r.lineas.length === 0) {
    return (
      <section className="border-t border-zinc-200 px-4 py-3" data-testid="margen-costeo-vs-cotizaciones">
        <h3 className="text-base font-medium text-slate-800">Margen: costeo inicial vs cotizaciones</h3>
        <p className="mt-1 text-[13px] text-slate-500">No se puede calcular: ninguna línea tiene a la vez precio de venta y costo en el costeo{r.sinVenta + r.sinCosteo > 0 ? ` (${r.sinVenta} sin precio de venta, ${r.sinCosteo} sin costo costeado)` : ''}.</p>
      </section>
    );
  }
  const sube = (t.puntos ?? 0) > 0, baja = (t.puntos ?? 0) < 0;
  // Costeo de Compras (30-oct-2026): para que Compras vea su margen ANTES de seguir cotizando. Solo si anotó algún costo.
  const hayCompras = t.nCompras > 0;
  const cc = (v: string) => (hayCompras ? v : undefined);
  // Con fletes cargados: el flete real REEMPLAZA a la reserva del 5 %. El costo neto no cambia (el flete se muestra aparte, como la reserva).
  const hayFlete = fletesCotizados.length > 0;
  const fleteReal = fletesCotizados.reduce((a, f) => a + f.monto, 0);
  const margenAntesNuevo = t.margenNuevo + t.gastoEntrega;
  const margenConFlete = margenAntesNuevo - fleteReal;
  const costoNetoNuevo = t.costoNuevo - t.gastoEntrega;
  const pctConFlete = t.venta > 0 ? Math.round((margenConFlete / t.venta) * 1000) / 10 : null;
  const recargoConFlete = costoNetoNuevo > 0 ? Math.round((margenConFlete / costoNetoNuevo) * 1000) / 10 : null;
  const dMargenFlete = margenConFlete - t.margenInicial;
  const dPtsFlete = pctConFlete != null && t.pctInicial != null ? Math.round((pctConFlete - t.pctInicial) * 10) / 10 : null;
  const dFleteVsReserva = fleteReal - t.gastoEntrega;
  const ff = (v: string) => (hayFlete ? v : undefined);
  return (
    <section className="border-t border-zinc-200 px-4 py-4" data-testid="margen-costeo-vs-cotizaciones">
      <h3 className="text-base font-medium text-slate-800">Margen: costeo inicial vs cotizaciones</h3>
      <p className="mt-0.5 text-[13px] text-slate-500">
        Misma venta neta (sin IVA) en los dos lados. El costo con cotizaciones usa la mejor cotización neta de cada línea; las líneas sin cotizar siguen al costo costeado.
      </p>

      {/* La conclusión en una frase, para leerla sin recorrer las tablas */}
      {t.pctInicial != null && t.pctNuevo != null && (
        <p className="mt-3 text-base text-slate-800">
          Con las cotizaciones el margen sobre la venta {sube ? 'sube' : baja ? 'baja' : 'no cambia'}: de <b className="font-bold text-slate-900">{pct(t.pctInicial)}</b> a <b className={`font-bold ${tono(t.puntos)}`}>{pct(t.pctNuevo)}</b>
          {t.puntos !== 0 && <> (<b className={`font-bold ${tono(t.puntos)}`}>{pts(t.puntos)}</b>; en pesos <b className={`font-bold ${tono(t.puntos)}`}>{clpFirmado(t.margenNuevo - t.margenInicial)}</b>)</>}.
        </p>
      )}

      {hayFlete && pctConFlete != null && t.pctInicial != null && (
        <p className="mt-3 text-base text-slate-800" data-testid="margen-flete-frase">
          Con el <b className="font-bold text-slate-900">flete real ({clp(fleteReal)})</b> el margen sobre la venta queda en <b className={`font-bold ${tono(dPtsFlete)}`}>{pct(pctConFlete)}</b> ({clp(margenConFlete)} en pesos): frente al costeo inicial <b className={`font-bold ${tono(dPtsFlete)}`}>{pts(dPtsFlete)}</b>.
        </p>
      )}

      {hayCompras ? (
        <p className="mt-3 text-base text-slate-800" data-testid="margen-compras-frase">
          Con el <b className="font-bold text-slate-900">costo real de Compras</b> el margen sobre la venta {(t.puntosCompras ?? 0) > 0 ? 'sube' : (t.puntosCompras ?? 0) < 0 ? 'baja' : 'no cambia'}: de <b className="font-bold text-slate-900">{pct(t.pctInicial)}</b> a <b className={`font-bold ${tono(t.puntosCompras)}`}>{pct(t.pctCompras)}</b>
          {t.puntosCompras !== 0 && <> (<b className={`font-bold ${tono(t.puntosCompras)}`}>{pts(t.puntosCompras)}</b>; en pesos <b className={`font-bold ${tono(t.puntosCompras)}`}>{clpFirmado(t.margenCompras - t.margenInicial)}</b>)</>}.
          <span className="block text-[13px] text-slate-500">Compras anotó el costo real de {t.nCompras} de {r.lineas.length} líneas; las demás cuentan al costo inicial, así que este margen es una idea provisional. Al mandar la compra a aprobación estos montos se reemplazan por los precios cotizados.</span>
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-slate-500">Anota el «Costo unit. REAL» en el costeo y aquí verás el margen que tendrías con esos costos, antes de seguir cotizando.</p>
      )}

      {/* 1 · Margen inicial del costeo frente al margen con las cotizaciones */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[540px]">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className={`${TH} relative`}><span className="sr-only">Concepto</span></th>
              <th className={THR}>Costeo inicial</th>
              {hayCompras && <th className={THR}>Con costo real de Compras</th>}
              <th className={THR}>Con cotizaciones</th>
              {hayFlete && <th className={THR}>Con cotizaciones y flete real</th>}
              <th className={THR}>{hayFlete ? 'Diferencia frente al costeo inicial (con flete real)' : 'Diferencia'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            <FilaResumen rotulo="Venta neta" nota="precio de venta del costeo × cantidad" a={clp(t.venta)} b={clp(t.venta)} compras={cc(clp(t.venta))} flete={ff(clp(t.venta))} dif="sin cambio" />
            <FilaResumen rotulo="Costo neto" nota="lo costeado · con cotizaciones: mejor precio de cada línea" a={clp(t.costoInicial - t.gastoEntrega)} b={clp(t.costoNuevo - t.gastoEntrega)} compras={cc(clp(t.costoCompras - t.gastoEntrega))} comprasTono={tono(t.costoInicial - t.costoCompras)} flete={ff(clp(costoNetoNuevo))}
              dif={clpFirmado(t.costoNuevo - t.costoInicial)} difTono={tono(t.costoInicial - t.costoNuevo)} />
            <FilaResumen rotulo="Margen antes de la reserva" nota="venta neta menos costo neto" a={clp(t.margenInicial + t.gastoEntrega)} b={clp(t.margenNuevo + t.gastoEntrega)} compras={cc(clp(t.margenCompras + t.gastoEntrega))} flete={ff(clp(margenAntesNuevo))}
              dif={clpFirmado(t.margenNuevo - t.margenInicial)} difTono={tono(t.margenNuevo - t.margenInicial)} />
            <FilaResumen rotulo={hayFlete ? "Reserva para flete / flete real" : "Reserva para flete"} nota={hayFlete ? `las dos primeras columnas descuentan la reserva automática (${Math.round(GASTO_ENTREGA_PCT * 100)} % del margen costeado); la tercera descuenta el flete real cargado` : `automática: ${Math.round(GASTO_ENTREGA_PCT * 100)} % del margen costeado, se descuenta del margen por si hay que pagar un flete`} a={`se resta ${clp(t.gastoEntrega)}`} b={`se resta ${clp(t.gastoEntrega)}`} compras={cc(`se resta ${clp(t.gastoEntrega)}`)} flete={ff(`flete real ${clp(fleteReal)}`)} fleteTono="font-semibold text-slate-900"
              dif={hayFlete ? (dFleteVsReserva === 0 ? "gastas lo mismo que la reserva" : `gastas ${clp(dFleteVsReserva)} ${dFleteVsReserva > 0 ? "más" : "menos"} que la reserva`) : "mismo monto"} difTono={hayFlete && dFleteVsReserva !== 0 ? (dFleteVsReserva > 0 ? "text-red-600" : "text-emerald-700") : undefined} />
            <FilaResumen rotulo="Margen en pesos" nota="margen menos reserva para flete" a={clp(t.margenInicial)} b={clp(t.margenNuevo)} compras={cc(clp(t.margenCompras))} comprasTono={tono(t.margenCompras - t.margenInicial)} flete={ff(clp(margenConFlete))} fleteTono={tono(dMargenFlete)}
              dif={hayFlete ? clpFirmado(dMargenFlete) : clpFirmado(t.margenNuevo - t.margenInicial)} difTono={hayFlete ? tono(dMargenFlete) : tono(t.margenNuevo - t.margenInicial)} />
            <FilaResumen fuerte rotulo="Margen sobre la venta" nota="margen después de la reserva dividido por la venta neta" a={pct(t.pctInicial)} b={pct(t.pctNuevo)} compras={cc(pct(t.pctCompras))} comprasTono={tono(t.puntosCompras)} flete={ff(pct(pctConFlete))} fleteTono={tono(dPtsFlete)}
              dif={hayFlete ? `${flecha(dPtsFlete)}${pts(dPtsFlete)}` : `${flecha(t.puntos)}${pts(t.puntos)}`} difTono={hayFlete ? tono(dPtsFlete) : tono(t.puntos)} />
            <FilaResumen rotulo="Recargo sobre el costo" nota="margen en pesos dividido por el costo neto (el «margen» con que el costeo arma el precio)" a={pct(t.recargoInicial)} b={pct(t.recargoNuevo)} compras={cc(pct(t.costoCompras > 0 ? Math.round((t.margenCompras / t.costoCompras) * 1000) / 10 : null))} flete={ff(pct(recargoConFlete))}
              dif={hayFlete ? (t.recargoInicial != null && recargoConFlete != null ? pts(Math.round((recargoConFlete - t.recargoInicial) * 10) / 10) : '—') : t.recargoInicial != null && t.recargoNuevo != null ? pts(Math.round((t.recargoNuevo - t.recargoInicial) * 10) / 10) : '—'}
              difTono={tono(t.recargoInicial != null && (hayFlete ? recargoConFlete : t.recargoNuevo) != null ? (hayFlete ? recargoConFlete! : t.recargoNuevo!) - t.recargoInicial : null)} />
          </tbody>
        </table>
      </div>

      {/* 1b · Fletes: la reserva del 5 % es la estimación; el flete real cargado dice cuánto margen queda de verdad */}
      {fletesCotizados.length > 0 && (() => {
        const real = fletesCotizados.reduce((a, f) => a + f.monto, 0);
        const reserva = t.gastoEntrega;
        const margenReal = t.margenNuevo + reserva - real;
        const pctReal = t.venta > 0 ? Math.round((margenReal / t.venta) * 1000) / 10 : null;
        const difFlete = real - reserva;
        const difMargen = margenReal - t.margenNuevo;
        const difPts = pctReal != null && t.pctNuevo != null ? Math.round((pctReal - t.pctNuevo) * 10) / 10 : null;
        const mal = difFlete > 0;
        return (
          <div className="mt-5" data-testid="margen-fletes-detalle">
            <h4 className="text-[13px] font-bold text-slate-900">Fletes: lo estimado contra lo real</h4>
            <p className="mt-0.5 text-xs text-slate-500">Se parte del margen con cotizaciones antes de la reserva. En vez de la reserva del {Math.round(GASTO_ENTREGA_PCT * 100)} % se resta el flete real cargado (neto, sin IVA).</p>
            <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 text-[13px]">
              {fletesCotizados.map((f, i) => (
                <li key={`${f.cotizacionId}-${i}`} className="flex items-baseline gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-slate-800" title={f.nombre}>{f.nombre || 'Flete'}{f.proveedor ? <span className="text-slate-500"> · {f.proveedor}</span> : null}</span>
                  <span className="font-bold tabular-nums text-slate-900">{clp(f.monto)}</span>
                </li>
              ))}
              {fletesCotizados.length > 1 && (
                <li className="flex items-baseline gap-3 bg-slate-50 px-3 py-2"><span className="flex-1 font-bold text-slate-900">Total flete real</span><span className="font-bold tabular-nums text-slate-900">{clp(real)}</span></li>
              )}
            </ul>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[540px]">
                <thead>
                  <tr className="border-b border-zinc-200">
                    <th className={TH}><span className="sr-only">Concepto</span></th>
                    <th className={THR}>Con la reserva ({Math.round(GASTO_ENTREGA_PCT * 100)} %)</th>
                    <th className={THR}>Con el flete real</th>
                    <th className={THR}>Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  <FilaResumen rotulo="Margen antes del flete" nota="margen con cotizaciones, antes de la reserva" a={clp(t.margenNuevo + reserva)} b={clp(t.margenNuevo + reserva)} dif="sin cambio" />
                  <FilaResumen rotulo="Flete que se resta" nota="reserva automática frente al flete real cargado" a={clp(reserva)} b={clp(real)} dif={difFlete === 0 ? 'gastas lo mismo' : `gastas ${clp(difFlete)} ${mal ? 'más' : 'menos'}`} difTono={difFlete === 0 ? undefined : mal ? 'text-red-600' : 'text-emerald-700'} />
                  <FilaResumen rotulo="Margen en pesos" nota="margen antes del flete menos el flete" a={clp(t.margenNuevo)} b={clp(margenReal)} dif={clpFirmado(difMargen)} difTono={tono(difMargen)} />
                  <FilaResumen fuerte rotulo="Margen sobre la venta" nota="margen en pesos dividido por la venta neta" a={pct(t.pctNuevo)} b={pct(pctReal)} dif={`${flecha(difPts)}${pts(difPts)}`} difTono={tono(difPts)} />
                </tbody>
              </table>
            </div>
            <p className={`mt-2 text-[13px] font-bold ${difFlete === 0 ? 'text-slate-600' : mal ? 'text-red-600' : 'text-emerald-700'}`}>
              {difFlete === 0 ? 'El flete real es igual a la reserva: el margen no cambia.'
                : mal ? `El flete real es ${clp(difFlete)} más caro que la reserva: el margen final es ${clp(Math.abs(difMargen))} menor.`
                : `El flete real es ${clp(difFlete)} más barato que la reserva: el margen final es ${clp(Math.abs(difMargen))} mayor.`}
            </p>
          </div>
        );
      })()}

      {/* 2 · Qué parte ya tiene cotización: el margen con cotizaciones es provisional mientras queden líneas sin cotizar */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[660px]">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className={TH}>Dónde cambia</th>
              <th className={THR}>Venta neta</th>
              <th className={THR}>Costo inicial</th>
              <th className={THR}>Costo con cotizaciones</th>
              <th className={THR}>Margen inicial</th>
              <th className={THR}>Margen con cotizaciones</th>
              <th className={THR}>Variación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            <FilaGrupo rotulo="Líneas cotizadas" b={r.cotizadas} />
            <FilaGrupo rotulo="Líneas sin cotizar" b={r.sinCotizar} />
          </tbody>
        </table>
      </div>

      <ul className="mt-3 space-y-1.5 text-[13px] text-slate-700">
        {r.sinCotizar.n > 0 && (
          <li>{r.cotizadas.n} de {r.lineas.length} líneas ya tienen cotización. El margen con cotizaciones es <b className="font-bold text-amber-700">provisional</b>: las {r.sinCotizar.n} sin cotizar se mantienen al costo costeado y pueden mover el margen cuando se coticen.</li>
        )}
        {r.conMenosMargen > 0 && (
          <li className="font-medium text-red-600">▼ {r.conMenosMargen} línea{r.conMenosMargen === 1 ? '' : 's'} con la mejor cotización más cara que lo costeado: bajan el margen (en rojo en el detalle).</li>
        )}
        {(r.sinVenta > 0 || r.sinCosteo > 0) && (
          <li className="text-slate-600">Fuera del cálculo: {[r.sinVenta > 0 ? `${r.sinVenta} línea${r.sinVenta === 1 ? '' : 's'} sin precio de venta en el costeo` : '', r.sinCosteo > 0 ? `${r.sinCosteo} sin costo costeado` : ''].filter(Boolean).join(' · ')}.</li>
        )}
      </ul>

      {/* 3 · Detalle línea por línea: cerrado por defecto (el resumen ya dice lo importante), para revisar cada cifra cuando haga falta */}
      <details className="mt-4 group">
        <summary className="cursor-pointer select-none text-[13px] font-medium text-teal-700 hover:underline">
          <span className="group-open:hidden">Ver detalle por línea ({r.lineas.length})</span>
          <span className="hidden group-open:inline">Ocultar detalle por línea ({r.lineas.length})</span>
        </summary>
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <span><b className="font-bold text-emerald-700">▲ Verde</b>: la cotización mejora el margen</span>
          <span><b className="font-bold text-red-600">▼ Rojo</b>: lo baja (cotización más cara que lo costeado)</span>
          <span><b className="font-bold text-slate-500">Gris</b>: sin cotizar, sigue al costo costeado</span>
        </p>
        <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full min-w-[1040px]">
            <thead>
              <tr className="border-b border-zinc-200 bg-slate-50">
                <th className={TH}>Producto</th>
                <th className={THR}>Cant.</th>
                <th className={THR}>Venta neta</th>
                <th className={THR}>Costo costeado</th>
                <th className={THR}>Margen inicial</th>
                <th className={THR}>Mejor cotización (neto por unidad)</th>
                <th className={THR}>Costo con cotización</th>
                <th className={THR}>Margen con cotización</th>
                <th className={THR}>Cambio del margen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {r.lineas.map(l => {
                const peor = l.cotizada && l.margenNuevo < l.margenInicial, mejor = l.cotizada && l.margenNuevo > l.margenInicial;
                const t2 = tono(l.margenNuevo - l.margenInicial);
                return (
                  <tr key={l.id} className={peor ? 'bg-red-50/70' : l.cotizada ? '' : 'text-slate-500'}>
                    <th scope="row" className={`px-3 py-2 text-left text-[13px] max-w-[300px] ${l.cotizada ? 'font-medium text-slate-800' : 'font-normal text-slate-500'}`}>
                      <span className="block truncate" title={l.descripcion}>{l.descripcion}</span>
                    </th>
                    <td className={`${TD} ${l.cotizada ? 'text-slate-700' : 'text-slate-500'}`}>{l.cantidad.toLocaleString('es-CL')}</td>
                    <td className={`${TD} ${l.cotizada ? 'text-slate-700' : 'text-slate-500'}`}>{clp(l.venta)}</td>
                    <td className={`${TD} ${l.cotizada ? 'text-slate-700' : 'text-slate-500'}`}>{clp(l.costoInicial)}</td>
                    <td className={`${TD} ${l.cotizada ? 'text-slate-700' : 'text-slate-500'}`}>{clp(l.margenInicial)}<span className="block text-xs">{pct(l.pctInicial)}</span></td>
                    {l.cotizada ? (
                      <>
                        <td className={`${TD} font-medium text-slate-900`}>{clp(l.cotizadoUnitario as number)}
                          {l.proveedor && <span className="block text-xs font-normal text-slate-500 truncate max-w-[200px] ml-auto" title={l.proveedor}>{l.proveedor}</span>}
                        </td>
                        <td className={`${TD} text-slate-700`}>{clp(l.costoNuevo)}
                          <span className={`block text-xs font-medium ${tono(l.costoInicial - l.costoNuevo)}`}>{clpFirmado(l.costoNuevo - l.costoInicial)}</span>
                        </td>
                        <td className={`${TD} font-bold ${mejor ? 'bg-emerald-50' : ''} ${t2}`}>{clp(l.margenNuevo)}<span className="block text-xs font-bold">{pct(l.pctNuevo)}</span></td>
                        <td className={`${TD} font-bold ${mejor ? 'bg-emerald-50' : ''} ${t2}`}>{flecha(l.puntos)}{pts(l.puntos)}
                          <span className="block text-xs font-bold">{clpFirmado(l.margenNuevo - l.margenInicial)}</span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="px-3 py-2 text-right text-[13px] text-slate-500">Sin cotizar: sigue al costo costeado, el margen no cambia</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-300 bg-slate-50">
                <th scope="row" className="px-3 py-2 text-left text-sm font-bold text-slate-900">Total ({r.lineas.length} líneas)</th>
                <td />
                <td className={`${TD} text-sm font-bold text-slate-900`}>{clp(t.venta)}</td>
                <td className={`${TD} text-sm font-bold text-slate-900`}>{clp(t.costoInicial)}</td>
                <td className={`${TD} text-sm font-bold text-slate-900`}>{clp(t.margenInicial)}<span className="block text-xs font-bold">{pct(t.pctInicial)}</span></td>
                <td />
                <td className={`${TD} text-sm font-bold text-slate-900`}>{clp(t.costoNuevo)}
                  <span className={`block text-xs font-bold ${tono(t.costoInicial - t.costoNuevo)}`}>{clpFirmado(t.costoNuevo - t.costoInicial)}</span>
                </td>
                <td className={`${TD} text-sm font-bold ${tono(t.puntos)}`}>{clp(t.margenNuevo)}<span className="block text-xs font-bold">{pct(t.pctNuevo)}</span></td>
                <td className={`${TD} text-sm font-bold ${tono(t.puntos)}`}>{flecha(t.puntos)}{pts(t.puntos)}
                  <span className="block text-xs font-bold">{clpFirmado(t.margenNuevo - t.margenInicial)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </section>
  );
}
