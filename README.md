# Game Rotator Command Center

PWA mobile-first para rotar videojuegos, registrar sesiones, manejar backlog y sincronizar todo con Firebase Auth + Firestore.

## Qué cambió

- Firebase Auth con Google, restringido a `alekcaballeromusic@gmail.com`.
- Firestore por usuario en `users/{uid}`.
- Regla nueva: máximo 2 juegos `main` por consola.
- Juegos `curiosity` cuentan en estadísticas, pero no entran al rotador automático salvo que los incluyas manualmente.
- Navegación inferior mobile-first: Hoy, Juegos, Rotador, Stats y Ajustes.
- Modo curioso.
- Migración desde `localStorage` viejo con clave `rotator_v1`.
- Exportar/importar backup JSON.
- PWA con service worker y manifest.

## Configuración en Firebase

1. En Firebase Console, activa Authentication > Sign-in method > Google.
2. En Authentication > Settings > Authorized domains, agrega el dominio donde publicarás la app:
   - `localhost` para pruebas locales.
   - Tu dominio de GitHub Pages, por ejemplo `alekcaballero.github.io`.
3. En Firestore Database, crea la base de datos.
4. Publica estas reglas desde `firestore.rules`:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner() {
      return request.auth != null
        && request.auth.token.email == "alekcaballeromusic@gmail.com"
        && request.auth.token.email_verified == true;
    }

    match /users/{userId}/{document=**} {
      allow read, write: if isOwner() && request.auth.uid == userId;
    }
  }
}
```

## Probar localmente

Usa un servidor local, no abras el HTML como archivo suelto:

```bash
python -m http.server 5500
```

Luego abre:

```txt
http://localhost:5500
```

## Estructura Firestore

```txt
users/{uid}/consoles/{consoleId}
users/{uid}/games/{gameId}
users/{uid}/sessions/{sessionId}
users/{uid}/dailyPlans/{yyyy-MM-dd}
```

## Categorías

- `main`: entra al rotador con prioridad alta, máximo 2 por consola.
- `secondary`: puede entrar al rotador si `allowInRotation` está activo.
- `curiosity`: cuenta en estadísticas, pero no entra al rotador automático por defecto.
- `paused`: no entra al rotador.
- `completed`: no entra al rotador.
- `wishlist`: no entra al rotador ni como jugado.

## Archivos importantes

- `app.js`: orquestación general.
- `firebase/`: configuración, auth y Firestore.
- `services/`: lógica de consolas, juegos, sesiones, rotación, stats y migración.
- `ui/`: modales, navegación y charts.
- `utils/`: fechas, formatos y constantes.
- `firestore.rules`: reglas de seguridad.
