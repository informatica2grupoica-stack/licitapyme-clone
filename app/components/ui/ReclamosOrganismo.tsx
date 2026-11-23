// Reclamos que Mercado Público registra contra el organismo comprador en los últimos 12 meses.
// Va bajo el título de la licitación y del negocio. El dato viene de la API (`CantidadReclamos`).
// «Sin dato» NO es «sin reclamos»: si MP no lo trae, se dice.
import { Estado } from '@/app/components/ui/kit/Tarjeta';

const COLOR = { ok: '#16a34a', aviso: '#d97706', urgente: '#dc2626', sinDato: '#94a3b8' };

export function ReclamosOrganismo({ cantidad }: { cantidad?: number | null }) {
  const hay = typeof cantidad === 'number' && Number.isFinite(cantidad) && cantidad >= 0;
  const n = hay ? (cantidad as number) : 0;
  const color = !hay ? COLOR.sinDato : n === 0 ? COLOR.ok : n < 5 ? COLOR.aviso : COLOR.urgente;
  const texto = !hay ? 'Reclamos: sin dato'
    : n === 0 ? 'Sin reclamos en 12 meses'
    : `${n} ${n === 1 ? 'reclamo' : 'reclamos'} en 12 meses`;
  const ayuda = !hay
    ? 'Mercado Público no informó los reclamos de este organismo.'
    : 'Reclamos de proveedores contra este organismo en los últimos 12 meses, según Mercado Público.';
  return (
    <p className="mt-1.5 text-xs font-medium text-tinta-2 dark:text-slate-400" title={ayuda}>
      <Estado color={color}>{texto}</Estado>
    </p>
  );
}
