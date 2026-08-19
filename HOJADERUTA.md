Esta es una hoja de ruta estructurada y realista para desarrollar "San Antonio Drift" en 12 horas con un equipo de 3 personas. Dado el límite crítico de 50 kB y la restricción de no usar assets externos, el enfoque principal debe ser la generación procedural (Phaser Graphics API) y la síntesis de audio mediante código.

---

### Distribución del Equipo (3 Personas)

Para maximizar la eficiencia en 12 horas, es vital dividir los roles. Todos trabajarán sobre el mismo archivo `game.js`, por lo que el control de versiones o la integración constante es fundamental.

* **Desarrollador 1 (Lógica Core y Físicas):** Encargado de la vista isométrica (pseudo-3D), el movimiento continuo hacia abajo, las colisiones entre jugadores, y el sistema de cámara/eliminación.
* **Desarrollador 2 (Mecánicas de Juego):** Encargado de la generación de obstáculos (huecos, botellas, borracho), lógicas de salto variable, la mecánica de la baranda (drift) y la acción de empujar.
* **Desarrollador 3 (Arte Técnico y Audio):** Encargado de dibujar procedimentalmente los fondos (Cristo Rey, Tres Cruces), la textura del asfalto, y los personajes (Diablito y Nea, este último usando como referencia estricta el archivo image_1bd4ed.png). También debe programar la música salsa 8-bits usando Web Audio API.

---

### Hoja de Ruta Detallada (12 Horas)

#### Fase 1: Estructura y Base del Motor (Horas 1 - 3)

El objetivo de esta fase es tener un prototipo jugable crudo donde dos cuadrados caen por una pista pseudo-isométrica.

* **Desarrollador 1:**
* Configurar la escena de Phaser 3 y mapear los controles arcade (`CABINET_KEYS`) estrictamente.
* Implementar la perspectiva isométrica falsa (2.5D). Dado que es un descenso continuo, esto se logra moviendo la pista hacia arriba y escalando los objetos según su posición en Y (z-index/profundidad).
* Programar el límite de pantalla: si un jugador queda rezagado y sale de la cámara por la parte superior, pierde.


* **Desarrollador 2:**
* Crear el generador infinito de la pista.
* Implementar el movimiento lateral de los jugadores (esquivar).
* Programar la colisión entre jugadores: calcular bounding boxes para evitar la superposición (si P1 está a la derecha de P2, P2 no puede moverse a la derecha).


* **Desarrollador 3:**
* Crear funciones modulares con `Phaser.GameObjects.Graphics` para dibujar primitivas que luego se ensamblarán.
* Diseñar proceduralmente la textura de concreto (usando ruido matemático básico o patrones de líneas) para no usar imágenes en Base64 que consuman los 50 kB.
* Comenzar la síntesis de la clave de salsa (el patrón rítmico básico) con osciladores de Web Audio API.



#### Fase 2: Obstáculos y Arte Procedural (Horas 4 - 7)

En esta fase el juego adquiere su identidad y nivel de dificultad.

* **Desarrollador 1:**
* Implementar el sistema de desaceleración al chocar.
* Ajustar la sensación de velocidad global (aumentar la velocidad base con el paso del tiempo).


* **Desarrollador 2:**
* Crear los obstáculos fijos: Huecos (pequeños) y botellas/borrachos (grandes).
* Programar la mecánica de salto variable: calcular el tiempo que el jugador presiona el botón para determinar la altura y longitud del salto.
* Asegurar que los obstáculos grandes requieran el salto largo y los pequeños el corto.


* **Desarrollador 3:**
* Codificar visualmente a los personajes.
* **Diablito:** Formas geométricas rojas y cuernos.
* **Nea:** Usar la referencia image_1bd4ed.png para extraer paletas de color y formas clave (gorra verde/fucsia hacia arriba, corte de pelo estilo "7", ropa fluorescente). Todo debe ser dibujado con comandos como `fillRect`, `arc`, y `lineTo`.
* Añadir melodía básica de bajo y vientos de salsa a la Web Audio API, manteniendo el código del arreglo musical lo más corto posible (usar arrays comprimidos para las notas).



#### Fase 3: Mecánicas Avanzadas y Entorno (Horas 8 - 10)

Añadir la complejidad que hará el juego divertido y caótico.

* **Desarrollador 1:**
* Programar la mecánica de la "baranda oxidada". Cuando la pista se estreche y aparezca la baranda, validar que el jugador esté en el borde correcto interactuando con ella; de lo contrario, aplicar la física de caída al vacío.
* Implementar la acción de empujar (un impulso breve que desplaza al oponente lateralmente).


* **Desarrollador 2:**
* Diseñar el layout de los obstáculos para que se generen en patrones lógicos y no imposibles de pasar.
* Conectar las animaciones de empuje y caída (rotación de los objetos y escalado hacia cero para simular caída).


* **Desarrollador 3:**
* Dibujar proceduralmente el fondo parallax: siluetas simples de Cerro de las Tres Cruces y Cristo Rey usando polígonos.
* Diseñar e implementar la cubierta del juego (`cover.png` de 800x600). Dado que este archivo no afecta el tamaño del código, se puede usar un programa de diseño externo, pero debe pesar menos de 500 KB.



#### Fase 4: Pulido, Restricciones y Entrega (Horas 11 - 12)

Esta es la fase de crisis. Todo debe enfocarse en no superar los 50 kB y garantizar la estabilidad.

* **Todo el equipo:**
* Ejecutar `npm run check-restrictions` constantemente.
* Si el archivo minificado supera los 50 kB, refactorizar el código de dibujo procedural de los personajes y el fondo. Simplificar las geometrías.
* Si la música en Web Audio API ocupa mucho código de arreglos (arrays de notas), reducirla a un loop más corto.
* Editar el `metadata.json` configurando el modo `two_player`.
* Probar exhaustivamente las colisiones, asegurando que un jugador pueda ganar empujando al otro hacia los obstáculos o el vacío.
* Asegurarse de que el uso de `window.platanusArcadeStorage` (si se implementa un contador de victorias o récord de tiempo) funcione correctamente sin corromper el flujo.



---

### Consejos Clave para el Reto de 50 kB

1. **Reutilización de Funciones de Dibujo:** Creen una función universal para dibujar en Phaser. Por ejemplo, en lugar de escribir `graphics.fillRect()` cien veces, creen una función acortada `function R(x, y, w, h, c)` que aplique color y dibuje.
2. **Música Generativa:** No usen audios codificados en Base64. Un segundo de audio de baja calidad puede consumir 10 kB. Usen `AudioContext` de JavaScript, configuren ondas cuadradas y un secuenciador simple de 16 pasos en un array.
3. **Variables Cortas:** Aunque la minificación ayuda, eviten estructuras de datos masivas.
4. **Colisiones Matemáticas:** No utilicen el motor de físicas de Arcade de Phaser (con bodies complejos) si no es absolutamente necesario para ahorrar procesamiento y posibles fallos extraños en perspectivas pseudo-isométricas. Es mejor usar distancias matemáticas simples (`Math.abs(p1.x - p2.x)`) para calcular choques y empujes en este tipo de vista.