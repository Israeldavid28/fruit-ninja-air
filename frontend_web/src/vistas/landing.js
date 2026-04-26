import { iniciarSesion } from '../servicios/supabase';

export function inicializarLanding() {
  const btnGoogle = document.getElementById('btn-login-google');
  const btnDiscord = document.getElementById('btn-login-discord');
  
  if (btnGoogle) {
    btnGoogle.addEventListener('click', async () => {
      try {
        await iniciarSesion('google');
      } catch (error) {
        alert('Hubo un error al conectar con Google/Supabase');
      }
    });
  }

  if (btnDiscord) {
    btnDiscord.addEventListener('click', async () => {
      try {
        await iniciarSesion('discord');
      } catch (error) {
        alert('Hubo un error al conectar con Discord/Supabase');
      }
    });
  }
}
