// Prueba de la generación del checklist de Información Comercial, sin tocar la BD.
//   npx tsx scripts/probar-checklist-comercial.mts
//
// Vale la pena tenerla: esta lógica traduce el informe de viabilidad a puntos de trabajo y
// regresiona en silencio. Ya cazó un duplicado real (el plazo salía dos veces, como criterio
// evaluado y como rango de admisibilidad, obligando a cargarlo y aprobarlo dos veces).
import { generarItemsDesdeViabilidad, resumirChecklist, transicion, tieneInformacionComercial, esPorLinea } from '../app/lib/checklist-comercial.js';

const informeV3 = {
  _schema: 'v3',
  modalidad: { tipo: 'por_linea', estado: 'OK', como_se_adjudica: 'POR_LINEAS', cotizar_100_obligatorio: false },
  criterios_evaluacion: {
    criterios: [
      { nombre: 'Precio', ponderacion_efectiva: 60, forma_aplicacion: 'menor precio 100 pts', fuente: 'Bases p.12' },
      { nombre: 'Experiencia del oferente', ponderacion_efectiva: 20, forma_aplicacion: 'certificados', fuente: 'Bases p.13' },
      { nombre: 'Plazo de entrega', ponderacion_efectiva: 15, forma_aplicacion: 'menor plazo', fuente: 'Bases p.13' },
      { nombre: 'Cumplimiento de requisitos formales', ponderacion_efectiva: 5, fuente: 'Bases p.14' },
    ],
  },
  requisitos_admisibilidad: {
    firma_puno_y_letra: { exigida: true, evidencia_textual: 'firmado de puño y letra', fuente: 'Bases 8.2' },
    seriedad_oferta: { exige: false },
    fiel_cumplimiento: { exige: true, forma: 'boleta', plazo_entrega: '10 días hábiles', fuente: 'Bases 11' },
    boleta: { aplica: true, umbral_utm: 1000, detalle: 'sobre 1000 UTM', fuente: 'Bases 11.1' },
    contrato: { exige: true, plazos: '15 días', fuente: 'Bases 12' },
    cotizar_100: { aplica: false },
    plazo_entrega_rango: { min: '15 días', max: '30 días', fuera_de_rango_inadmisible: true, fuente: 'Bases 6' },
    bloqueantes: [{ item: 'Inscripción vigente en ChileProveedores', efecto: 'inadmisible', fuente: 'Bases 5' }],
    orden_anexos_propios: [
      { que_crear: 'Anexo N°1 Identificación del oferente', que_debe_contener: 'RUT, razón social, representante', criticidad: 'ADMISIBILIDAD_DURA', fuente: 'Anexo 1' },
      { que_crear: 'Declaración jurada de habilidad', que_debe_contener: 'firma del representante', criticidad: 'ADMISIBILIDAD_DURA', fuente: 'Anexo 2' },
    ],
  },
  manifiesto_productos: [
    { linea: 1, descripcion: 'Retroexcavadora', cantidad: 1, unidad_medida: 'unidad' },
    { linea: 2, descripcion: 'Compactador', cantidad: 2, unidad_medida: 'unidad' },
    { linea: 2, descripcion: 'Compactador (repetido)', cantidad: 2 },
  ],
};

const items = generarItemsDesdeViabilidad(informeV3);
console.log(`\n=== ${items.length} puntos generados · porLinea=${esPorLinea(informeV3)} ===`);
for (const i of items) {
  console.log(`  [${i.bloque.padEnd(14)}] ${i.tipo.padEnd(9)} ${i.criticidad.padEnd(22)} ${i.ponderacion ?? '  '}  ${i.titulo}`);
}

// Claves duplicadas → la unique de BD las rechazaría, así que no debe haber ninguna.
const claves = items.map(i => i.claveOrigen);
const dup = claves.filter((c, n) => claves.indexOf(c) !== n);
console.log('\nclaves duplicadas:', dup.length ? dup : 'ninguna ✓');

// El criterio "Precio" NO debe aparecer como punto documental (lo cubre el bloque de precios).
console.log('criterio precio duplicado:', items.some(i => i.claveOrigen === 'criterio:precio') ? 'SÍ ✗' : 'no ✓');

const estado = items.map(i => ({ estado: 'PENDIENTE' as const, criticidad: i.criticidad, tipo: i.tipo, ofertamos: null }));
console.log('\nresumen inicial:', resumirChecklist(estado));

// Suma alzada → un solo precio.
const alzada = generarItemsDesdeViabilidad({ ...informeV3, modalidad: { tipo: 'suma_alzada', estado: 'OK' } });
console.log('\nsuma alzada · precios:', alzada.filter(i => i.tipo === 'precio').map(i => i.titulo));

// Máquina de estados
console.log('\ntransiciones:');
console.log('  PENDIENTE+CARGAR  =', transicion('PENDIENTE', 'CARGAR'));
console.log('  CARGADO+APROBAR   =', transicion('CARGADO', 'APROBAR'));
console.log('  PENDIENTE+APROBAR =', transicion('PENDIENTE', 'APROBAR'), '(debe ser null)');
console.log('  APROBADO+CARGAR   =', transicion('APROBADO', 'CARGAR'), '(editar vuelve a revisión)');
console.log('  OBSERVADO+APROBAR =', transicion('OBSERVADO', 'APROBAR'), '(debe ser null)');

console.log('\netapas:', ['ASIGNADO', 'EN_PROCESO', 'ANEXOS', 'VISADO', 'POSTULADA', 'ADJUDICADA']
  .map(e => `${e}=${tieneInformacionComercial(e)}`).join(' '));

// Informe vacío / sin viabilidad: no debe reventar.
console.log('\ninforme vacío →', generarItemsDesdeViabilidad({}).length, 'puntos (solo el precio total)');
