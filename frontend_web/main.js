import { inicializarLanding } from './src/vistas/landing';
import { inicializarDojo } from './src/vistas/dojo';

document.addEventListener('DOMContentLoaded', () => {
  // Inicializamos la vista de la landing si existen los botones
  inicializarLanding();

  // Inicializamos la lógica del juego (si existe el canvas en la página)
  inicializarDojo();
});
