# Configuración de Supabase para Fijo

El esquema está en [`supabase/setup.sql`](./supabase/setup.sql). Cada usuario autenticado solo puede leer y modificar sus propias filas, protegidas por RLS.

1. Crea un proyecto Supabase dedicado a esta app.
2. Activa el registro de usuarios en Authentication > Providers > Email para que cada persona pueda crear su cuenta desde la app. Si la confirmación de correo está activa, cada persona deberá confirmar su dirección antes de iniciar sesión. Añade el dominio de la app (y localhost si desarrollas localmente) a Authentication > URL Configuration > Redirect URLs.
3. Ejecuta `supabase/setup.sql` en SQL Editor. Si ya tenías la app instalada, vuelve a ejecutar el archivo para crear el maestro privado de bancos y migrar los bancos existentes.
4. La app usará la URL del proyecto y su clave publicable. Nunca uses una clave `service_role` en el navegador.

Cada cuenta tiene su propia sesión, movimientos y maestro de bancos. RLS aísla los datos en Supabase; no se comparten ni siquiera si varias personas usan el mismo enlace de la app. El registro público permite que cualquier persona cree una cuenta independiente en el proyecto; desactívalo en Supabase si prefieres que el acceso lo gestione un administrador.

`user_banks` guarda los bancos de cada usuario. Santander, ING y Revolut se crean como bancos iniciales, junto con los bancos que ya aparezcan en movimientos existentes. Los bancos se pueden archivar y reactivar; archivarlos no borra el historial ni sus balances.

`fixed_expenses` representa los gastos recurrentes. `monthly_expenses` es el histórico mensual con copia del nombre, importe, día de vencimiento y estado de pago; así los cambios futuros no reescriben meses anteriores.

`income_transactions` guarda los ingresos con fecha y banco obligatorio. Su política RLS limita la lectura y modificación al usuario propietario, igual que las tablas de gastos.

`bank_transfers` guarda transferencias entre bancos propios como movimientos separados de ingresos y gastos. RLS restringe cada transferencia a su usuario propietario.

La conexión bancaria directa Tink no está habilitada para uso personal. La app permite importar extractos CSV: el archivo se interpreta localmente y solo se guardan los movimientos que confirmes en la vista previa. Las filas se insertan en `variable_expenses` bajo el usuario autenticado y las protege la política RLS existente.
