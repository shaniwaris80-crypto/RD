# Central Envíos RD Cloud — V11

Aplicación web sincronizada para gestionar recogidas en Burgos y entrega logística en Madrid.

## Incluye

- Firebase Authentication con sesión persistente.
- Cloud Firestore en tiempo real y caché offline.
- Inicialización automática del primer administrador, ajustes y semana activa.
- Numeración semanal segura `BUR-001`, `BUR-002` mediante transacciones.
- Albaranes con remitentes, destinatarios frecuentes, cajas, ofertas y cobros.
- Control individual de bultos.
- PDF individual profesional sin QR.
- PDF semanal y reporte de carga/descarga para Madrid.
- WhatsApp y SMS preparados.
- Cierre semanal y reinicio automático a `BUR-001`.
- Panel administrativo con tarifas, costes, beneficios y roles.
- PWA instalable.

## Firebase ya configurado

El proyecto usa:

- Project ID: `central-envios-rd`
- Auth domain: `central-envios-rd.firebaseapp.com`

La configuración pública está en `public/js/firebase-config.js`.

## Paso 1 — Firebase Console

1. Authentication → Método de acceso → activa **Correo/contraseña**.
2. Firestore Database → crea la base en **modo producción**.
3. En Firestore → Reglas, puedes pegar `firestore.rules`, o desplegarlas con Firebase CLI.
4. En Authentication debe existir el usuario administrador con correo `shaniwaris80@gmail.com`.
5. No hace falta crear manualmente `users`, `settings` ni `weeks`: la app lo hace la primera vez que entra el administrador.

## Paso 2 — Instalar y probar

```bash
npm install
npx firebase login
npx firebase use central-envios-rd
npx firebase emulators:start --only hosting,firestore
```

También puedes probar solo el frontend con un servidor local. No abras `index.html` directamente como archivo, porque Firebase necesita que la web se sirva por HTTP/HTTPS.

## Paso 3 — Publicar

```bash
npm run deploy
```

La URL será normalmente:

- `https://central-envios-rd.web.app`
- `https://central-envios-rd.firebaseapp.com`

## Subir a GitHub

```bash
git init
git add .
git commit -m "Central Envíos RD Cloud V11"
git branch -M main
git remote add origin URL_DE_TU_REPOSITORIO.git
git push -u origin main
```

## GitHub Pages

La aplicación puede alojarse en GitHub Pages, pero debes añadir el dominio de GitHub Pages en:

Firebase Console → Authentication → Settings → Authorized domains.

Firebase Hosting es la opción recomendada porque ya está configurado en este proyecto.

## Roles

- `admin`: acceso completo y datos económicos.
- `collector`: clientes, beneficiarios y albaranes.
- `madrid`: estados y cierre de Madrid.

El primer administrador se crea automáticamente únicamente para `shaniwaris80@gmail.com`. Para otros usuarios:

1. Créalo en Firebase Authentication.
2. Copia su UID.
3. Entra en Administración dentro de la app y asigna UID, correo, nombre y rol.

## Trabajo sin conexión

Firestore mantiene una caché en Chrome, Safari y Firefox. Los albaranes nuevos creados sin conexión quedan como `PENDIENTE`; al recuperar Internet, la app asigna automáticamente un número oficial mediante una transacción, evitando duplicados entre dispositivos.

Las ediciones que cambian cantidades requieren conexión para poder recalcular correctamente los contadores semanales.

## Seguridad

- No se guarda ninguna contraseña en el repositorio.
- La clave web de Firebase es pública por diseño.
- La protección depende de Authentication y `firestore.rules`.
- No uses una clave de servicio o Admin SDK dentro del navegador.

## Actualizaciones

Al cambiar archivos de la PWA, incrementa el nombre de la caché en `public/sw.js` para forzar la actualización en dispositivos instalados.
