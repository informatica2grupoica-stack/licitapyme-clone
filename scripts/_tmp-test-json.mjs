import { parseJsonIA } from '../app/lib/json-ia.ts';
const casos = [
  ['control char en string (el bug)', '{"a":"linea1\nlinea2\ttab"}'],
  ['fences ```json',                  '```json\n{"ok":true,"n":5}\n```'],
  ['texto antes/después',             'Aquí está: {"x":1} listo.'],
  ['truncado (sin cerrar)',           '{"items":[{"id":1},{"id":2},{"id":'],
  ['array top-level (prefiltro)',     '[{"i":0,"decision":"PASA"},{"i":1,"decision":"EXCLUIDO"}]'],
  ['control char + truncado',         '{"desc":"hola\nmundo","lista":[1,2'],
  ['basura total',                    'no hay json aquí'],
];
for (const [nombre, entrada] of casos) {
  const r = parseJsonIA(entrada);
  console.log(`${r ? '✅' : '❌'} ${nombre} → ${r ? JSON.stringify(r).slice(0,60) : 'null'}`);
}
