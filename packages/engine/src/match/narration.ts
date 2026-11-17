/**
 * Narração pt-BR. Templates com placeholders:
 *  {p} jogador principal · {a} assistente / segundo jogador · {g} goleiro adversário
 *  {t} time do lance · {o} adversário · {s} placar "casa x fora" · {home} · {away}
 *  {in} quem entra · {out} quem sai · {d} detalhe livre
 */
import type { Rng } from '../rng';

export type NarrationKey =
  | 'kickoff' | 'half-time' | 'second-half' | 'full-time' | 'extra-time' | 'extra-time-2' | 'penalties'
  | 'chance' | 'chance-assist' | 'chance-lost' | 'shot-off' | 'shot-blocked' | 'shot-on-target' | 'save' | 'save-great' | 'woodwork'
  | 'goal' | 'goal-assist' | 'goal-header' | 'goal-long' | 'goal-penalty' | 'goal-freekick' | 'goal-equalizer'
  | 'goal-lead' | 'own-goal'
  | 'foul' | 'foul-dangerous' | 'yellow' | 'red' | 'second-yellow' | 'injury'
  | 'corner' | 'offside' | 'penalty-awarded' | 'penalty-missed' | 'penalty-saved'
  | 'freekick-shot' | 'substitution' | 'substitution-injury' | 'tactic-change' | 'stoppage'
  | 'shootout-goal' | 'shootout-miss' | 'shootout-save' | 'shootout-win'
  | 'commentary-pressure' | 'commentary-calm' | 'commentary-crowd' | 'commentary-tired';

export const TEMPLATES: Record<NarrationKey, string[]> = {
  kickoff: [
    'Rola a bola! Começa o jogo entre {home} e {away}.',
    'Apita o árbitro e está valendo: {home} x {away}!',
    'Bola em jogo! {home} e {away} abrem os trabalhos.',
    'Tudo pronto, torcida em festa, e começa a partida! {home} contra {away}.',
    'Saída de bola autorizada. Que vença o melhor: {home} x {away}!',
  ],
  'half-time': [
    'Fim do primeiro tempo. {home} {s} {away}.',
    'O árbitro apita e manda todo mundo pro vestiário. Placar parcial: {s}.',
    'Intervalo! {s} no placar. Muito a se conversar nos vestiários.',
    'Termina a primeira etapa: {home} {s} {away}.',
  ],
  'second-half': [
    'Bola rolando para o segundo tempo!',
    'Recomeça o jogo! Segunda etapa em andamento.',
    'Os times voltam do intervalo e o jogo recomeça.',
    'Começa o segundo tempo. Quem vai mudar essa história?',
  ],
  'full-time': [
    'Fim de jogo! {home} {s} {away}.',
    'Apita o árbitro, acabou! Placar final: {home} {s} {away}.',
    'É o fim! {home} {s} {away}. Os jogadores se cumprimentam no gramado.',
    'Encerrada a partida: {s}. A torcida reage ao resultado.',
  ],
  'extra-time': [
    'Empate no tempo normal! Vamos para a prorrogação.',
    'Ninguém venceu nos 90 minutos. Teremos mais 30 minutos de bola!',
    'Prorrogação! Os técnicos dão as últimas instruções.',
  ],
  'extra-time-2': [
    'Segundo tempo da prorrogação! Faltam 15 minutos.',
    'Trocam de lado e começa a etapa final da prorrogação.',
  ],
  penalties: [
    'Persiste o empate! A decisão vai para as cobranças de pênalti.',
    'Disputa de pênaltis! Coração na boca nas arquibancadas.',
    'Vai para os pênaltis! Que loteria emocionante teremos agora.',
  ],
  chance: [
    '{p} recebe na entrada da área e prepara o arremate...',
    '{p} ganha na velocidade e entra na área!',
    'Contra-ataque perigoso do {t} com {p}!',
    '{p} limpa a marcação e procura o espaço para finalizar.',
    'O {t} troca passes envolventes e {p} aparece livre!',
    '{p} dribla um, dribla dois... está cara a cara!',
  ],
  'chance-assist': [
    'Boa trama do {t}! {a} encontra {p} em boas condições.',
    'Lançamento açucarado de {a} para {p}, que domina na área!',
    '{a} rouba a bola e aciona {p} em velocidade!',
    'Cruzamento preciso de {a}, {p} aparece na segunda trave!',
    '{a} enfia a bola entre os zagueiros e {p} sai na cara do gol!',
  ],
  'chance-lost': [
    '{p} tentou o passe final, mas a zaga do {o} cortou.',
    'Chegada do {t}, mas {p} demorou demais e foi desarmado.',
    'O {t} rondou a área, mas {p} errou o último passe.',
    'Bola cruzada na área do {o}, mas ninguém do {t} completa!',
  ],
  'shot-off': [
    '{p} solta a bomba... por cima do gol!',
    '{p} bate de primeira e manda para fora. Passou perto!',
    'Chute cruzado de {p}, a bola sai rente à trave!',
    '{p} finaliza mal, a bola vai pela linha de fundo.',
    'Arremate de {p}... isolou! A torcida lamenta.',
    '{p} tenta colocar, mas tira demais do goleiro. Pra fora!',
    '{p} arrisca de longe e a bola passa longe do alvo.',
  ],
  'shot-blocked': [
    '{p} chuta, mas a bola explode na zaga do {o}!',
    'Bloqueio providencial! A defesa do {o} trava o chute de {p}.',
    '{p} finaliza e a bola desvia num zagueiro.',
    'Chute travado! {p} não conseguiu passar pela marcação.',
  ],
  'shot-on-target': [
    '{p} chuta firme no gol!',
    '{p} finaliza no alvo!',
  ],
  save: [
    '{p} bate firme e {g} defende!',
    'Boa defesa de {g} no chute de {p}!',
    '{g} encaixa a finalização de {p}. Seguro!',
    '{p} chuta rasteiro e {g} vai buscar no cantinho!',
    'Cabeçada de {p}, e {g} está lá para defender.',
    '{g} espalma o chute de {p} e evita o gol!',
  ],
  'save-great': [
    'QUE DEFESA! {g} voa no ângulo e tira o gol de {p}!',
    'Milagre de {g}! {p} já comemorava, mas o goleiro operou um milagre!',
    'Defesaça de {g}! Reflexo impressionante no chute à queima-roupa de {p}!',
    'É paredão! {g} fecha o gol diante de {p}!',
  ],
  woodwork: [
    'NA TRAVE! {p} acerta o poste e a bola volta!',
    'Uhhhh! {p} carimba o travessão!',
    'A bola de {p} explode na trave! Que azar do {t}!',
    'No pé da trave! {p} quase marca um golaço.',
    'Travessão! O chute de {p} faz o estádio inteiro prender a respiração.',
  ],
  goal: [
    'GOOOOOL! {p} balança as redes para o {t}! {s}',
    'É GOL DO {T}! {p} bate na saída do goleiro e marca! {s}',
    'GOL! {p} não perdoa e empurra para o fundo da rede! {s}',
    'GOLAÇO! {p} solta o pé e a bola morre no ângulo! {s}',
    'Lá vai ele... É GOL! {p} marca para o {t}! {s}',
    'GOOOL! A torcida do {t} explode! {p} é o nome do gol. {s}',
    'Ele não erra! {p} faz o gol do {t}! {s}',
  ],
  'goal-assist': [
    'GOOOOOL! {a} serve e {p} completa para o {t}! {s}',
    'GOL DO {T}! Passe açucarado de {a} e {p} só escora! {s}',
    'É GOL! Tabela entre {a} e {p}, que finaliza com categoria! {s}',
    'GOOOL! {a} enxerga {p} livre e não tem jeito pro goleiro! {s}',
    'GOL! Que jogada! {a} cruza e {p} manda para as redes! {s}',
    'Golaço do {t}! {a} deu o passe e {p} bateu sem chance! {s}',
  ],
  'goal-header': [
    'GOOOOL DE CABEÇA! {p} sobe mais que todo mundo e testa para o gol! {s}',
    'É GOL! Escanteio, {p} cabeceia firme e marca! {s}',
    'GOL! {a} cobra na medida e {p} cabeceia no canto! {s}',
    'De cabeça! {p} aproveita a bola alçada na área e marca! {s}',
  ],
  'goal-long': [
    'GOLAÇO DE FORA DA ÁREA! {p} arrisca e acerta um foguete! {s}',
    'QUE PANCADA! {p} chuta de longe e a bola entra no ângulo! {s}',
    'Lá de longe! {p} surpreende o goleiro e marca um golaço! {s}',
  ],
  'goal-penalty': [
    'GOL DE PÊNALTI! {p} bate com categoria e desloca o goleiro! {s}',
    '{p} cobra forte no canto, sem chances! É GOL! {s}',
    'Pênalti convertido! {p} manda no meio do gol com frieza! {s}',
    'Na marca da cal, {p} não vacila. GOL do {t}! {s}',
  ],
  'goal-freekick': [
    'GOL DE FALTA! {p} coloca a bola onde o goleiro não alcança! {s}',
    'Cobrança perfeita de {p}! A bola passa por cima da barreira e entra! {s}',
  ],
  'goal-equalizer': [
    'Tudo igual! {p} empata o jogo para o {t}! {s}',
    'GOL DE EMPATE! {p} recoloca o {t} no jogo! {s}',
  ],
  'goal-lead': [
    'Virada! {p} coloca o {t} na frente! {s}',
  ],
  'own-goal': [
    'Gol contra! {p} desvia para o próprio gol, azar do {o}. {s}',
    'Que infelicidade! {p} tenta cortar e manda contra o próprio patrimônio. {s}',
    'GOL CONTRA de {p}! O {t} agradece. {s}',
  ],
  foul: [
    'Falta de {p} no meio-campo.',
    '{p} chega atrasado e comete a falta.',
    'O árbitro marca falta de {p}.',
    '{p} segura o adversário pela camisa. Falta.',
    'Entrada dura de {p}. Falta marcada.',
    '{p} derruba o adversário e para o contra-ataque.',
  ],
  'foul-dangerous': [
    'Falta perigosa! {p} derruba o atacante na entrada da área.',
    '{p} comete falta em posição frontal ao gol. Perigo para o {o}!',
    'Falta na meia-lua! {p} parou a jogada com falta.',
  ],
  yellow: [
    'Cartão amarelo para {p}.',
    '{p} recebe o amarelo pela entrada dura.',
    'O árbitro mostra o amarelo para {p}, que reclama.',
    'Amarelo para {p}. Vai ter que tomar cuidado agora.',
    '{p} leva o cartão amarelo por reclamação.',
  ],
  'second-yellow': [
    'Segundo amarelo para {p}! Está expulso! O {t} fica com um a menos.',
    '{p} faz outra falta e recebe o segundo amarelo. Vermelho!',
    'Expulso! {p} já tinha amarelo e deixa o {t} em desvantagem.',
  ],
  red: [
    'CARTÃO VERMELHO DIRETO para {p}! Entrada criminosa!',
    'Expulsão! {p} recebe o vermelho e o {t} fica com um a menos!',
    'Vermelho! {p} acerta o adversário de forma violenta e está fora do jogo.',
  ],
  injury: [
    '{p} sente a lesão e pede atendimento médico.',
    'Preocupação no {t}: {p} cai no gramado sentindo dores.',
    '{p} se machuca no lance e não parece ter condições de continuar.',
    'Atendimento médico em campo para {p}, que sentiu a coxa.',
  ],
  corner: [
    'Escanteio para o {t}.',
    'A bola desvia na zaga e é escanteio para o {t}.',
    '{p} vai para a cobrança do escanteio.',
    'Mais um escanteio para o {t}, que pressiona.',
  ],
  offside: [
    'Impedimento de {p}. O bandeira levanta a bandeira.',
    '{p} sai cedo demais e está impedido.',
    'O {t} chegava com perigo, mas {p} estava em posição irregular.',
    'Impedido! {p} se adiantou e a jogada é anulada.',
  ],
  'penalty-awarded': [
    'PÊNALTI! {a} derruba {p} dentro da área!',
    'O árbitro aponta para a marca da cal! Pênalti para o {t}!',
    'É pênalti! {p} foi derrubado na área por {a}.',
    'Toque de mão na área! Pênalti para o {t}!',
  ],
  'penalty-missed': [
    '{p} bate o pênalti... PRA FORA! Desperdiçou!',
    'Perdeu! {p} chuta por cima do gol na cobrança do pênalti.',
    '{p} cobra no poste! Pênalti desperdiçado!',
  ],
  'penalty-saved': [
    'DEFENDEU! {g} pega o pênalti de {p}!',
    '{g} adivinha o canto e defende a cobrança de {p}!',
    'Que defesa! {g} para o pênalti batido por {p}!',
  ],
  'freekick-shot': [
    '{p} ajeita a bola para a cobrança de falta...',
    '{p} cobra a falta direto para o gol!',
  ],
  substitution: [
    'Substituição no {t}: sai {out}, entra {in}.',
    'Mexe o técnico do {t}: {in} no lugar de {out}.',
    'Alteração no {t}. {out} deixa o campo para a entrada de {in}.',
    '{in} entra no jogo no lugar de {out}.',
  ],
  'substitution-injury': [
    'Sem condições, {out} deixa o campo. {in} entra no {t}.',
    '{out} sai lesionado e dá lugar a {in}.',
  ],
  'tactic-change': [
    'O {t} muda a postura: {d}.',
    'Mudança tática no {t}: {d}.',
    'O técnico do {t} gesticula muito na beira do campo: {d}.',
  ],
  stoppage: [
    'O quarto árbitro indica {d} minutos de acréscimo.',
    'Serão {d} minutos de acréscimo.',
    'Placa levantada: mais {d} minutos.',
  ],
  'shootout-goal': [
    '{p} bate e converte para o {t}.',
    'Gol! {p} cobra com tranquilidade.',
    '{p} desloca o goleiro e marca.',
    'Bola de um lado, goleiro do outro. {p} converte!',
  ],
  'shootout-miss': [
    '{p} chuta para fora! Perdeu a cobrança!',
    '{p} bate no travessão! Desperdiçou!',
  ],
  'shootout-save': [
    '{g} defende a cobrança de {p}!',
    'Pegou! {g} para o chute de {p}!',
  ],
  'shootout-win': [
    'Acabou! O {t} vence nos pênaltis por {d}!',
    'É do {t}! Classificação nos pênaltis: {d}!',
  ],
  'commentary-pressure': [
    'O {t} sufoca o {o} em seu campo de defesa.',
    'Pressão total do {t}! O gol parece questão de tempo.',
    'O {t} adianta as linhas e o {o} não consegue sair jogando.',
    'Domínio claro do {t} neste momento da partida.',
  ],
  'commentary-calm': [
    'Jogo truncado no meio-campo, muitas disputas e poucas chances.',
    'Partida morna. Os times se estudam.',
    'Muita troca de passes, mas pouca objetividade.',
    'Ritmo cadenciado, ninguém quer se arriscar.',
  ],
  'commentary-crowd': [
    'A torcida do {t} canta alto e empurra o time!',
    'Arquibancada lotada fazendo festa para o {t}.',
    'Ola nas arquibancadas! Clima de festa.',
  ],
  'commentary-tired': [
    '{p} já sente o cansaço e pede para respirar.',
    'O desgaste físico começa a pesar para {p}.',
  ],
};

export type NarrationVars = Partial<Record<'p' | 'a' | 'g' | 't' | 'o' | 's' | 'home' | 'away' | 'in' | 'out' | 'd', string>>;

export function narrate(rng: Rng, key: NarrationKey, vars: NarrationVars): string {
  const list = TEMPLATES[key];
  const tpl = list[Math.floor(rng.next() * list.length)];
  return tpl.replace(/\{(T|[a-z]+)\}/g, (_m, k: string) => {
    if (k === 'T') return (vars.t ?? '').toUpperCase();
    const v = vars[k as keyof NarrationVars];
    return v ?? '';
  });
}

const MENTALITY_PT: Record<string, string> = {
  'ultra-defensive': 'retranca total',
  defensive: 'postura defensiva',
  balanced: 'equilíbrio',
  attacking: 'postura ofensiva',
  'all-out': 'tudo ao ataque',
};
const TEMPO_PT: Record<string, string> = { slow: 'ritmo lento', normal: 'ritmo normal', fast: 'ritmo acelerado' };
const PRESS_PT: Record<string, string> = { low: 'marcação recuada', medium: 'pressão média', high: 'pressão alta' };
const PASS_PT: Record<string, string> = { short: 'passes curtos', mixed: 'passes variados', direct: 'jogo direto' };

export function describeTacticChange(t: Partial<Record<'formation' | 'mentality' | 'tempo' | 'pressing' | 'passing', string>>): string {
  const parts: string[] = [];
  if (t.formation) parts.push(`formação ${t.formation}`);
  if (t.mentality) parts.push(MENTALITY_PT[t.mentality] ?? t.mentality);
  if (t.tempo) parts.push(TEMPO_PT[t.tempo] ?? t.tempo);
  if (t.pressing) parts.push(PRESS_PT[t.pressing] ?? t.pressing);
  if (t.passing) parts.push(PASS_PT[t.passing] ?? t.passing);
  return parts.join(', ');
}
