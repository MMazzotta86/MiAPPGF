# Fijo: gastos mensuales

App personal de gastos fijos mensuales y anuales con inicio de sesión y almacenamiento histórico en Supabase.

## Ejecutar localmente

1. Instala Node.js 20.6 o posterior.
2. Copia `.env.example` a `.env` y completa la URL y la clave publicable del proyecto.
3. Ejecuta `npm install` y después `npm start`.
4. Abre `http://localhost:5173`.

No subas `.env`. La clave `sb_publishable_...` es apta para el cliente siempre que las tablas mantengan RLS activado; nunca uses `service_role` o una clave secreta en el navegador.

## Cuenta e historial

Crea tu cuenta desde Supabase Dashboard > Authentication > Users y desactiva el registro público al terminar. La app inicia sesión con email y contraseña. Al abrir cada mes, guarda una copia de los gastos activos en `monthly_expenses`; los cambios a una plantilla no reescriben meses anteriores. Las tablas ya existentes en tu proyecto son `fixed_expenses` y `monthly_expenses`.

La conexión bancaria Tink se retiró del flujo porque no está habilitada para este uso personal. No se solicitan ni guardan credenciales bancarias.

## Gastos anuales

Al añadir un gasto, selecciona la frecuencia **Anual**, indica el importe total que pagas en el año y el mes y día del cobro. El gasto aparecerá únicamente en ese mes y se guardará como un recibo anual en el historial. La base de datos distingue frecuencia y mes de vencimiento en las plantillas y en las copias mensuales.

## Uso desde el móvil

La interfaz se adapta a pantallas pequeñas y la app incluye un manifiesto y service worker para instalarla como PWA. Para abrirla en tu teléfono y añadirla a la pantalla de inicio, primero hay que publicarla en un dominio HTTPS; `npm start` solo sirve la app en este ordenador. En Android, abre la web con Chrome y elige **Instalar aplicación**. En iPhone, abre la web con Safari y usa **Compartir > Añadir a pantalla de inicio**. Los gastos se consultan en Supabase, así que se necesita conexión a Internet.

## Publicar

El proyecto se compila con `npm run build` y genera el sitio estático en `dist/`. En el proveedor de alojamiento configura el comando de compilación `npm run build`, el directorio `dist` y estas variables de entorno: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. La clave publicable se incluye en el cliente por diseño; mantén las políticas RLS activas y no añadas claves `service_role`.
