// Os testes de carreira simulam dezenas de dias; com a suíte inteira em paralelo (e a máquina ocupada) alguns
// passavam do timeout padrão de 5 s de forma intermitente. Sem efeito no resultado dos testes.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { testTimeout: 30_000 },
});
