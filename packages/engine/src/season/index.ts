export { generateRoundRobin, roundDates, addDays, type RoundRobinMatch } from './schedule';
export { computeStandings, type StandingsOptions } from './standings';
export { createSeason, nextFixtureFor, fixturesOn, advanceDay, buildTeamInput, unavailablePlayers, fixtureMatchRules, type AdvanceDayOptions } from './season';
export {
  ECONOMY, LEGACY_ECONOMY, operatingMonthly, ticketRevenue, tvMonthly, sponsorMonthly, leaguePrize,
  REAL_ECONOMY, hasRealEconomy, realTicketPrice, realOperatingPerSeason, ownerSupportPerSeason, ownerMonthly, foreignMatchdayMonthly, expectedFill,
} from './economy';
/* Fase 1: competições com formato, calendário, carreira e virada */
export {
  progressCompetition, initCompetition, finishCompetition, resolveTie, tieAggregate, aggregateBefore, pick, pickAll,
  stageStandings, stageGroupTables, stageFixtures, overallStandings, finalRanking, tableOf, compareRows, stageDeps,
  validateFormat, groupName, CALENDAR_EXTENSION_DAYS, type FormatContext,
} from './format';
export { resolveConflicts, seasonDates, matchDates, PRIORITY, type ConflictMove } from './calendar';
export {
  leagueFormat, nationalFormat, serieCFormat, groupsKnockoutFormat, aperturaClausuraFormat, stateFormat, genericStateFormat,
  brazilCupFormat, genericCupFormat, supercupFormat, koRounds, roundName, type LeagueDivision, type StateDivision,
} from './competitions';
export { lightSimulate, LIGHT, type LightTeam } from './light';
export {
  EVOLUTION, MIN_PLAYER_AGE, RETIREMENT, YOUTH, squadTarget, growthGap, marketValue, monthlyWage, monthlyDelta, yearEndBonus,
  VALUE_CURVE, ageValueMult, valueCurve, revalue, squadScales,
  nextPotential, realisticPotential, retireChance, randomName, neediestPosition, generateYouthPlayer, type YouthSpec,
} from './players';
export {
  createCareer, createWorld, createSeasonFromWorld, worldSquads, careerSquads, squadsFromMarket, seedMarket, seasonOver,
  brazilCupEntrants, countryDivisions, nationalDivisionOf, DEFAULT_CAREER_OPTIONS, UF_ORDER, regionOfDataClub,
  type CreateCareerOptions, type SeasonFromWorldOptions, type NamePools,
} from './career';
export { rolloverSeason, nextSeason, seasonChampions, allocateSerieD, expiringContracts, turnoverInfo, regionCountryCodes, type RolloverOptions } from './rollover';

/* Fase 2: continentais, economia fiel, renovação detalhada, migração de save */
export {
  libertadoresFormat, sulamericanaFormat, recopaFormat, intercontinentalFormat, supermundialFormat, nordesteFormat,
  qualifyContinental, ordersFromSeason, leagueQualificationOrder, qualifiedFrom, continentalCompetitions, continentalConfig,
  linkContinental, initContinental, continentalCountryOf, confedChampion, supermundialEntrants, supermundialYear, nordesteEntrants,
  strengthSort, continentalPots, leagueLabel, DEFAULT_CONTINENTAL, SUPERMUNDIAL_FIRST,
  type SupermundialMode, type QualifyInput, type ContinentalBuild, type ContinentalSeasonOptions,
} from './continental';
export {
  FINANCE, suggestedTicketPrice, ticketPriceOf, ticketDemandFactor, ticketSales, setTicketPrice, maxLoan, loanInterest,
  takeLoan, repayLoan, stadiumWorkDays, stadiumExpansionCost, expandStadium, luvaAmount, chargeLuva, payOffLuva, monthlyLuvas,
  processMonthlyFinance, processStadiumWorks, financeOverview, homeTicketDemand, resultAttendance, type FinanceResult,
} from './finance';
export { drawGroups, forceFinishCompetition } from './format';
/* 13/11: confronto consultável */
export { tieSummary, tieSummaryOf, type TieSummary } from './format';
export { migrateCareer, careerNamePoolCodes, ageUntracked, CAREER_REV, isLegacyCareer, careerStartDate, cycleCompetitions, scopeNamePoolCodes } from './career';
/* Etapa 1: linha do tempo global, calendário duplo e escopo geográfico */
export {
  SCOPE_REGIONS, REGIONS, SCOPE_CODES, TRANSFER_WINDOWS, regionOfCode, cycleOfRegion, regionsOfCycle, cycleSeason, seasonLabel, cycleStart,
  cycleEnd, segmentFrom, weekOfYear, windowFor, regionOfClub, clubSeason, primaryRegion, defaultLoanUntil, turnoverDue,
  turnoverAffectsHumans, autoTurnoverDue, cycleOfCompetition, shiftDates, cycleCalendar, type Cycle, type Region,
} from './timeline';
export { renewalDemand, RENEW_RETIRE_AGE, MIN_SQUAD, stateReplacements, type RenewTerms } from './rollover';
/* Etapa 2: competições reais, convidados e vagas */
export {
  realLeagueFormat, nationalCupFormat, CUP_STYLES, supercup4Format, relegationPlayoffFormat, type CupStyle,
} from './competitions';
export {
  DEFAULT_UEFA_SLOTS, uefaSlotsConfig, guestsConfig, guestRegion, strengthWeight, drawWeighted, leaguePhaseFormat, aclEliteFormat,
  qualifyUefa, qualifyAfc, initialTitleHolders, uefaCompetitions, afcCompetitions, guestChampion, supermundialEntrantsV2, worldCompetitions,
  linkCompetitions, LEAGUE_PHASE_SIZE, AFC_REGION_SIZE, AFC_SAUDI, type ConfedQualifyInput, type WorldCompOptions,
} from './confed';
export { swissDraw, scheduleRounds, swissSchedule, eulerOrient, type SwissPair } from './swiss';
export { supercupEntrants, BRAZIL_CUP_2026 } from './career';
export { feedCompetition } from './continental';
export { qualificationZones, type QualZoneInfo } from './zones';
export type { MigrateCareerOptions } from './career';
/* Fase 3: carreira do técnico */
export {
  COACH, coachLevel, coachReputation, stabilityBand, coachWage, resignationFine, requiredReputation, canMutualAgreement,
  unreadCount, nationalTeams, mainCompetition, seasonExpectation, currentPosition, createCoachCareer, markInboxRead,
  renameCoach, coachDay, applyForJob, interestCooldown, declareInterest, acceptJobOffer, declineJobOffer, resignJob,
  jobCenter, coachSeasonEnd,
  type CreateCoachOptions, type CoachDayContext, type CoachDayEvents, type CoachActionResult, type JobListing, type CoachListing,
} from './coach';
/* Etapa 4: economia (fluxo de caixa, bilheteria, prêmios por fase, teto da folha, Moral da Torcida) */
export {
  ECON, IMPORTANCE, FANS, PHASE_LABEL, clubEconomyProfile, applyEconomyProfiles, hasEcon, tvFor, expectedMerit, meritAt, wageRatioFor,
  baseFill, homeGamesFor, coachMonthlyFor, stadiumAgeClass, phaseKeyOf, isClassic, matchImportance, priceDemand, gateRevenue,
  ticketPriceFor, matchGate, recordGate, bumpFans, fanResultDelta, fanPriceDelta, prizeScheduleOf, payPhasePrizes, matchBonus,
  wageBillOf, checkWageCeiling, ceilingError, monthlyCashFlow, ledgerDiff, rollMonth, pushMonth, currentMonthFlow, toBrl,
  type EconProfile, type EconProfileInput, type MatchImportance, type GateInput, type GateResult, type MatchGate, type CeilingCheck, type MonthlyResult,
} from './econ';
export { econTables } from './career';
/* Registros: gols/assistências de todos os jogos, artilharia, campanhas, troféus e carreira dos jogadores */
export {
  RECORDS, emptyRecords, recordCompetitionGoals, recordLines, clubSeasonLabelAt, flushLines, pruneRetired, topRows, campaignReach,
  competitionRecord, playerCareer, clubHistory, clubTrophies, championsOf, type PlayerCareerRow, type ClubCampaign,
} from './records';
export { LIGHT_ASSIST } from './light';
/* Calendário: pular no tempo com o assistente */
export {
  TimeSkip, timeSkip, assistantRenewals, assistantDay, lazyCareerSquads, ASSISTANT, skipShortcuts, DEFAULT_SKIP_STOPS, SKIP_MAX_DAYS,
  type SkipStops, type SkipReason, type SkipOptions, type SkipTurnover,
} from './skip';
export { loanBlockFor, seatCostFor } from './finance';
export { MAX_HOTSEAT, createHotseat, activateHotseat, nextHotseatTurn, endHotseatTurn, hotseatPlayingToday } from './hotseat';
/* Atualização 38: disciplina por competição (suspensões e amarelos por competitionId) */
export {
  ANY_COMPETITION, YELLOW_LIMIT, suspensionGames, isSuspendedFor, suspendedPlayers, suspensionsOf, yellowsIn, applyMatchDiscipline,
  moveDiscipline, migrateDiscipline, type DisciplineEvent,
} from './discipline';
export { duplicateGroups, retireDuplicatePlayers, DEDUP_REV } from './dedupe';
export { ACADEMY, academyDay, academyWage, generateProspect, promoteProspect, releaseProspect, rollAcademyRatings } from './academy';
export { AWARDS, awardWindow, computeSeasonAwards, pickTeam } from './awards';
export { prizeTable, type PrizeRow, type PrizeTableView } from './prizes';
