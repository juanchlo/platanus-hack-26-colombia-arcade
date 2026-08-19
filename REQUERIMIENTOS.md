# Documento de Requerimientos y Guía de Desarrollo: San Antonio Drift

Este documento contiene los requerimientos detallados para la IA de desarrollo. El objetivo es construir el juego arcade "San Antonio Drift" respetando estrictamente todas las reglas del Platanus Hack 26: Arcade Challenge.

## 1. Idea Principal del Juego
Carrera de obstáculos infinita inspirada en "Club Penguin carrera de trineos" y "Ski Power Pamplona". 
- **Ambientación:** Tradición de Cali, Valle del Cauca, Barrio San Antonio.
- **Acción:** Los personajes bajan una colina de asfalto sentados en canastas de cervezas.
- **Flujo:** La velocidad de descenso va aumentando a lo largo del tiempo.
- **Condición de victoria:** No existe una meta física. Gana el jugador que permanezca en la pantalla. Los jugadores pueden perder si se chocan demasiado (ralentizándose y quedando atrás hasta salir de la pantalla por arriba) o si caen al vacío/fuera del mapa.

## 2. Requerimientos Técnicos Críticos (Reglas del Reto)
- **Framework:** JavaScript puro usando Phaser 3 (v3.87.0).
- **Archivos a editar:** ÚNICAMENTE `game.js`, `metadata.json`, y `cover.png` (800x600 px, max 500 KB).
- **Límite de tamaño:** El código en `game.js` NO debe pesar más de **50 kB** después de minificar (antes de gzip).
- **Generación de Assets:** Todos los assets (visuales y sonoros) deben ser generados **por código**.
  - Gráficos: Procedimentales usando Phaser Graphics API (canvas).
  - Audio: API Web Audio de JavaScript (Osciladores).
  - *No se permiten assets externos, imágenes cargadas por URL, ni fetch.*
- **Restricciones de Código:** No se permite usar `import` ni `require`. No llamadas a red (sandboxed iframe).
- **Jugadores:** 2 Jugadores simultáneos (`player_mode: "two_player"` en metadata).
- **Vista:** Isométrica / Pseudo-3D (2.5D) con scroll continuo.
- **Controles:** Usar EXCLUSIVAMENTE los códigos arcade (`P1_U`, `P1_1`, `START1`, `P2_L`, etc.) mapeados a las acciones. No usar teclas crudas.
- **Almacenamiento:** Usar `window.platanusArcadeStorage` si se requiere guardar algún récord de victorias o tiempos.
- **Contexto del equipo y tiempo:** Diseñado para ser desarrollado por 3 personas en un lapso de 12 horas.

## 3. Mecánicas de Juego Obligatorias
- **Salto Variable:**
  - Obstáculo pequeño (Hueco en la calle): Requiere un salto corto.
  - Obstáculo grande (Botellas, cerveza y un borracho): Requiere un salto más largo/alto.
  - *Nota:* La altura y longitud del salto debe depender del tiempo que se mantenga presionado el botón.
- **Mecánica de Drift (Baranda oxidada):**
  - En ciertas zonas la pista se estrecha o cambia, y aparece una baranda oxidada.
  - Los jugadores DEBEN driftear/deslizarse manteniéndose muy cerca de la baranda para poder pasar el tramo. Si no lo hacen correctamente, caerán al vacío.
- **Colisiones / Bloqueos ("Choque"):**
  - Dos jugadores no pueden superponerse (no pueden ocupar el mismo espacio).
  - Si un jugador está a la derecha del otro, el jugador de la izquierda no podrá deslizarse hacia la derecha (será bloqueado físicamente por el otro jugador).
- **Empujar:**
  - Mecánica activa con su propia animación donde un jugador puede dar un empujón lateral al otro para sacarlo del camino, tirarlo a un obstáculo o al vacío.

## 4. Entorno y Arte (Procedural)
- **Fondo Parallax:** Inspirado en los cerros de Cali (Cristo Rey, Cerro de las 3 Cruces). Debe ser dibujado con polígonos/canvas.
- **Superficie de la Pista:** Concreto/asfalto. No puede ser un color sólido; debe tener una textura generada por código (ej. ruido o patrones de líneas) para simular la textura del pavimento.
- **Música:** Salsa caleña en formato 8-bits. Debe generarse usando `AudioContext` de JavaScript internamente en el archivo.

## 5. Diseño de Personajes (Generados por código)
Ambos personajes van montados en canastas de cerveza.
- **Jugador 1: Diablito**
  - Inspirado en la cultura caleña (Changó).
  - Detalles sugeridos: Tonos rojos, cuernos, cola.
- **Jugador 2: Nea**
  - Basado ESTRICTAMENTE en el diseño de referencia: `image_1bd4ed.png`.
  - Detalles visuales clave a replicar por código: Gorra levantada (colores verde/fucsia/blanco, logo estilo Adidas), corte de pelo estilo "7", arete de cruz, ropa fluorescente (camisa fucsia con hoja verde).

---
**Instrucción Final para la IA de Desarrollo:** Usa este documento como tu lista de verificación estricta. Todo el código que generes debe cumplir con la restricción de los 50 kB y debe ser completamente autocontenido dentro de `game.js`. ¡Buena suerte!