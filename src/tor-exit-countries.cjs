'use strict';

// Single source of truth for the Tor exit countries Nacre lets the user request.
// Codes are uppercase ISO 3166-1 alpha-2. The Tor runtime lowercases them when
// it writes ExitNodes, and the UI lists must match these keys exactly.
const TOR_EXIT_COUNTRIES = Object.freeze({
  AR: 'Argentine',
  AT: 'Autriche',
  AU: 'Australie',
  BE: 'Belgique',
  BR: 'Brésil',
  CA: 'Canada',
  CH: 'Suisse',
  CL: 'Chili',
  CO: 'Colombie',
  CZ: 'Tchéquie',
  DE: 'Allemagne',
  DK: 'Danemark',
  EE: 'Estonie',
  ES: 'Espagne',
  FI: 'Finlande',
  FR: 'France',
  GB: 'Royaume-Uni',
  GR: 'Grèce',
  HK: 'Hong Kong',
  HR: 'Croatie',
  HU: 'Hongrie',
  ID: 'Indonésie',
  IE: 'Irlande',
  IL: 'Israël',
  IN: 'Inde',
  IS: 'Islande',
  IT: 'Italie',
  JP: 'Japon',
  KR: 'Corée du Sud',
  LT: 'Lituanie',
  LU: 'Luxembourg',
  LV: 'Lettonie',
  MX: 'Mexique',
  MY: 'Malaisie',
  NL: 'Pays-Bas',
  NO: 'Norvège',
  NZ: 'Nouvelle-Zélande',
  PL: 'Pologne',
  PT: 'Portugal',
  RO: 'Roumanie',
  RU: 'Russie',
  SE: 'Suède',
  SG: 'Singapour',
  SI: 'Slovénie',
  SK: 'Slovaquie',
  TH: 'Thaïlande',
  TR: 'Turquie',
  TW: 'Taïwan',
  UA: 'Ukraine',
  US: 'États-Unis',
  VN: 'Viêt Nam',
  ZA: 'Afrique du Sud'
});

const TOR_EXIT_COUNTRY_ERROR = 'Pays de sortie Tor non autorisé. Choisis un pays de la liste.';

function isTorExitCountry(value) {
  return typeof value === 'string' && Object.hasOwn(TOR_EXIT_COUNTRIES, value);
}

// 'AUTO' lets Tor choose the exit; it is a selection, never an ISO country code.
const TOR_EXIT_AUTO = 'AUTO';

function isTorExitSelection(value) {
  return value === TOR_EXIT_AUTO || isTorExitCountry(value);
}

function assertTorExitCountry(value) {
  if (!isTorExitSelection(value)) throw new TypeError(TOR_EXIT_COUNTRY_ERROR);
  return value;
}

// Settings saved before this list existed used lowercase codes ("gb", "de").
// Only stored values pass through here; IPC input must use assertTorExitCountry.
function migrateStoredTorCountry(value) {
  if (typeof value !== 'string') return '';
  const code = value.toUpperCase();
  return isTorExitSelection(code) ? code : '';
}

module.exports = { TOR_EXIT_AUTO, isTorExitSelection, TOR_EXIT_COUNTRIES, TOR_EXIT_COUNTRY_ERROR, isTorExitCountry, assertTorExitCountry, migrateStoredTorCountry };
