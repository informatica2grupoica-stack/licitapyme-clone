// Términos y condiciones de uso. Pública. Los datos de quien opera el servicio vienen de legal-config.ts.
import type { Metadata } from 'next';
import Link from 'next/link';
import { PaginaLegal, Bloque, Lista } from '@/app/components/PaginaLegal';
import { datosLegales } from '@/app/lib/legal-config';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Términos y condiciones · LICITANK' };

export default function TerminosPage() {
  const d = datosLegales();
  return (
    <PaginaLegal titulo="Términos y condiciones de uso" vigencia={d.vigencia}>
      <p>
        Estos términos regulan el uso de LICITANK, plataforma operada por <strong>{d.razonSocial}</strong> (RUT {d.rut}) para gestionar licitaciones y compras públicas.
        Al usar el servicio, tu empresa y las personas que acceden con su cuenta los aceptan.
      </p>

      <Bloque titulo="1. El servicio">
        <p>
          LICITANK ayuda a buscar licitaciones de Mercado Público, evaluar su viabilidad, costear ofertas, preparar anexos y gestionar compras.
          Los módulos disponibles dependen del plan contratado por cada empresa.
        </p>
      </Bloque>

      <Bloque titulo="2. Cuentas y responsabilidad de uso">
        <Lista items={[
          'Cada persona usa su propia cuenta y es responsable de mantener su contraseña en reserva.',
          'La empresa define quiénes acceden y con qué permisos, y debe dar de baja las cuentas de quienes ya no deban usarlas.',
          'No se permite compartir cuentas, intentar acceder a datos de otra empresa, ni usar el servicio para fines ilícitos.',
        ]} />
      </Bloque>

      <Bloque titulo="3. Resultados con inteligencia artificial">
        <p>
          Los análisis, extracciones y borradores que genera la plataforma con inteligencia artificial son una ayuda y pueden contener errores u omisiones.
          Antes de postular o comprar, la empresa debe revisarlos contra las bases y documentos oficiales. La decisión de ofertar, los precios, los anexos
          y su firma son responsabilidad de la empresa.
        </p>
      </Bloque>

      <Bloque titulo="4. Información de Mercado Público y de terceros">
        <p>
          La información de licitaciones proviene de Mercado Público y de otros servicios de terceros (por ejemplo, ERP o mensajería) a los que la empresa decide conectarse.
          No controlamos su disponibilidad ni exactitud, y sus condiciones de uso aplican a esa conexión.
        </p>
      </Bloque>

      <Bloque titulo="5. Datos de la empresa">
        <p>
          Los datos y documentos que la empresa carga siguen siendo suyos. Nos autoriza a tratarlos solo para prestar el servicio, según la{' '}
          <Link href="/privacidad" className="text-marca hover:underline">política de privacidad</Link>.
          La empresa garantiza que tiene derecho a subirlos y que, si incluyen datos de otras personas, cuenta con la base legal para hacerlo.
        </p>
      </Bloque>

      <Bloque titulo="6. Disponibilidad y cambios">
        <p>
          Procuramos mantener el servicio disponible, pero puede haber interrupciones por mantención o por causas ajenas (proveedores, conectividad, cambios en Mercado Público).
          Podemos mejorar o modificar funciones; si un cambio afecta de forma importante a los clientes, lo avisaremos.
        </p>
      </Bloque>

      <Bloque titulo="7. Propiedad intelectual">
        <p>
          El software, el diseño y la marca LICITANK pertenecen a su titular. El contrato da a la empresa un derecho de uso del servicio mientras esté vigente, no la propiedad del software.
        </p>
      </Bloque>

      <Bloque titulo="8. Suspensión y término">
        <p>
          Podemos suspender cuentas por uso indebido, riesgo de seguridad o falta de pago. La empresa puede terminar el servicio cuando lo indique su contrato; al término puede
          pedir la exportación y eliminación de sus datos.
        </p>
      </Bloque>

      <Bloque titulo="9. Límite de responsabilidad">
        <p>
          En la medida que la ley lo permita, no respondemos por pérdidas derivadas de decisiones de postulación o compra tomadas con apoyo de la plataforma, ni por interrupciones de servicios de terceros.
          Esto no limita responsabilidades que la ley no permita excluir.
        </p>
      </Bloque>

      <Bloque titulo="10. Ley aplicable y contacto">
        <p>
          Estos términos se rigen por las leyes de Chile y cualquier controversia se someterá a los tribunales ordinarios de justicia competentes.
          Consultas: <strong>{d.correoPrivacidad}</strong>.
        </p>
      </Bloque>
    </PaginaLegal>
  );
}
