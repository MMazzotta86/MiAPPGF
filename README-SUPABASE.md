# Configuración de Supabase para Fijo

El esquema inicial está en [`supabase/setup.sql`](./supabase/setup.sql). Está pensado para una cuenta personal: activa RLS y cada usuario autenticado solo puede leer y modificar sus filas.

1. Crea un proyecto Supabase dedicado a esta app.
2. Crea tu usuario en Authentication y desactiva el registro público cuando termines.
3. Ejecuta `supabase/setup.sql` en SQL Editor.
4. La app usará la URL del proyecto y su clave publicable. Nunca uses una clave `service_role` en el navegador.

`fixed_expenses` representa los gastos recurrentes. `monthly_expenses` es el histórico mensual con copia del nombre, importe, día de vencimiento y estado de pago; así los cambios futuros no reescriben meses anteriores.

La conexión bancaria directa Tink no está habilitada para uso personal. La app permite importar extractos CSV: el archivo se interpreta localmente y solo se guardan los movimientos que confirmes en la vista previa. Las filas se insertan en `variable_expenses` bajo el usuario autenticado y las protege la política RLS existente.
