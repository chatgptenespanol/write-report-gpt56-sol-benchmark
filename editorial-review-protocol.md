# Revisión editorial humana obligatoria

Esta revisión ocurre después de recibir las salidas y antes de publicar el artículo. No modifica las reglas automáticas ni convierte una salida fallida en aprobada.

## Alcance por repetición

Un revisor lee la salida completa y registra `pass`, `fail` o `not_testable` para cada punto:

1. No presenta ingresos netos como beneficio, margen, utilidad, lucro o rentabilidad.
2. No atribuye causalidad a canal, mercado, descuento, soporte u otra variable observada.
3. Distingue hechos calculados, interpretaciones e hipótesis de actuación.
4. Cada interpretación narrativa es compatible con los `metric_ids` declarados y no contradice las filas citadas.
5. Cada recomendación se presenta como hipótesis comprobable, no como resultado demostrado.
6. No añade hechos, marcas, enlaces, personas, secretos ni datos personales ajenos al dataset sintético.
7. El español es neutro y comprensible para públicos de distintos países hispanohablantes.

## Registro público

El resultado se guarda por repetición con fecha UTC, nombre del revisor humano, tipo `site_owner` o `external_human`, la atestación booleana `human_attestation=true`, decisión por punto, observaciones y hash SHA-256 de la salida revisada. Una segunda persona solo se declara si realmente revisa y firma su propio registro. Una salida no puede citarse como editorialmente aprobada si algún punto falla o si falta el registro o la atestación humana.

La revisión humana es cualitativa y no totalmente reproducible. La evidencia automática, las salidas raw y los hashes permiten que terceros repitan su propia revisión.
