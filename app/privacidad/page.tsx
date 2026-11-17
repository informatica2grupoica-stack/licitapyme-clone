// Política de privacidad (Ley 19.628, modificada por la Ley 21.719). Pública. Los datos de quien opera el servicio vienen de legal-config.ts.
import type { Metadata } from 'next';
import { PaginaLegal, Bloque, Lista } from '@/app/components/PaginaLegal';
import { datosLegales } from '@/app/lib/legal-config';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Política de privacidad · LICITANK' };

export default function PrivacidadPage() {
  const d = datosLegales();
  return (
    <PaginaLegal titulo="Política de privacidad" vigencia={d.vigencia}>
      <p>
        Esta política explica qué datos personales trata LICITANK, para qué, con quién los comparte y cómo puedes ejercer tus derechos
        conforme a la Ley N° 19.628 sobre protección de la vida privada, modificada por la Ley N° 21.719.
      </p>

      <Bloque titulo="1. Quién trata tus datos">
        <p>
          LICITANK es operado por <strong>{d.razonSocial}</strong>, RUT {d.rut}, con domicilio en {d.domicilio}. Contacto para temas de
          privacidad: <strong>{d.correoPrivacidad}</strong>.
        </p>
        <p>Su rol depende del dato:</p>
        <Lista items={[
          <>Datos de tu cuenta de usuario (correo, nombre, uso de la plataforma): LICITANK es <strong>responsable</strong>.</>,
          <>Datos que tu empresa carga o genera dentro de la plataforma (licitaciones, costeos, anexos, cotizaciones, documentos, equipo de trabajo): tu empresa es la <strong>responsable</strong> y LICITANK actúa como <strong>encargado</strong>, siguiendo sus instrucciones.</>,
        ]} />
      </Bloque>

      <Bloque titulo="2. Qué datos tratamos">
        <Lista items={[
          'Cuenta: nombre, correo, teléfono, RUT, cargo, área y foto de perfil si la entregas; rol y permisos dentro de tu empresa.',
          'Uso y seguridad: inicios de sesión, dirección IP, intentos fallidos, acciones relevantes (quién aprobó, cambió o eliminó algo) y reportes de error con la captura que tú marques.',
          'Datos de la empresa que usa el servicio: razón social, RUT, representantes legales, firmas, timbres, certificados y datos de contacto que aparecen en los anexos de una licitación (pueden incluir RUT y cédula de identidad de representantes).',
          'Documentos y archivos que subes: bases, cotizaciones, fichas técnicas, facturas, órdenes de compra y datos de contacto de proveedores que figuran en ellos.',
          'Información pública de Mercado Público (licitaciones, órdenes de compra, adjudicaciones).',
        ]} />
        <p>No pedimos datos sensibles. Si un documento que subes los contiene, es responsabilidad de tu empresa subirlo solo si es necesario.</p>
      </Bloque>

      <Bloque titulo="3. Para qué y con qué base">
        <Lista items={[
          'Prestar el servicio contratado (gestión de licitaciones, costeo, anexos, compras): ejecución del contrato.',
          'Enviar alertas por correo y, si tu empresa lo activa, por WhatsApp: ejecución del contrato; el WhatsApp además requiere que la persona destinataria haya aceptado recibirlo.',
          'Mantener la seguridad, prevenir fraudes y registrar quién hizo qué: interés legítimo.',
          'Cumplir obligaciones legales y atender requerimientos de autoridad competente.',
        ]} />
        <p>No vendemos datos personales ni los usamos para publicidad.</p>
      </Bloque>

      <Bloque titulo="4. Con quién los compartimos">
        <p>Para operar el servicio usamos proveedores que tratan datos por nuestra cuenta (encargados):</p>
        <Lista items={[
          'Alojamiento del servidor y de la base de datos, y respaldos.',
          'Almacenamiento de archivos (Cloudflare R2).',
          'Envío de correo electrónico.',
          'Proveedores de inteligencia artificial que leen documentos para extraer información (por ejemplo Z.AI, Moonshot y otros según la configuración vigente).',
          'Obuma, solo si tu empresa conecta su cuenta para órdenes de compra y facturas.',
          'Un servicio de mensajería de WhatsApp, solo si tu empresa activa los avisos.',
        ]} />
        <p>
          Algunos de estos proveedores pueden procesar datos fuera de Chile. En esos casos exigimos medidas de seguridad adecuadas y enviamos solo
          lo necesario para la tarea. Puedes pedirnos la lista actualizada de proveedores escribiendo al correo de contacto.
        </p>
      </Bloque>

      <Bloque titulo="5. Cuánto tiempo los guardamos">
        <p>
          Mientras tu empresa tenga el servicio activo. Al terminar, tu empresa puede pedir la exportación de sus datos y su eliminación junto con sus archivos,
          salvo lo que la ley nos obligue a conservar. Los respaldos se renuevan de forma periódica y los datos eliminados salen de ellos al cumplirse ese ciclo.
        </p>
      </Bloque>

      <Bloque titulo="6. Tus derechos">
        <p>Puedes pedir:</p>
        <Lista items={[
          'Acceso: saber qué datos tuyos tratamos y recibir una copia.',
          'Rectificación: corregir datos inexactos o incompletos.',
          'Supresión: que eliminemos tus datos cuando ya no sean necesarios o retires tu consentimiento.',
          'Oposición: que dejemos de tratarlos para una finalidad determinada.',
          'Portabilidad: recibir tus datos en un formato estructurado y de uso común.',
          'Bloqueo temporal de tus datos mientras se resuelve una solicitud.',
        ]} />
        <p>
          Escribe a <strong>{d.correoPrivacidad}</strong> indicando tu nombre, tu correo de la cuenta y qué derecho quieres ejercer. Responderemos dentro del plazo que fija la ley
          (30 días corridos, prorrogables en los casos que ella permite). Si la solicitud es sobre datos que tu empresa carga en la plataforma, la derivaremos a tu empresa, que es la responsable.
        </p>
        <p>Si no quedas conforme con la respuesta, puedes reclamar ante la Agencia de Protección de Datos Personales.</p>
      </Bloque>

      <Bloque titulo="7. Cómo protegemos los datos">
        <Lista items={[
          'Cada empresa ve solo sus datos: la información está separada por cliente y se verifica en cada petición.',
          'Las contraseñas se guardan con hash, hay bloqueo temporal por intentos fallidos y la sesión se puede cerrar de forma efectiva.',
          'Las conexiones al servicio van por HTTPS y las credenciales de integraciones de cada empresa se guardan cifradas.',
          'Revisamos la seguridad de forma periódica y corregimos lo que encontramos.',
        ]} />
        <p>
          Si ocurre una vulneración que afecte datos personales, la gestionaremos con prioridad y la comunicaremos a las personas afectadas y a la autoridad cuando la ley lo exija.
        </p>
      </Bloque>

      <Bloque titulo="8. Cookies">
        <p>
          Usamos una cookie de sesión, necesaria para mantenerte conectado, y guardamos en tu navegador preferencias de uso (por ejemplo, el tema claro u oscuro).
          No usamos cookies de publicidad ni de seguimiento de terceros.
        </p>
      </Bloque>

      <Bloque titulo="9. Cambios a esta política">
        <p>Si la modificamos de forma importante, lo avisaremos dentro de la plataforma. La fecha de vigencia está al inicio de esta página.</p>
      </Bloque>
    </PaginaLegal>
  );
}
