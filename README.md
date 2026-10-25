# Selector · app del móvil

App web instalable (PWA) que muestra el parte diario, las señales, las carteras
en papel y las posiciones del Selector, con notificaciones nativas.

Solo contiene la interfaz: **los datos no están aquí**. Los publica el escaneo
diario (repo privado `selector`, GitHub Actions) en un Firebase privado, y solo
la cuenta del dueño puede leerlos (reglas de Firestore).

- `assets/cloud.js` — acceso (correo + contraseña), lectura en tiempo real y suscripción a avisos.
- `assets/app.js` — pantallas: Hoy · Señales · Carteras · Posiciones · Ajustes.
- `sw.js` — funciona sin conexión y muestra las notificaciones. **Sube `CACHE` en cada despliegue.**
- `assets/vendor/` — SDK de Firebase 10.12.2 servido en local (CSP `script-src 'self'`).

Información, no recomendación.
