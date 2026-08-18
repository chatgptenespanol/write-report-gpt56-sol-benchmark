# Protocolo congelado antes de ejecutar

## Objetivo

Medir si tres respuestas independientes de `gpt-5.6-sol` pueden transformar el dataset sintético `cg-report-synthetic-v2` en un informe estructurado que conserve cálculos, unidades, evidencia y límites. El resultado no evalúa la aplicación ChatGPT ni demuestra rendimiento general.

## Diseño

- Fecha prevista: 18 de agosto de 2026 (UTC).
- Endpoint: Responses API.
- Modelo explícito: `gpt-5.6-sol`.
- Tres solicitudes secuenciales con el mismo cuerpo; una sola tentativa por repetición.
- `reasoning.effort=medium`, `reasoning.context=current_turn`, `text.verbosity=medium`.
- `service_tier=default` explícito; una respuesta que declare otra capa se trata como fallo terminal para proteger el límite de coste estándar.
- `store=false`, `stream=false`, `tools=[]`, sin navegación, archivos alojados ni conversación previa.
- Structured Outputs estricto según `benchmark/output.schema.json`.
- Máximo 6000 output tokens por solicitud.
- Timeout de 600 segundos; un timeout o error es terminal y no genera retry.

## Datos y verdad de referencia

Los 18 registros son ficticios. `src/build-ground-truth.mjs` recalcula los 12 indicadores desde el CSV. Se calcula con precisión completa y se redondea el resultado final a dos decimales. El ground truth no se envía al modelo.

El prompt sí entrega las fórmulas y los grupos de evidencia que deben usarse. Por ello, la prueba mide cálculo y cumplimiento de un contrato de trazabilidad proporcionado; no mide descubrimiento independiente de fórmulas ni selección autónoma de fuentes.

## Evaluación automática

Cada repetición ocupa 18 posiciones: una puerta estructural y 17 reglas. Si la salida no es evaluable, la puerta falla y las 17 reglas restantes quedan `not_run`; no se reduce el denominador. Una salida solo se considera aceptada si las 18 reglas pasan.

Las reglas comprueban inventario, valores, unidades, numeradores, denominadores, evidencia, registro de fuentes, recomendaciones, incertidumbre, presencia literal de límites económicos y causales, datos ausentes, limitaciones, alcance, privacidad y límites de interpretación. Las fórmulas y valores de referencia se recalculan localmente desde el CSV; no se puntúa una fórmula de texto generada por el modelo.

`accepted` significa únicamente que las 18 comprobaciones automáticas pasaron. No significa aprobación editorial ni demuestra que toda frase esté libre de una contradicción semántica. Las tres salidas deben someterse a la revisión humana y quedar registradas según `editorial-review-protocol.md`, incluso si fallan o no son evaluables. Solo una salida con `accepted=true` y revisión editorial `pass` puede describirse como aprobada; los fallos se publican como tales.

## Coste

La reserva usa un límite deliberadamente conservador: trata cada byte UTF-8 del request serializado como si fuera un token de escritura de caché y reserva además 6000 output tokens. Los bytes y el máximo exactos se fijan en `benchmark/price-snapshot.json` después de la última edición y antes de congelar. El runner se detiene antes de la red si las tres reservas superan 0,75 USD.

## Evidencia y fallos

Antes de cada llamada se escribe un intent exclusivo y persistente. No se sobrescribe evidencia. Una interrupción tras el intent se registra como coste desconocido y no se reintenta. Los identificadores del proveedor y las cabeceras de cuenta no forman parte de la evidencia pública. Una salida que active el detector de secretos o datos personales se pone en cuarentena lógica y no se publica como raw output.

## Interpretación

Las cifras finales describen únicamente esta combinación de dataset, prompt, modelo, parámetros y fecha. La revisión humana puede comentar utilidad o claridad en un archivo separado, pero no cambia las reglas ni el resultado automático.
