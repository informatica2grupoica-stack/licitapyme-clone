// src/app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { searchEngine } from '@/app/lib/search-engine';
import { SearchRequest, SearchResponse, Oportunidad } from '@/app/types/search.types';
import { Licitacion } from '@/app/types/mercado-publico.types';

// Cache por consulta paginada (resultados ya enriquecidos)
const cache = new Map<string, { data: SearchResponse; timestamp: number }>();
const CACHE_DURATION = 3 * 60 * 1000; // 3 minutos

// Cache del pool de licitaciones crudas (7 días) — compartido entre páginas del mismo día
const rawPool = new Map<string, { data: Licitacion[]; timestamp: number }>();
const RAW_POOL_DURATION = 8 * 60 * 1000; // 8 minutos

// Usar API REAL
const USE_MOCK = false;

// Datos mock (fallback)
const MOCK_LICITACIONES: Licitacion[] = getMockLicitaciones();

// ── Enriquecimiento de resultados ──────────────────────────────────────────
// La consulta por fecha en la API de MP solo devuelve campos mínimos
// (CodigoExterno, Nombre, CodigoEstado, FechaCierre). Para mostrar organismo,
// región, monto y descripción en las tarjetas, llamamos individualmente al
// endpoint ?codigo=XXX para cada resultado de la página actual.
async function enrichirPagina(
  client: ReturnType<typeof getMercadoPublicoClient>,
  resultados: Oportunidad[]
): Promise<Oportunidad[]> {
  // Solo enriquecer si el primer resultado tiene organismo vacío
  const necesitaEnriquecimiento = resultados.some(r => !r.organismo);
  if (!necesitaEnriquecimiento) return resultados;

  const enriched = await Promise.all(
    resultados.map(async (opp): Promise<Oportunidad> => {
      if (opp.organismo) return opp; // Ya tiene datos completos
      try {
        const full = await client.obtenerPorCodigo(opp.codigo);
        if (full) {
          return {
            ...searchEngine.licitacionToOportunidad(full, ''),
            score: opp.score, // Preservar score de relevancia
          };
        }
      } catch {
        // Fallo silencioso: usar datos mínimos
      }
      return opp;
    })
  );
  return enriched;
}

// Función para detectar si es una búsqueda por código
function esBusquedaPorCodigo(consulta: string): boolean {
  if (!consulta) return false;
  // Patrones de código de licitación: 1234-56-LP23, 1509-5-L114, etc.
  const patronCodigo = /^\d{4,5}-\d{1,2}-[A-Z0-9]{2,4}$/i;
  // También números largos (posible ID)
  const patronNumerico = /^\d{8,}$/;
  return patronCodigo.test(consulta) || patronNumerico.test(consulta);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  
  try {
    const body: SearchRequest = await request.json();
    let { consulta, pagina = 1, resultados_por_pagina = 20, ...filters } = body;
    
    console.log(`\n🔍 ===== NUEVA BÚSQUEDA =====`);
    console.log(`📝 Consulta: "${consulta || '(vacío)'}"`);
    
    // Detectar si es búsqueda por código
    const esCodigo = consulta ? esBusquedaPorCodigo(consulta) : false;
    console.log(`🔖 ¿Es búsqueda por código?: ${esCodigo ? 'SÍ' : 'NO'}`);

    // Verificar caché
    const cacheKey = JSON.stringify(body);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`✅ Cache hit`);
      return NextResponse.json(cached.data);
    }

    let searchResult: SearchResponse;

    if (USE_MOCK) {
      console.log('📦 Usando datos MOCK');
      searchResult = searchEngine.search(MOCK_LICITACIONES, {
        consulta: esCodigo ? '' : consulta,
        pagina,
        resultados_por_pagina,
        ...filters
      });
      searchResult.meta.fuente_datos = 'MOCK (prueba)';
      searchResult.meta.total_licitaciones_procesadas = MOCK_LICITACIONES.length;
    } else {
      console.log('🌐 Consultando API REAL de Mercado Público...');
      
      try {
        const client = getMercadoPublicoClient();
        
        // Si es búsqueda por código, buscar específicamente por código
        if (esCodigo && consulta) {
          console.log(`🔍 Buscando por código específico: ${consulta}`);
          const licitacion = await client.obtenerPorCodigo(consulta);
          
          if (licitacion) {
            // Convertir licitación individual a formato Oportunidad
            const oportunidades: Oportunidad[] = [{
              codigo: licitacion.Codigo,
              nombre: licitacion.Nombre,
              descripcion: licitacion.Descripcion || '',
              organismo: licitacion.Organismo,
              codigo_organismo: licitacion.CodigoOrganismo,
              region: licitacion.Region || '',
              estado: licitacion.Estado,
              fecha_publicacion: licitacion.FechaPublicacion,
              fecha_cierre: licitacion.FechaCierre,
              dias_cierre: Math.ceil((new Date(licitacion.FechaCierre).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
              monto_total: licitacion.MontoTotal || 0,
              items: (licitacion.Items || []).map(item => ({
                codigo_producto: item.CodigoProducto,
                nombre_producto: item.NombreProducto,
                cantidad: item.Cantidad,
                unidad: item.Unidad,
                monto_total: item.MontoTotal || item.MontoUnitario || 0
              })),
              url: licitacion.Url || '',
              score: 1
            }];
            
            searchResult = {
              resultados: oportunidades,
              meta: {
                pagina_actual: pagina,
                total_paginas: 1,
                total_resultados: oportunidades.length,
                resultados_por_pagina,
                tiempo_busqueda_ms: Date.now() - startTime,
                tipo_orden_aplicado: 'codigo_exacto',
                fuente_datos: 'API Mercado Público',
                total_licitaciones_procesadas: 1
              }
            };
            console.log(`✅ Licitación encontrada por código: ${licitacion.Nombre}`);
          } else {
            console.log(`⚠️ No se encontró licitación con código: ${consulta}`);
            searchResult = {
              resultados: [],
              meta: {
                pagina_actual: pagina,
                total_paginas: 0,
                total_resultados: 0,
                resultados_por_pagina,
                tiempo_busqueda_ms: Date.now() - startTime,
                tipo_orden_aplicado: 'relevancia',
                fuente_datos: 'API Mercado Público',
                total_licitaciones_procesadas: 0
              }
            };
          }
        } else {
          // Búsqueda por texto normal — usar pool cacheado si está disponible
          const poolKey = 'pool_7d';
          const cachedPool = rawPool.get(poolKey);
          let licitaciones: Licitacion[];

          if (cachedPool && Date.now() - cachedPool.timestamp < RAW_POOL_DURATION) {
            licitaciones = cachedPool.data;
            console.log(`⚡ Pool cacheado: ${licitaciones.length} licitaciones`);
          } else {
            console.log(`📅 Consultando licitaciones de los últimos 7 días...`);
            licitaciones = await client.obtenerUltimosDias(7);
            rawPool.set(poolKey, { data: licitaciones, timestamp: Date.now() });
            console.log(`✅ Pool actualizado: ${licitaciones.length} licitaciones`);
          }

          if (licitaciones.length === 0) {
            console.warn('⚠️ No se encontraron licitaciones, usando datos MOCK');
            searchResult = searchEngine.search(MOCK_LICITACIONES, {
              consulta,
              pagina,
              resultados_por_pagina,
              ...filters
            });
            searchResult.meta.fuente_datos = 'MOCK (fallback)';
            searchResult.meta.total_licitaciones_procesadas = MOCK_LICITACIONES.length;
          } else {
            console.log(`✅ Buscando en ${licitaciones.length} licitaciones`);
            searchResult = searchEngine.search(licitaciones, {
              consulta,
              pagina,
              resultados_por_pagina,
              ...filters
            });
            searchResult.meta.fuente_datos = 'API Mercado Público';
            searchResult.meta.total_licitaciones_procesadas = licitaciones.length;

            // ── Enriquecer resultados de esta página con datos completos ──
            // La API fecha solo devuelve nombre+estado+fecha; este paso
            // agrega organismo, región, monto, descripción llamando ?codigo=
            if (searchResult.resultados.length > 0) {
              console.log(`🔍 Enriqueciendo ${searchResult.resultados.length} resultados...`);
              searchResult.resultados = await enrichirPagina(client, searchResult.resultados);
            }
          }
        }
      } catch (apiError) {
        console.error('❌ Error al consultar API real:', apiError);
        console.log('📦 Usando datos MOCK como fallback');
        searchResult = searchEngine.search(MOCK_LICITACIONES, {
          consulta: esCodigo ? '' : consulta,
          pagina,
          resultados_por_pagina,
          ...filters
        });
        searchResult.meta.fuente_datos = 'MOCK (error fallback)';
        searchResult.meta.total_licitaciones_procesadas = MOCK_LICITACIONES.length;
      }
    }

    // Agregar tiempo de búsqueda
    searchResult.meta.tiempo_busqueda_ms = Date.now() - startTime;

    // Guardar en caché
    cache.set(cacheKey, {
      data: searchResult,
      timestamp: Date.now()
    });

    console.log(`✅ Búsqueda completada en ${searchResult.meta.tiempo_busqueda_ms}ms`);
    console.log(`📊 Resultados: ${searchResult.meta.total_resultados}`);
    console.log(`🔗 Fuente: ${searchResult.meta.fuente_datos}`);
    
    return NextResponse.json(searchResult);
    
  } catch (error) {
    console.error('❌ Error en búsqueda:', error);
    const errorResponse: SearchResponse = {
      resultados: [],
      meta: {
        pagina_actual: 1,
        total_paginas: 0,
        total_resultados: 0,
        resultados_por_pagina: 20,
        tiempo_busqueda_ms: Date.now() - startTime,
        tipo_orden_aplicado: 'relevancia',
        fuente_datos: 'ERROR',
        total_licitaciones_procesadas: 0,
        error: String(error)
      }
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// Endpoint GET para pruebas
export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get('q');
  
  // Endpoint de prueba de conexión
  if (searchParams.get('test') === 'true') {
    try {
      const { getMercadoPublicoClient } = await import('@/app/lib/mercado-publico');
      const client = getMercadoPublicoClient();
      const conexionOk = await client.probarConexion();
      return NextResponse.json({ 
        conexion: conexionOk ? 'OK' : 'FALLIDA',
        message: conexionOk ? 'API de Mercado Público conectada correctamente' : 'Error de conexión',
        ticket_configurado: !!process.env.MERCADO_PUBLICO_TICKET
      });
    } catch (error) {
      return NextResponse.json({ 
        conexion: 'ERROR',
        error: String(error),
        message: 'Error al conectar con la API. Verifica tu ticket en .env.local'
      }, { status: 500 });
    }
  }
  
  if (!q) {
    return NextResponse.json({ 
      error: 'Se requiere parámetro q',
      ejemplo: '/api/search?q=computadores',
      test: '/api/search?test=true'
    }, { status: 400 });
  }
  
  // Búsqueda normal vía POST
  const postRequest = new NextRequest('http://localhost:3000/api/search', {
    method: 'POST',
    body: JSON.stringify({ consulta: q, pagina: 1, resultados_por_pagina: 10 }),
    headers: new Headers({ 'Content-Type': 'application/json' })
  });
  
  return POST(postRequest);
}

function getMockLicitaciones(): Licitacion[] {
  return [
    {
      Codigo: "1234-56-LP23",
      Nombre: "Suministro de computadores portátiles",
      Descripcion: "Adquisición de 50 notebooks para oficinas centrales.",
      Estado: "5",
      FechaPublicacion: "2026-05-01T00:00:00",
      FechaCierre: "2026-06-15T15:00:00",
      Organismo: "Ministerio de Educación",
      CodigoOrganismo: "MINEDUC",
      Region: "Región Metropolitana",
      MontoTotal: 25000000,
      Items: []
    },
    {
      Codigo: "5678-90-CA12",
      Nombre: "Servicios de aseo y limpieza",
      Descripcion: "Mantención de oficinas gubernamentales.",
      Estado: "5",
      FechaPublicacion: "2026-05-10T00:00:00",
      FechaCierre: "2026-06-20T15:00:00",
      Organismo: "Ministerio del Interior",
      CodigoOrganismo: "MININTERIOR",
      Region: "Región Metropolitana",
      MontoTotal: 15000000,
      Items: []
    },
    {
      Codigo: "1509-5-L114",
      Nombre: "Insumos Medicos y Medicamentos",
      Descripcion: "Compra de insumos y medicamentos para la unidad de urgencia.",
      Estado: "8",
      FechaPublicacion: "2014-01-20T00:00:00",
      FechaCierre: "2014-01-27T15:54:00",
      Organismo: "SERVICIO DE SALUD METROPOLITANO NORTE HOSPITAL DE TIL TIL",
      CodigoOrganismo: "7274",
      Region: "Región Metropolitana",
      MontoTotal: 0,
      Items: []
    },
    {
      Codigo: "9012-34-LP56",
      Nombre: "Adquisición de mobiliario de oficina",
      Descripcion: "Escritorios, sillas y estanterías.",
      Estado: "5",
      FechaPublicacion: "2026-05-05T00:00:00",
      FechaCierre: "2026-06-10T15:00:00",
      Organismo: "Ministerio de Hacienda",
      CodigoOrganismo: "MINHACIENDA",
      Region: "Región Metropolitana",
      MontoTotal: 8000000,
      Items: []
    },
    {
      Codigo: "1112-13-LP78",
      Nombre: "Servicio de mantención de equipos médicos",
      Descripcion: "Mantención preventiva y correctiva.",
      Estado: "5",
      FechaPublicacion: "2026-05-08T00:00:00",
      FechaCierre: "2026-06-25T15:00:00",
      Organismo: "Ministerio de Salud",
      CodigoOrganismo: "MINSAL",
      Region: "Región Metropolitana",
      MontoTotal: 45000000,
      Items: []
    }
  ];
}