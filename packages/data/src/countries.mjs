// Tabela índice do país (P<n> em default_lang.xml) -> sigla de 3 letras usada pelo jogo
// (nomes de arquivo em arquivos/names/<SIGLA>.txt e conf_ligas_nacionais/<SIGLA>.cfg).
//
// Como foi montada (ver README):
//  1. 37 siglas são confirmadas pelo campo `pais` dos .cfg de ligas nacionais (ex.: BRA.cfg -> 29).
//  2. As demais foram atribuídas cruzando o nome do país em pt-BR com as 221 siglas disponíveis
//     e validadas estatisticamente: para cada nacionalidade, os nomes/sobrenomes dos jogadores
//     e técnicos dessa nacionalidade foram comparados com os pools de names/surnames de cada sigla
//     (score ponderado pela raridade do token). Casos ambíguos resolvidos por esse score:
//     ELQ=Eslováquia, ESV=Eslovênia, GUN=Guiana, GUI=Guiné, IRA=Irã, IRN=Irlanda do Norte,
//     NIG=Nigéria, NIR=Níger, COM=Costa do Marfim, ICM=Comores, IMR=Maurícia, MAU=Mauritânia,
//     MTI=Martinica, GDA=Guadalupe, GMA=Guam, SME=Samoa Americana, MON=Montenegro.
//  3. Bonaire (221), São Martinho Francês (222) e São Martinho Holandês (223) não têm arquivo de
//     nomes no jogo -> code null.
export const COUNTRY_CODES = {
  0: 'AFG', 1: 'AFS', 2: 'ALB', 3: 'ALE', 4: 'AND', 5: 'AGO', 6: 'AIA', 7: 'ATG', 8: 'CUR', 9: 'ARS',
  10: 'ALG', 11: 'ARG', 12: 'ARM', 13: 'ARU', 14: 'AUS', 15: 'AUT', 16: 'AZE', 17: 'BAH', 18: 'BHR', 19: 'BAN',
  20: 'BAR', 21: 'BEL', 22: 'BLZ', 23: 'BEN', 24: 'BER', 25: 'BIE', 26: 'BOL', 27: 'BOS', 28: 'BOT', 29: 'BRA',
  30: 'BRU', 31: 'BUL', 32: 'BKF', 33: 'BUR', 34: 'BUT', 35: 'CAV', 36: 'CAM', 37: 'CMJ', 38: 'CAN', 39: 'CAT',
  40: 'CAZ', 41: 'CHA', 42: 'CHI', 43: 'CHN', 44: 'CPR', 45: 'TML', 46: 'COL', 47: 'CNG', 48: 'CRN', 49: 'CRS',
  50: 'COM', 51: 'CSR', 52: 'CRO', 53: 'CUB', 54: 'DIN', 55: 'DJI', 56: 'DOM', 57: 'EGI', 58: 'ELS', 59: 'EMI',
  60: 'EQU', 61: 'ERI', 62: 'ESC', 63: 'ELQ', 64: 'ESV', 65: 'ESP', 66: 'EST', 67: 'ETI', 68: 'EUA', 69: 'FIJ',
  70: 'FIN', 71: 'FIL', 72: 'FRA', 73: 'GAB', 74: 'GAM', 75: 'GAN', 76: 'GEO', 77: 'GRA', 78: 'GRE', 79: 'GUA',
  80: 'GUN', 81: 'GUI', 82: 'GNB', 83: 'GNE', 84: 'HAI', 85: 'HOL', 86: 'HON', 87: 'HKG', 88: 'HUN', 89: 'IEM',
  90: 'ICA', 91: 'ICO', 92: 'IFA', 93: 'ISA', 94: 'IVB', 95: 'IND', 96: 'IDO', 97: 'ING', 98: 'IRA', 99: 'IRQ',
  100: 'IRL', 101: 'IRN', 102: 'ISL', 103: 'ISR', 104: 'ITA', 105: 'MON', 106: 'JAM', 107: 'JAP', 108: 'JOR', 109: 'QUE',
  110: 'KOS', 111: 'KUW', 112: 'LAO', 113: 'LES', 114: 'LET', 115: 'LBN', 116: 'LIB', 117: 'LRI', 118: 'LIE', 119: 'LIT',
  120: 'LUX', 121: 'MAC', 122: 'MCD', 123: 'MAD', 124: 'MAL', 125: 'MWI', 126: 'MLD', 127: 'MLI', 128: 'MTA', 129: 'MAR',
  130: 'MAU', 131: 'MEX', 132: 'MIA', 133: 'MOC', 134: 'MOL', 135: 'MNC', 136: 'MGL', 137: 'NAM', 138: 'NEP', 139: 'NIC',
  140: 'NIR', 141: 'NIG', 142: 'NOR', 143: 'NOZ', 144: 'OMA', 145: 'PGA', 146: 'PAL', 147: 'PAN', 148: 'PNG', 149: 'PAQ',
  150: 'PAR', 151: 'PER', 152: 'POL', 153: 'PRI', 154: 'POR', 155: 'QUI', 156: 'RCA', 157: 'RDG', 158: 'RDO', 159: 'RTC',
  160: 'ROM', 161: 'RUA', 162: 'RUS', 163: 'SAM', 164: 'SAN', 165: 'STL', 166: 'SCN', 167: 'STP', 168: 'SVG', 169: 'SEN',
  170: 'SLE', 171: 'SER', 172: 'SEY', 173: 'SIN', 174: 'SIR', 175: 'SOM', 176: 'SRI', 177: 'SUA', 178: 'SUD', 179: 'SUE',
  180: 'SUI', 181: 'SUR', 182: 'TAD', 183: 'TAI', 184: 'TTI', 185: 'TAW', 186: 'TAN', 187: 'TGO', 188: 'TON', 189: 'TRT',
  190: 'TUN', 191: 'TCM', 192: 'TUR', 193: 'UCR', 194: 'UGA', 195: 'URU', 196: 'UZB', 197: 'VAN', 198: 'VEN', 199: 'VIE',
  200: 'ZAM', 201: 'ZIM', 202: 'ICM', 203: 'MIC', 204: 'IMA', 205: 'IMR', 206: 'NAU', 207: 'PLU', 208: 'KIR', 209: 'SUS',
  210: 'TUV', 211: 'IVA', 212: 'MST', 213: 'ITC', 214: 'SME', 215: 'NCA', 216: 'GIB', 217: 'GDA', 218: 'GMA', 219: 'MTI',
  220: 'GFR', 221: null, 222: null, 223: null,
};

export const BRAZIL = 29;
export const UF = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
  'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
