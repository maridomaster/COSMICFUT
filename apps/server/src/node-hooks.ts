/**
 * A engine usa imports relativos sem extensão (estilo bundler). No Node (type stripping nativo),
 * este hook tenta `<spec>.ts` e `<spec>/index.ts` quando a resolução padrão falha.
 * Mesma técnica de packages/engine/scripts/calibrate.ts.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (!spec.startsWith('.') || /\.[cm]?[jt]s$/.test(spec)) throw e;
      try {
        return next(`${spec}.ts`, ctx);
      } catch {
        return next(`${spec}/index.ts`, ctx);
      }
    }
  },
});
