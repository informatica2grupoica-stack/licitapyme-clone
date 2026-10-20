// Tipos de incidencia que se pueden levantar desde un ítem de las fichas técnicas (Compras → Costeo → Fichas).
// Archivo sin imports de servidor: lo usan el selector del cliente y la ruta que crea las tareas.
export const TIPOS_INCIDENCIA_FICHA = [
  { value: 'no_cumple', label: 'La ficha no cumple las bases' },
  { value: 'falta_ficha', label: 'Falta la ficha técnica' },
  { value: 'ficha_ilegible', label: 'Ficha ilegible o incompleta' },
  { value: 'modelo_distinto', label: 'Marca o modelo distinto al ofertado' },
  { value: 'sin_stock', label: 'Producto descontinuado o sin stock' },
  { value: 'dato_dudoso', label: 'Dato por confirmar con el proveedor' },
  { value: 'otra', label: 'Otra (explicar en el comentario)' },
] as const;

export const etiquetaTipoIncidenciaFicha = (valor: string) => TIPOS_INCIDENCIA_FICHA.find(t => t.value === valor)?.label ?? null;
