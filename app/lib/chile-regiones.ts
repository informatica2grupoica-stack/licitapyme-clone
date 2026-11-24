// app/lib/chile-regiones.ts
// Las 16 regiones de Chile, de norte a sur. La zona de cobertura de un fletero se guarda con `key` (nombre en minúsculas)
// en compras_fletero_zona.zona. Los contornos del mapa están en chile-mapa-datos.ts (generado, ver scripts/generar-mapa-chile.mjs).

export interface RegionChile { key: string; romano: string; nombre: string; nombreLargo: string }

export const REGIONES: RegionChile[] = [
  { key: 'arica y parinacota', romano: 'XV', nombre: 'Arica y Parinacota', nombreLargo: 'Arica y Parinacota' },
  { key: 'tarapacá', romano: 'I', nombre: 'Tarapacá', nombreLargo: 'Tarapacá' },
  { key: 'antofagasta', romano: 'II', nombre: 'Antofagasta', nombreLargo: 'Antofagasta' },
  { key: 'atacama', romano: 'III', nombre: 'Atacama', nombreLargo: 'Atacama' },
  { key: 'coquimbo', romano: 'IV', nombre: 'Coquimbo', nombreLargo: 'Coquimbo' },
  { key: 'valparaíso', romano: 'V', nombre: 'Valparaíso', nombreLargo: 'Valparaíso' },
  { key: 'metropolitana', romano: 'RM', nombre: 'Metropolitana', nombreLargo: 'Metropolitana de Santiago' },
  { key: "o'higgins", romano: 'VI', nombre: "O'Higgins", nombreLargo: "Libertador General Bernardo O'Higgins" },
  { key: 'maule', romano: 'VII', nombre: 'Maule', nombreLargo: 'Maule' },
  { key: 'ñuble', romano: 'XVI', nombre: 'Ñuble', nombreLargo: 'Ñuble' },
  { key: 'biobío', romano: 'VIII', nombre: 'Biobío', nombreLargo: 'Biobío' },
  { key: 'araucanía', romano: 'IX', nombre: 'La Araucanía', nombreLargo: 'La Araucanía' },
  { key: 'los ríos', romano: 'XIV', nombre: 'Los Ríos', nombreLargo: 'Los Ríos' },
  { key: 'los lagos', romano: 'X', nombre: 'Los Lagos', nombreLargo: 'Los Lagos' },
  { key: 'aysén', romano: 'XI', nombre: 'Aysén', nombreLargo: 'Aysén del General Carlos Ibáñez del Campo' },
  { key: 'magallanes', romano: 'XII', nombre: 'Magallanes', nombreLargo: 'Magallanes y de la Antártica Chilena' },
];

export const REGION_POR_KEY = new Map(REGIONES.map(r => [r.key, r]));
/** Texto legible de una zona guardada: si es una región conocida, su nombre; si es texto libre antiguo, tal cual. */
export const nombreZona = (z: string) => { const r = REGION_POR_KEY.get(z.trim().toLowerCase()); return r ? r.nombre : z; };
