// «Compras cerradas» ya no es una pantalla aparte (11-nov-2026): vive en /compras, pestañas Abiertas / Cerradas / Canceladas / Todas.
import { redirect } from 'next/navigation';

export default function ComprasCerradasRedirect() {
  redirect('/compras');
}
