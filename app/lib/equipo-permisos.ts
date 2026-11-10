// Permisos y perfiles que el ADMIN DE UNA EMPRESA-CLIENTE puede darle a su gente (pantalla «Mi equipo»).
// Misma lista para la API (valida en el servidor) y para la pantalla (la dibuja). Fuente de verdad de qué significa cada permiso: api-auth.ts.
// Regla: una empresa solo puede dar permisos de los módulos que contrató (PERMISOS_DEL_MODULO); lo demás se descarta aquí y además
// `aplicarModulosDeCliente` (api-auth.ts) lo anula al leer, aunque alguien lo guardara a mano en la base.
import { PERMISOS_DEL_MODULO, type Modulo } from '@/app/lib/modulos';

export interface PermisoDef { clave: string; modulo: Modulo; etiqueta: string; ayuda: string }

/** Nombre claro de cada permiso. Un permiso sin etiqueta aquí NO se ofrece a las empresas (es interno o de un perfil especial). */
const ETIQUETAS: Record<string, { etiqueta: string; ayuda: string }> = {
  acceso_radar:            { etiqueta: 'Usar el Radar', ayuda: 'Buscar licitaciones y recibir alertas con las palabras clave.' },
  repartir_puente:         { etiqueta: 'Repartir licitaciones del Puente', ayuda: 'Asignar a su equipo las licitaciones que llegan al Puente.' },
  alertas_anexos:          { etiqueta: 'Avisos de anexos', ayuda: 'Recibir avisos cuando una licitación trae anexos que hay que completar.' },
  ver_otros_negocios:      { etiqueta: 'Ver los negocios de otras personas', ayuda: 'Sin esto, solo ve los negocios que tiene asignados.' },
  exportar:                { etiqueta: 'Exportar', ayuda: 'Descargar listados y reportes.' },
  comentar_viabilidad:     { etiqueta: 'Comentar la viabilidad', ayuda: 'Dejar comentarios en el análisis de viabilidad.' },
  viabilidad_automatica:   { etiqueta: 'Viabilidad automática', ayuda: 'Que las licitaciones que toma se analicen solas.' },
  chat_licitacion:         { etiqueta: 'Chat IA de la licitación', ayuda: 'Preguntarle a la IA sobre una licitación.' },
  chat_global:             { etiqueta: 'Chat IA general', ayuda: 'Preguntarle a la IA sobre todas las licitaciones.' },
  costeo_ver:              { etiqueta: 'Ver el costeo', ayuda: 'Solo lectura.' },
  costeo_editor:           { etiqueta: 'Editar el costeo', ayuda: 'Ver y guardar el costeo de un negocio.' },
  costeo_exportar:         { etiqueta: 'Exportar el costeo a Excel', ayuda: '' },
  costeo_agregar_fila:     { etiqueta: 'Agregar filas al costeo', ayuda: '' },
  costeo_agregar_gasto:    { etiqueta: 'Agregar gastos extra al costeo', ayuda: '' },
  costeo_agregar_adicional:{ etiqueta: 'Agregar costos adicionales al costeo', ayuda: '' },
  costeo_editar_postulado: { etiqueta: 'Editar el costeo de un negocio ya postulado', ayuda: 'Normalmente queda congelado al postular.' },
  anexos:                  { etiqueta: 'Generar y rellenar anexos', ayuda: '' },
  auditor_tecnico:         { etiqueta: 'Auditor técnico', ayuda: 'Cargar ítems del checklist técnico.' },
  auditor_compra:          { etiqueta: 'Auditor de compra', ayuda: '' },
  auditor_aprobar:         { etiqueta: 'Aprobar en el Auditor', ayuda: 'Visar los puntos del Auditor.' },
  aprobar_comercial:       { etiqueta: 'Aprobar lo comercial', ayuda: 'Visar el costeo y abrir la bandeja de Aprobaciones.' },
};

const moduloDe = (clave: string): Modulo | null => {
  for (const [m, claves] of Object.entries(PERMISOS_DEL_MODULO)) if (claves.includes(clave)) return m as Modulo;
  return null;
};

/** Permisos que se le pueden ofrecer a una empresa según los módulos que contrató, en el orden de la lista. */
export function catalogoParaModulos(modulos: Modulo[]): PermisoDef[] {
  const out: PermisoDef[] = [];
  for (const [clave, t] of Object.entries(ETIQUETAS)) {
    const modulo = moduloDe(clave);
    if (modulo && modulos.includes(modulo)) out.push({ clave, modulo, ...t });
  }
  return out;
}

/** Lo que llega de afuera → solo permisos conocidos y contratados, como { clave: true }. Nunca confía en el navegador. */
export function sanearPermisos(raw: unknown, modulos: Modulo[]): Record<string, true> {
  const permitidos = new Set(catalogoParaModulos(modulos).map(p => p.clave));
  const out: Record<string, true> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === true && permitidos.has(k)) out[k] = true;
  return out;
}

export type RolEmpresa = 'admin' | 'usuario' | 'externo';
export const ROLES_EMPRESA: RolEmpresa[] = ['admin', 'usuario', 'externo'];

export interface Perfil { id: string; nombre: string; descripcion: string; rol: RolEmpresa; permisos: 'todos' | string[] }

/** Perfiles de partida. «Personalizado» no es un perfil: es lo que queda cuando se marcan permisos a mano. */
export const PERFILES: Perfil[] = [
  { id: 'admin',    nombre: 'Administrador', rol: 'admin',   permisos: 'todos', descripcion: 'Ve y administra todo lo contratado, y maneja a las personas del equipo.' },
  { id: 'gestor',   nombre: 'Gestor',        rol: 'usuario', permisos: 'todos', descripcion: 'Trabaja con todo lo contratado y ve los negocios de todo el equipo. No administra personas.' },
  { id: 'analista', nombre: 'Analista',      rol: 'usuario', permisos: ['acceso_radar', 'comentar_viabilidad', 'exportar', 'chat_licitacion'], descripcion: 'Busca y analiza licitaciones. Solo ve los negocios que tiene asignados.' },
  { id: 'consulta', nombre: 'Consulta',      rol: 'usuario', permisos: ['acceso_radar', 'ver_otros_negocios', 'costeo_ver', 'chat_licitacion'], descripcion: 'Mira todo, no modifica nada importante.' },
  { id: 'externo',  nombre: 'Externo',       rol: 'externo', permisos: [], descripcion: 'Persona de afuera: solo ve las licitaciones que le asignes.' },
];

export function perfilPorId(id: unknown): Perfil | null {
  return PERFILES.find(p => p.id === id) ?? null;
}

/** Permisos concretos de un perfil para los módulos que tiene esta empresa. */
export function permisosDePerfil(perfil: Perfil, modulos: Modulo[]): Record<string, true> {
  const todos = catalogoParaModulos(modulos).map(p => p.clave);
  const claves = perfil.permisos === 'todos' ? todos : perfil.permisos.filter(c => todos.includes(c));
  return Object.fromEntries(claves.map(c => [c, true as const]));
}

/** Clave temporal legible (sin 0/O/1/l/I) para entregar una sola vez. */
export function claveTemporal(largo = 12): string {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(largo);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alfabeto[b % alfabeto.length]).join('');
}
