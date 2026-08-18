# Tarea congelada: informe ejecutivo verificable

Prepara un **borrador estructurado**, sujeto a revisión humana, para la dirección de operaciones de Comercio Faro. El periodo es abril-junio de 2026 y la moneda es USD. Usa únicamente el dataset sintético y su diccionario incluidos al final. No uses conocimiento externo, herramientas, navegación ni fuentes inventadas.

## Reglas de cálculo

1. `net_revenue = gross_revenue_usd - discounts_usd - refunds_usd`.
2. `conversion_pct = orders / sessions * 100`.
3. `net_aov_usd = net_revenue / orders`.
4. `discount_rate_pct = discounts_usd / gross_revenue_usd * 100`.
5. `refund_rate_pct = refunds_usd / gross_revenue_usd * 100`.
6. `sla_resolution_pct = resolved_within_sla / support_cases * 100`.
7. `weighted_delivery_days = delivery_days_total / orders`.
8. `aggregate_nps = (promoters - detractors) / nps_responses * 100`.
9. `conversion_change_apr_to_jun_pp = conversion_pct_junio - conversion_pct_abril` en puntos porcentuales, no como variación relativa.
10. Para el canal paid, `paid_roas_net = paid_net_revenue_usd / paid_ad_spend_usd`.

Calcula con precisión completa y redondea solo el valor final. Redondea numéricamente porcentajes, días, NPS, AOV, ratios e importes agregados en USD a dos decimales; JSON no necesita conservar ceros finales. En cada hecho incluye el numerador y denominador numéricos que utilizaste. Para `total_net_revenue_usd` y `paid_net_revenue_usd`, usa denominador 1. Para `conversion_change_apr_to_jun_pp`, usa como numerador la conversión de junio y como denominador la conversión de abril, ambas ya expresadas en porcentaje y redondeadas a dos decimales. Para `paid_ad_spend_usd`, usa denominador 1.

## Contrato editorial

- Incluye exactamente una entrada para cada uno de los 12 `metric_id` admitidos por el esquema.
- En los ocho indicadores agregados de todo el periodo usa F001-F018. En `conversion_change_apr_to_jun_pp` usa las seis filas de abril y las seis de junio. En los tres indicadores del canal paid usa exactamente F002, F004, F006, F008, F010, F012, F014, F016 y F018.
- No llames beneficio, margen o rentabilidad a los ingresos netos; no hay costes operativos ni coste de producto.
- No atribuyas causas. Una coincidencia temporal o por segmento no demuestra causalidad.
- Separa hechos, interpretaciones e hipótesis de actuación.
- Toda interpretación y recomendación debe declarar entre uno y tres `metric_ids`. Sus `evidence_ids` deben ser exactamente la unión, sin duplicados, de los identificadores exigidos por esos indicadores: F001-F018 para los indicadores agregados; las seis filas de abril y las seis de junio para `conversion_change_apr_to_jun_pp`; y las nueve filas paid para los tres indicadores paid.
- Presenta cada recomendación como una hipótesis que debe probarse y añade una métrica de éxito.
- En `missing_data` incluye exactamente estas cuatro cadenas, sin añadir otras: `Margen o coste de producto`, `Inventario disponible`, `Cohortes o clientes repetidos`, `Grupo de control o diseño causal`.
- Si mencionas beneficio o causalidad en un texto narrativo, expresa el límite de forma inequívoca. Se aceptan, entre otras, fórmulas como `no se puede determinar`, `no permite determinar`, `no explica`, `no hay base para afirmar` o `datos insuficientes para calcular`; nunca afirmes beneficio o causalidad como hechos.
- En `limitations` incluye exactamente estas cinco cadenas, sin reescribirlas ni añadir otras: `Todos los datos son sintéticos y no representan una empresa real.`, `El periodo de tres meses es corto para generalizar tendencias.`, `El NPS usa su propia muestra de respuestas y no todos los pedidos.`, `No se puede determinar beneficio, margen, utilidad, lucro ni rentabilidad con este conjunto de datos.`, `No se puede atribuir causalidad con este conjunto de datos; cualquier explicación es una hipótesis que requiere un diseño causal.`
- El registro de fuentes debe contener F001-F018 una sola vez cada uno. Para cada identificador `Fnnn`, usa exactamente la descripción `Fila sintética N del archivo CSV congelado`, donde N es el número decimal sin ceros iniciales (por ejemplo, F001 usa `Fila sintética 1 del archivo CSV congelado`).
- Español neutro. No incluyas enlaces, nombres de personas, datos personales, secretos, precios del proveedor ni afirmaciones sobre otros modelos.

## Dataset sintético

El contenido de `data/cg-report-synthetic-v2.csv` y `data/data-dictionary.json` se incorpora literalmente al request por el ejecutor antes de enviar la solicitud.
