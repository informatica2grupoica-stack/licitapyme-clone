# Diccionario de anexos — lo que el sistema SÍ reconoce hoy

Generado desde el código con `npx tsx scripts/scratch/_exportar-diccionario.mts`. Son las tres capas
DETERMINISTAS (sin IA) del motor de anexos: si una etiqueta calza acá, la casilla se llena sola y
siempre igual. Lo que no calza pasa al motor de IA o queda pendiente para que lo llene una persona.

## 1. Etiqueta de casilla → dato de la ficha

La etiqueta se normaliza antes de comparar: sin tildes, en minúscula, sin puntuación ni viñetas
("NOMBRE REP. LEGAL" se compara como "nombre rep legal").

### `razon_social` — Razón social / nombre de la empresa

| Reconoce | Patrón exacto |
| --- | --- |
| razon social( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^razon\s+social(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |
| nombre (completo )?o razon social( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^nombre\s+(?:completo\s+)?o\s+razon\s+social(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |
| razon social o nombre( completo)?( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^razon\s+social\s+o\s+nombre(?:\s+completo)?(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |
| nombre (completo )?(del? |de la )(empresa|oferente|proponente|participante|postulante|sociedad|entidad|institucion|firma) | `^nombre\s+(?:completo\s+)?(?:del?\s+|de\s+la\s+)(?:empresa|oferente|proponente|participante|postulante|sociedad|entidad|institucion|firma)$` |
| nombre (completo )?(del? (proponente|oferente)) o razon social | `^nombre (?:completo )?(?:del? (?:proponente|oferente)) o razon social$` |
| (identificacion|individualizacion) del (oferente|proponente|contribuyente) | `^(?:identificacion|individualizacion) del (?:oferente|proponente|contribuyente)$` |
| empresa | `^empresa$` |
| empresa oferente | `^empresa oferente$` |
| nombre de fantasia | `^nombre de fantasia$` |
| mi representada | `^mi representada$` |
| mi representada es | `^mi representada es$` |
| la empresa que represento | `^la empresa que represento$` |
| nombre (completo )?(del? |de la )?(empresa|oferente|proponente|participante|postulante|proveedor) o razon social | `^nombre (?:completo )?(?:del? |de la )?(?:empresa|oferente|proponente|participante|postulante|proveedor) o razon social$` |
| (oferente|proponente|postulante|participante|contratista) | `^(?:oferente|proponente|postulante|participante|contratista)$` |
| nombre (empresa|sociedad|oferente|proponente|proveedor|contratista) | `^nombre (?:empresa|sociedad|oferente|proponente|proveedor|contratista)$` |
| nombre (del? |de la )?(proveedor|empresa|oferente|proponente|contratista|razon social) / (proveedor|empresa|oferente|proponente|contratista|razon social) | `^nombre (?:del? |de la )?(?:proveedor|empresa|oferente|proponente|contratista|razon social)\s*\/\s*(?:proveedor|empresa|oferente|proponente|contratista|razon social)$` |
| nombre del? (proveedor|oferente|proponente|participante|postulante)( postulante)? a (la licitacion|este proceso|esta propuesta) | `^nombre\s+del?\s+(?:proveedor|oferente|proponente|participante|postulante)(?:\s+postulante)?\s+a\s+(?:la\s+licitacion|este\s+proceso|esta\s+propuesta)$` |

### `rut` — RUT de la empresa

| Reconoce | Patrón exacto |
| --- | --- |
| r u t( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^r\s*u\s*t(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |
| rol unico tributario( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^rol\s+unico\s+tributario(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |
| rut (de la )?(empresa|sociedad|entidad|razon social) | `^rut (?:de la )?(?:empresa|sociedad|entidad|razon social)$` |
| r u t (n[°º]?)? | `^r\s*u\s*t\s*(?:n[°º]?)?$` |
| rut/run | `^rut\/run$` |
| r u t o c i | `^r\s*u\s*t\s*o\s*c\s*i$` |
| rut o cedula( de identidad)? | `^rut o cedula(?: de identidad)?$` |
| (n[°º]? (de )?)?cedula de identidad o rut | `^(?:n[°º]?\s*(?:de\s+)?)?cedula de identidad o rut$` |
| c i o r u t | `^c\s*i\s*o\s*r\s*u\s*t$` |
| (n[°º]? (de )?)?rut o cedula de identidad | `^(?:n[°º]?\s*(?:de\s+)?)?rut o cedula de identidad$` |
| rut/cedula( de identidad)? | `^rut\/cedula(?: de identidad)?$` |
| cedula( de identidad)?/rut | `^cedula(?: de identidad)?\/rut$` |

### `giro` — Giro comercial — en algunos formularios la casilla dice "Rubro Comercial" o "Rubro" en vez de "Giro": es el MISMO dato, no lo dejes pendiente por la etiqueta distinta.

| Reconoce | Patrón exacto |
| --- | --- |
| giro( (comercial|del negocio|o actividad))?( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^giro(?:\s+(?:comercial|del\s+negocio|o\s+actividad))?(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |
| actividad (economica|comercial) | `^actividad (?:economica|comercial)$` |
| rubro | `^rubro$` |
| giro s i i | `^giro s\s*i\s*i$` |
| giro servicios de impuestos internos | `^giro servicios de impuestos internos$` |
| profesion,? oficio o giro | `^profesion,? oficio o giro$` |
| giro,? profesion u oficio | `^giro,? profesion u oficio$` |

### `direccion` — Dirección comercial COMPLETA (calle + número + comuna) — úsalo SOLO si la casilla pide "Domicilio"/"Dirección" en UNA sola casilla. Si la casilla dice "Calle", "N°"/"Número", "Comuna" o "Ciudad" por separado, usa el campo específico de abajo, nunca este entero.

| Reconoce | Patrón exacto |
| --- | --- |
| (direccion|domicilio)( (comercial|legal|particular|de la empresa))?( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^(?:direccion|domicilio)(?:\s+(?:comercial|legal|particular|de\s+la\s+empresa))?(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |
| direccion completa | `^direccion completa$` |
| domicilio (para efectos de )?(esta )?(licitacion|propuesta) | `^domicilio (?:para efectos de )?(?:esta )?(?:licitacion|propuesta)$` |
| (direccion|domicilio) y comuna | `^(?:direccion|domicilio) y comuna$` |
| comuna y (direccion|domicilio) | `^comuna y (?:direccion|domicilio)$` |
| domicilio comercial( que acredita| declarado)? | `^domicilio comercial(?: que acredita| declarado)?$` |

### `direccion_calle` — Solo el NOMBRE DE LA CALLE del domicilio comercial (sin número) — casilla "Calle".

| Reconoce | Patrón exacto |
| --- | --- |
| calle( y numero)? | `^calle(?: y numero)?$` |
| nombre de (la )?calle | `^nombre de (?:la )?calle$` |
| avenida/calle | `^avenida\/calle$` |

### `direccion_oficina` — Solo la OFICINA/DEPARTAMENTO del domicilio comercial (sin calle ni número) — casilla "Of.", "Oficina", "Dpto.", "Depto.".

| Reconoce | Patrón exacto |
| --- | --- |
| (dpto|depto|departamento) / (of|ofic|oficina) | `^(?:dpto|depto|departamento)\s*\/\s*(?:of|ofic|oficina)$` |
| (of|ofic|oficina) / (dpto|depto|departamento) | `^(?:of|ofic|oficina)\s*\/\s*(?:dpto|depto|departamento)$` |
| oficina | `^oficina$` |
| (dpto|depto|departamento) | `^(?:dpto|depto|departamento)$` |
| of | `^of$` |
| n[°º]? (de )?oficina | `^n[°º]?\s*(?:de\s+)?oficina$` |

### `direccion_numero` — Solo el NÚMERO/N° del domicilio comercial (sin el nombre de la calle) — casilla "N°"/"Número".

| Reconoce | Patrón exacto |
| --- | --- |
| n[°º] | `^n[°º]$` |
| numero | `^numero$` |
| nro | `^nro$` |
| numero de (la )?(calle|direccion|domicilio) | `^numero de (?:la )?(?:calle|direccion|domicilio)$` |

### `comuna` — Comuna del domicilio comercial — casilla "Comuna".

| Reconoce | Patrón exacto |
| --- | --- |
| comuna | `^comuna$` |
| comuna( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^comuna(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |

### `ciudad` — Ciudad del domicilio comercial — casilla "Ciudad".

| Reconoce | Patrón exacto |
| --- | --- |
| ciudad | `^ciudad$` |
| ciudad( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))? | `^ciudad(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?$` |
| localidad | `^localidad$` |

### `region` — Región CON la comuna al final, ej. "Región del Bío Bío, Concepción" — úsalo SOLO si la casilla junta "Región y comuna" o "Ciudad, Región" en una sola casilla. Si la casilla pide solo "Comuna" o solo "Ciudad", usa esos campos, no este.

| Reconoce | Patrón exacto |
| --- | --- |
| region | `^region$` |
| region y comuna | `^region y comuna$` |
| comuna y region | `^comuna y region$` |
| ciudad y region | `^ciudad y region$` |
| region/comuna | `^region\/comuna$` |

### `telefono1` — Teléfono de la empresa

| Reconoce | Patrón exacto |
| --- | --- |
| (telefono|fono|celular|movil)(s)?( (de contacto|comercial|fijo))?( (principal(es)?|alternativos?|secundarios?)( y (el )?(alternativos?|secundarios?|principal(es)?))?)?(( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?|( (del? |de la )?(representan?te( legal)?|rep legal|apoderado|declarante|firmante|suscriptor))|( (del? |de la )?(contacto|persona de contacto)))?( (principal(es)?|alternativos?|secundarios?)( y (el )?(alternativos?|secundarios?|principal(es)?))?)? | `^(?:telefono|fono|celular|movil)(?:s)?(?:\s+(?:de\s+contacto|comercial|fijo))?(?:\s+(?:principal(?:es)?|alternativos?|secundarios?)(?:\s+y\s+(?:el\s+)?(?:alternativos?|secundarios?|principal(?:es)?))?)?(?:(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?|(?:\s+(?:del?\s+|de\s+la\s+)?(?:representan?te(?:\s+legal)?|rep\s+legal|apoderado|declarante|firmante|suscriptor))|(?:\s+(?:del?\s+|de\s+la\s+)?(?:contacto|persona\s+de\s+contacto)))?(?:\s+(?:principal(?:es)?|alternativos?|secundarios?)(?:\s+y\s+(?:el\s+)?(?:alternativos?|secundarios?|principal(?:es)?))?)?$` |
| telefono/celular | `^telefono\/celular$` |
| fono contacto | `^fono contacto$` |
| numero de (telefono|contacto) | `^numero de (?:telefono|contacto)$` |
| n[°º]? de telefono | `^n[°º]? de telefono$` |
| telefono fijo y celular | `^telefono fijo y celular$` |
| telefono( fijo)?/celular | `^telefono(?: fijo)?\/celular$` |
| fono fijo y movil | `^fono fijo y movil$` |
| telefono /? fax | `^telefono\s*\/?\s*fax$` |
| fono /? fax | `^fono\s*\/?\s*fax$` |
| n[°º]? telefono | `^n[°º]?\s*telefono$` |
| n[°º]? (de )?fono | `^n[°º]?\s*(?:de\s+)?fono$` |

### `email1` — Correo electrónico de la empresa

| Reconoce | Patrón exacto |
| --- | --- |
| (correo|correo electronico|e[s-]*mail|mail|casilla electronica)( de contacto)?( (principal(es)?|alternativos?|secundarios?)( y (el )?(alternativos?|secundarios?|principal(es)?))?)?(( (del? |de la )?(empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?|( (del? |de la )?(representan?te( legal)?|rep legal|apoderado|declarante|firmante|suscriptor))|( (del? |de la )?(contacto|persona de contacto)))?( (principal(es)?|alternativos?|secundarios?)( y (el )?(alternativos?|secundarios?|principal(es)?))?)? | `^(?:correo|correo\s+electronico|e[\s-]*mail|mail|casilla\s+electronica)(?:\s+de\s+contacto)?(?:\s+(?:principal(?:es)?|alternativos?|secundarios?)(?:\s+y\s+(?:el\s+)?(?:alternativos?|secundarios?|principal(?:es)?))?)?(?:(?:\s+(?:del?\s+|de\s+la\s+)?(?:empresa|oferente|proponente|participante|postulante|contribuyente|prestador|proveedor))?|(?:\s+(?:del?\s+|de\s+la\s+)?(?:representan?te(?:\s+legal)?|rep\s+legal|apoderado|declarante|firmante|suscriptor))|(?:\s+(?:del?\s+|de\s+la\s+)?(?:contacto|persona\s+de\s+contacto)))?(?:\s+(?:principal(?:es)?|alternativos?|secundarios?)(?:\s+y\s+(?:el\s+)?(?:alternativos?|secundarios?|principal(?:es)?))?)?$` |
| correo electronico para (notificaciones|efectos de (esta )?licitacion) | `^correo electronico para (?:notificaciones|efectos de (?:esta )?licitacion)$` |

### `fecha_hoy` — Fecha con la que se firma y presenta esta oferta, en formato largo ("4 de agosto de 2026") — la fecha de CIERRE de esta licitación cuando se conoce (política de la empresa), si no la fecha real de hoy

| Reconoce | Patrón exacto |
| --- | --- |
| fecha | `^fecha$` |
| fecha de (la )?(oferta|presentacion|propuesta|declaracion) | `^fecha de (?:la )?(?:oferta|presentacion|propuesta|declaracion)$` |

### `tipo_persona_juridica` — Tipo de persona jurídica

| Reconoce | Patrón exacto |
| --- | --- |
| tipo de (persona|sociedad|empresa)( juridica)? | `^tipo de (?:persona|sociedad|empresa)(?: juridica)?$` |
| naturaleza juridica | `^naturaleza juridica$` |

### `nacionalidad` — Nacionalidad del oferente / del representante legal. Política fija de la empresa: siempre "Chilena".

| Reconoce | Patrón exacto |
| --- | --- |
| nacionalidad | `^nacionalidad$` |
| nacionalidad del? (oferente|proponente|representante( legal)?|declarante|empresa|suscrito) | `^nacionalidad del? (?:oferente|proponente|representante(?: legal)?|declarante|empresa|suscrito)$` |
| pais de origen | `^pais de origen$` |

### `fecha_escritura` — Fecha de la escritura de constitución (solo la fecha)

| Reconoce | Patrón exacto |
| --- | --- |
| fecha (de (la )?)?escritura( publica)?( de constitucion)? | `^fecha (?:de (?:la )?)?escritura(?: publica)?(?: de constitucion)?$` |
| fecha de constitucion( de la (empresa|sociedad))? | `^fecha de constitucion(?: de la (?:empresa|sociedad))?$` |
| fecha de la constitucion | `^fecha de la constitucion$` |

### `fecha_sociedad` — Fecha/tipo/notaría de constitución (texto libre, todo junto)

| Reconoce | Patrón exacto |
| --- | --- |
| (datos de )?(la )?constitucion( de la sociedad)? | `^(?:datos de )?(?:la )?constitucion(?: de la sociedad)?$` |
| antecedentes de constitucion | `^antecedentes de constitucion$` |

### `notaria` — Notaría donde se firmó la escritura

| Reconoce | Patrón exacto |
| --- | --- |
| notaria | `^notaria$` |
| notario | `^notario$` |
| notaria (en que se firmo|de) | `^notaria (?:en que se firmo|de)$` |

### `numero_repertorio` — Número de repertorio de la escritura

| Reconoce | Patrón exacto |
| --- | --- |
| (numero de )?repertorio( n[°º]?)? | `^(?:numero de )?repertorio(?: n[°º]?)?$` |

### `fojas_numero_anio` — Fojas/Número/Año de inscripción de la escritura

| Reconoce | Patrón exacto |
| --- | --- |
| fojas( numero)?( anio)? | `^fojas(?: numero)?(?: anio)?$` |
| inscripcion (de )?(fojas|comercio) | `^inscripcion (?:de )?(?:fojas|comercio)$` |

### `representante_nombre` — Nombre completo del representante legal (nombres + apellidos juntos) — úsalo SOLO si la casilla pide "Nombre completo"/"Nombre" en UNA sola casilla. Si la casilla dice "Nombres" y "Apellidos" por separado, usa los campos específicos de abajo, nunca este entero.

| Reconoce | Patrón exacto |
| --- | --- |
| nombre( completo)?( (del? |de la )?(representan?te( legal)?|rep legal|apoderado|declarante|firmante|suscriptor)) | `^nombre(?:\s+completo)?(?:\s+(?:del?\s+|de\s+la\s+)?(?:representan?te(?:\s+legal)?|rep\s+legal|apoderado|declarante|firmante|suscriptor))$` |
| (representan?te legal|apoderado) | `^(?:representan?te\s+legal|apoderado)$` |
| nombre y apellidos? del representante( legal)? | `^nombre y apellidos? del representante(?: legal)?$` |
| (identificacion|individualizacion) del (representante( legal)?|apoderado) | `^(?:identificacion|individualizacion) del (?:representante(?: legal)?|apoderado)$` |
| representante legal de la empresa | `^representante legal de la empresa$` |
| nombre del firmante | `^nombre del firmante$` |
| quien suscribe | `^quien suscribe$` |
| nombre (del? )?contacto | `^nombre (?:del? )?contacto$` |
| persona de contacto | `^persona de contacto$` |
| nombre de la persona de contacto | `^nombre de la persona de contacto$` |
| nombre y apellidos? del? contacto | `^nombre y apellidos? del? contacto$` |
| contacto (comercial )?nombre | `^contacto (?:comercial )?nombre$` |
| contacto (para|de) (la )?(licitacion|propuesta|oferta|este proceso) | `^contacto (?:para|de) (?:la )?(?:licitacion|propuesta|oferta|este proceso)$` |
| contacto (del? )?(la )?(empresa|oferente|proponente|proveedor) | `^contacto (?:del? )?(?:la )?(?:empresa|oferente|proponente|proveedor)$` |

### `representante_nombres` — Solo los NOMBRES (de pila) del representante legal, sin apellidos — casilla "Nombres".

| Reconoce | Patrón exacto |
| --- | --- |
| nombres | `^nombres$` |
| nombres? de pila | `^nombres? de pila$` |

### `representante_apellidos` — Solo los APELLIDOS del representante legal, sin nombres — casilla "Apellidos".

| Reconoce | Patrón exacto |
| --- | --- |
| apellidos | `^apellidos$` |
| apellido paterno y materno | `^apellido paterno y materno$` |

### `representante_rut` — RUT/cédula de identidad del representante legal

| Reconoce | Patrón exacto |
| --- | --- |
| (rut|r u t|run|cedula( de identidad)?|c i)( (del? |de la )?(representan?te( legal)?|rep legal|apoderado|declarante|firmante|suscriptor)) | `^(?:rut|r\s*u\s*t|run|cedula(?:\s+de\s+identidad)?|c\s*i)(?:\s+(?:del?\s+|de\s+la\s+)?(?:representan?te(?:\s+legal)?|rep\s+legal|apoderado|declarante|firmante|suscriptor))$` |
| cedula de identidad( n[°º]?)? | `^cedula de identidad(?: n[°º]?)?$` |
| c i n[°º]? | `^c i n[°º]?$` |
| run | `^run$` |
| numero de (cedula|run) | `^numero de (?:cedula|run)$` |
| rut representante | `^rut representante$` |
| (n[°º]? (de )?)?cedula (nacional )?de identidad( nacional)? | `^(?:n[°º]?\s*(?:de\s+)?)?cedula (?:nacional )?de identidad(?: nacional)?$` |
| rut (del? )?(socio|accionista)(/accionista)? | `^rut (?:del? )?(?:socio|accionista)(?:\/accionista)?$` |
| rut socio/accionista | `^rut socio\/accionista$` |

### `representante_profesion` — Profesión u oficio del representante legal (distinto de su cargo)

| Reconoce | Patrón exacto |
| --- | --- |
| (profesion|oficio|profesion u oficio|profesion o oficio)( (del? |de la )?(representan?te( legal)?|rep legal|apoderado|declarante|firmante|suscriptor)) | `^(?:profesion|oficio|profesion u oficio|profesion o oficio)(?:\s+(?:del?\s+|de\s+la\s+)?(?:representan?te(?:\s+legal)?|rep\s+legal|apoderado|declarante|firmante|suscriptor))$` |
| profesion | `^profesion$` |
| oficio | `^oficio$` |
| profesion u oficio | `^profesion u oficio$` |
| profesion o oficio | `^profesion o oficio$` |
| titulo profesional | `^titulo profesional$` |
| actividad o profesion | `^actividad o profesion$` |

### `representante_cargo` — Cargo del representante legal

| Reconoce | Patrón exacto |
| --- | --- |
| cargo( (del? |de la )?(representan?te( legal)?|rep legal|apoderado|declarante|firmante|suscriptor)) | `^cargo(?:\s+(?:del?\s+|de\s+la\s+)?(?:representan?te(?:\s+legal)?|rep\s+legal|apoderado|declarante|firmante|suscriptor))$` |
| cargo( o funcion| que desempena| en la empresa)? | `^cargo(?: o funcion| que desempena| en la empresa)?$` |
| calidad en que comparece | `^calidad en que comparece$` |

### `banco_nombre` — Nombre del banco

| Reconoce | Patrón exacto |
| --- | --- |
| (nombre del )?banco | `^(?:nombre del )?banco$` |
| institucion (bancaria|financiera) | `^institucion (?:bancaria|financiera)$` |

### `banco_tipo_cuenta` — Tipo de cuenta bancaria

| Reconoce | Patrón exacto |
| --- | --- |
| tipo de cuenta | `^tipo de cuenta$` |
| cuenta (corriente/vista|tipo) | `^cuenta (?:corriente\/vista|tipo)$` |

### `banco_numero` — Número de cuenta bancaria

| Reconoce | Patrón exacto |
| --- | --- |
| n[°º] de cuenta | `^n[°º] de cuenta$` |
| numero de cuenta | `^numero de cuenta$` |
| cuenta n[°º]? | `^cuenta n[°º]?$` |
| cuenta bancaria | `^cuenta bancaria$` |

### `banco_email` — Correo electrónico para pagos

| Reconoce | Patrón exacto |
| --- | --- |
| correo( electronico)? para (pagos|aviso de pago|transferencias) | `^correo(?: electronico)? para (?:pagos|aviso de pago|transferencias)$` |

### `banco_titular_nombre` — Nombre del titular de la cuenta bancaria (puede ser distinto de la razón social) — dentro de un bloque "DATOS BANCARIOS PARA TRANSFERENCIA", la casilla suele decir simplemente "NOMBRE TITULAR" o "TITULAR" sin la palabra "cuenta" ni "banco" al lado — igual es este campo.

| Reconoce | Patrón exacto |
| --- | --- |
| (nombre del )?titular( de la cuenta)? | `^(?:nombre del )?titular(?: de la cuenta)?$` |

### `banco_titular_rut` — RUT/cédula de identidad del titular de la cuenta bancaria — mismo criterio: dentro de "DATOS BANCARIOS" la casilla puede decir solo "RUT TITULAR" o "RUT".

| Reconoce | Patrón exacto |
| --- | --- |
| rut del titular( de la cuenta)? | `^rut del titular(?: de la cuenta)?$` |

### `licitacion_codigo` — Código/ID de ESTA licitación en Mercado Público

| Reconoce | Patrón exacto |
| --- | --- |
| (id|codigo|n[°º]|numero)( de( la)?)? (licitacion|adquisicion|proceso|propuesta)( publica)? | `^(?:id|codigo|n[°º]|numero)(?: de(?: la)?)? (?:licitacion|adquisicion|proceso|propuesta)(?: publica)?$` |
| id( de)? mercado publico | `^id(?: de)? mercado publico$` |
| licitacion (id|n[°º]|numero) | `^licitacion (?:id|n[°º]|numero)$` |
| id | `^id$` |

### `licitacion_nombre` — Nombre/título de ESTA licitación

| Reconoce | Patrón exacto |
| --- | --- |
| nombre( de( la)?)? licitacion( publica)? | `^nombre(?: de(?: la)?)? licitacion(?: publica)?$` |
| licitacion publica | `^licitacion publica$` |
| nombre del (proceso|proyecto|servicio licitado) | `^nombre del (?:proceso|proyecto|servicio licitado)$` |
| denominacion de la licitacion | `^denominacion de la licitacion$` |

### `licitacion_organismo` — Nombre del organismo comprador (la institución que licita, no el oferente)

| Reconoce | Patrón exacto |
| --- | --- |
| (nombre del )?organismo( comprador| licitante| demandante)? | `^(?:nombre del )?organismo(?: comprador| licitante| demandante)?$` |
| (entidad|institucion|servicio|municipalidad) licitante | `^(?:entidad|institucion|servicio|municipalidad) licitante$` |
| mandante | `^mandante$` |
| comprador | `^comprador$` |

### `licitacion_organismo_rut` — RUT del organismo comprador

| Reconoce | Patrón exacto |
| --- | --- |
| rut del? (organismo|entidad|institucion|mandante)( licitante| comprador)? | `^rut del? (?:organismo|entidad|institucion|mandante)(?: licitante| comprador)?$` |

### `licitacion_unidad_compradora` — Nombre de la unidad/departamento que compra dentro del organismo

| Reconoce | Patrón exacto |
| --- | --- |
| unidad( de)? compra(dora)? | `^unidad(?: de)? compra(?:dora)?$` |

### `socio_nombre` — Nombre del Socio/Accionista — por política de la empresa, el representante legal (socio único). Casilla "Nombre Socio/Accionista".

| Reconoce | Patrón exacto |
| --- | --- |
| nombre (del )?(socio|accionista)(/accionista)? | `^nombre (?:del )?(?:socio|accionista)(?:\/accionista)?$` |
| socio/accionista | `^socio\/accionista$` |
| socios? o accionistas? | `^socios? o accionistas?$` |

### `socio_participacion` — Porcentaje de Derechos o Participación del socio — siempre "100%" (socio único). Casilla "Porcentaje de Derechos"/"% de Participación".

| Reconoce | Patrón exacto |
| --- | --- |
| porcentaje de (derechos|participacion)( o participacion)? | `^porcentaje de (?:derechos|participacion)(?: o participacion)?$` |
| % de (participacion|derechos) | `^% de (?:participacion|derechos)$` |
| participacion( societaria| accionaria)? | `^participacion(?: societaria| accionaria)?$` |
| (%|porcentaje) de (participacion|derechos) en la sociedad | `^(?:%|porcentaje) de (?:participacion|derechos) en la sociedad$` |

## 2. Frase ANTES del blanco → dato de la ficha

Para los blancos que viven dentro de una oración ("…en representación de \_\_\_\_"). Se evalúan EN
ORDEN y manda la primera que calce.

| # | Reconoce (lo que va antes del blanco) | Dato |
| --- | --- | --- |
| 1 | en represent(acion|ación) (legal )?de( la)?( (empresa|sociedad|razon social))?( ([^)]{0,30}))? | `razon_social` |
| 2 | (para|por) (y en nombre de|cuenta de) | `razon_social` |
| 3 | mi representada ,? (es )?:? | `razon_social` |
| 4 | representar a :? | `razon_social` |
| 5 | la empresa que represento ,? (es )?:? | `razon_social` |
| 6 | nombre (completo )?(del? |de la )?representan?te( legal)? :? | `representante_nombre` |
| 7 | representan?te legal de( la)?( (empresa|sociedad))? | `razon_social` |
| 8 | yo,? | `representante_nombre` |
| 9 | nombres? y? apellidos? :? | `representante_nombre` |
| 10 | (don|dona|doña|sr|sra|senor|señor).?,? | `representante_nombre` |
| 11 | comparece | `representante_nombre` |
| 12 | (de )?nacionalidad :? | `nacionalidad` |
| 13 | nombre (completo )?(del )?(representante|apoderado|declarante)? :? | `representante_nombre` |
| 14 | (c(é|e)dula (nacional )?de identidad|c.? i.?|run) (n[°º.]*|numero|nro)? :? | `representante_rut` |
| 15 | (con )?domicili(o|ado) (en|para estos efectos en)?( (la )?(ciudad|comuna) de)? | `direccion` |
| 16 | direcci(o|ó)n :? | `direccion` |
| 17 | (don|do[ñn]a)[^.]{0,120}?, (r.? u.? t.?|rol (u|ú)nico tributario) (n[°º.]*|numero|nro)? :? | `representante_rut` |
| 18 | (r.? u.? t.?|rol (u|ú)nico tributario) (n[°º.]*|numero|nro)? :? | `rut` |
| 19 | giro :? | `giro` |
| 20 | (tel(e|é)fono|fono|celular) :? | `telefono1` |
| 21 | (correo( electr(o|ó)nico)?|e-?mail) :? | `email1` |
| 22 | cargo (de )? :? | `representante_cargo` |
| 23 | (licitaci(o|ó)n p(u|ú)blica|id (de )?mercado p(u|ú)blico|propuesta p(u|ú)blica) (n[°º.]*|id)? :? | `licitacion_codigo` |
| 24 | (denominada|individualizada como|cuyo nombre es) | `licitacion_nombre` |
| 25 | nombre (completo )?o raz(o|ó)n social( de( la)?)?( (empresa|sociedad))?( (participante|oferente|proponente|postulante))? :? | `razon_social` |
| 26 | (^|,) (la )?empresa ,? | `razon_social` |
| 27 | (don|do[ñn]a|sr|sra) ( (do[ñn]a|[ñn]a|a|esa) ) .?,? | `representante_nombre` |
| 28 | (^|[.;·|t]|con) fecha :? | `fecha_hoy` |
| 29 | profesi(o|ó)n (u|o) oficio :? | `representante_profesion` |
| 30 | profesi(o|ó)n del? (representante( legal)?|apoderado|declarante) :? | `representante_profesion` |
| 31 | correo electr(o|ó)nico para (notificaciones|efectos de( esta)? licitaci(o|ó)n) [.:]? | `email1` |
| 32 | escritura p(u|ú)blica de fecha | `fecha_escritura` |

## 3. Texto DENTRO de un marcador → dato de la ficha

Para las plantillas que dejan el nombre del dato escrito en la casilla: `<Razón Social>`,
`[Insertar RUT]`, `{{razon_social}}`, `(nombre del representante legal)`.

| # | Reconoce (adentro del marcador) | Dato |
| --- | --- | --- |
| 1 | (rut|run) (n[°º.]? )?(de la |del |de )?(empresa|raz(o|ó)n social|sociedad|proponente|oferente|persona jur(i|í)dica) | `rut` |
| 2 | (rut|run|c(e|é)dula)[sS]{0,25}?(representante|apoderado|firmante|declarante) | `representante_rut` |
| 3 | nombre completo del representante|representante legal | `representante_nombre` |
| 4 | n(u|ú)mero de run|run|c(e|é)dula | `representante_rut` |
| 5 | nombre o raz(o|ó)n social|raz(o|ó)n social|nombre persona (natural|jur(i|í)dica) | `razon_social` |
| 6 | insertar rut|^ rut | `rut` |
| 7 | id de mercado p(u|ú)blico|id (de )?licitaci(o|ó)n | `licitacion_codigo` |
| 8 | nombre (de la )?licitaci(o|ó)n | `licitacion_nombre` |
| 9 | fecha | `fecha_hoy` |
| 10 | (d(i|í)a|dd?) [/-.] (mes|mm?) [/-.] (a(n|ñ)o|a{2,4}|yy(yy)?) | `fecha_hoy` |
| 11 | (domicilio|direcci(o|ó)n)[sS]{0,40}?(comuna|regi(o|ó)n|ciudad) | `direccion` |
| 12 | ciudad | `ciudad` |
| 13 | comuna | `comuna` |
| 14 | localidad | `licitacion_comuna` |
| 15 | domicilio|direcci(o|ó)n | `direccion` |
| 16 | giro | `giro` |

---

**Totales:** 39 datos distintos de la ficha · 166 patrones de etiqueta ·
32 reglas de frase previa · 16 reglas de marcador.