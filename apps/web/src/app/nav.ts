import { Crown, Medal, ArrowLeftRight, Dumbbell, BarChart3, Briefcase, CalendarDays, History, Inbox, LayoutDashboard, PlayCircle, Shirt, Sprout, Trophy, UserRound, Users, Wallet, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  ready: boolean;
  blurb: string;
  /** (Fase 3) só aparece com a carreira do técnico (carreira solo) */
  coach?: boolean;
  /** (17/11) só no modo online */
  online?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, ready: true, blurb: 'Visão geral do clube.' },
  { to: '/inbox', label: 'Caixa de Entrada', icon: Inbox, ready: true, blurb: 'E-mails da diretoria, propostas e respostas.', coach: true },
  { to: '/elenco', label: 'Elenco', icon: Users, ready: true, blurb: 'Gestão detalhada de jogadores, contratos, treinos e base.' },
  { to: '/taticas', label: 'Táticas', icon: Shirt, ready: true, blurb: 'Formações, escalação, instruções e bolas paradas.' },
  { to: '/mercado', label: 'Mercado', icon: ArrowLeftRight, ready: true, blurb: 'Busca de jogadores, propostas, empréstimos e olheiros.' },
  { to: '/base', label: 'Base', icon: Sprout, ready: true, blurb: 'Categorias de base: jogadores revelados de tempos em tempos para promover ao elenco.' },
  { to: '/treino', label: 'Treinamento', icon: Dumbbell, ready: true, blurb: 'Centro de Treinamento: até 3 jogadores em treino especial para evoluir.' },
  { to: '/partida', label: 'Partida', icon: PlayCircle, ready: true, blurb: 'Simulação ao vivo com narração e substituições.' },
  { to: '/calendario', label: 'Calendário', icon: CalendarDays, ready: true, blurb: 'Rodadas, resultados e classificação.' },
  { to: '/competicoes', label: 'Competições', icon: Trophy, ready: true, blurb: 'Tabelas por fase e grupo, chaves do mata-mata e artilharia.' },
  { to: '/estatisticas', label: 'Estatísticas', icon: BarChart3, ready: true, blurb: 'Artilharia e assistências de todas as competições, por temporada.' },
  { to: '/bola-de-ouro', label: 'Bola de Ouro', icon: Crown, ready: true, blurb: 'Bola de Ouro (mundial) e Bola de Prata (campeonato nacional): corrida da temporada, ícones e vencedores.' },
  { to: '/historico', label: 'Histórico', icon: History, ready: true, blurb: 'Títulos do clube, campanhas, campeões e artilheiros de cada temporada.' },
  { to: '/amigos', label: 'Liga dos Amigos', icon: Medal, ready: true, blurb: 'Ranking entre os técnicos da sala, confrontos diretos e o que cada um anda fazendo.', online: true },
  { to: '/financas', label: 'Finanças', icon: Wallet, ready: true, blurb: 'Receitas, folha, patrocínios, bilheteria e orçamento.' },
  { to: '/empregos', label: 'Central de Empregos', icon: Briefcase, ready: true, blurb: 'Vagas de clubes e seleções, candidaturas e propostas.', coach: true },
  { to: '/tecnico', label: 'Meu Técnico', icon: UserRound, ready: true, blurb: 'Perfil, reputação, contrato e histórico do técnico.', coach: true },
];

/** (Fase 3) Rotas disponíveis para o técnico desempregado (o resto leva à Central de Empregos). */
export const JOBLESS_ROUTES = ['/empregos', '/inbox', '/tecnico', '/historico', '/bola-de-ouro', '/competicoes', '/estatisticas'];

/** (Carreira online) desempregado online: Central de Empregos, Liga dos Amigos, tabelas e a sala. */
export const ONLINE_JOBLESS_ROUTES = ['/empregos', '/amigos', '/competicoes', '/estatisticas', '/historico', '/bola-de-ouro', '/sala', '/rodada-ao-vivo'];
