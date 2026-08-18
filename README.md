# Evaluación reproducible de un informe con GPT-5.6 Sol

Esta carpeta documenta una prueba fechada, pequeña y reproducible sobre cómo generar un borrador de informe verificable a partir de datos sintéticos en español neutro.

## Antes de interpretar resultados

- Lea `protocol.md` y `LIMITATIONS.md`.
- El CSV no contiene datos reales.
- El ground truth se calcula fuera del modelo.
- El prompt proporciona las fórmulas y grupos de evidencia; la prueba mide cálculo y cumplimiento del contrato, no su descubrimiento autónomo.
- `accepted` es un resultado automático. La publicación exige además el registro descrito en `editorial-review-protocol.md`.
- Tres repeticiones no son un benchmark general.
- El código usa MIT; datos, resultados, informes y gráficos usan CC BY 4.0.

## Recalcular sin API

1. `npm run build:ground-truth`
2. `npm test`
3. Tras una ejecución existente: `npm run verify:frozen`, `npm run evaluate`, complete `reviews/editorial-review.json`, ejecute `npm run verify:editorial-review`, y después `npm run report`, `npm run chart`, `npm run checksums`, `npm run verify`.

No ejecute `npm run run` sin un manifest congelado, un key temporal en memoria y una aprobación explícita del coste. El key nunca se publica.
