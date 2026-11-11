const SETTINGS = [
  { key: "guessPoints", mode: "czolko", group: "Punkty", label: "Za zgadnięcie hasła", min: 0, max: 10, step: 0.5, value: 1 },
  { key: "passPenalty", mode: "czolko", group: "Punkty", label: "Kara za Pass", min: 0, max: 10, step: 0.5, value: 1 },
  { key: "authorCost", mode: "czolko", group: "Punkty", label: "Koszt odkrycia autora", min: 0, max: 10, step: 0.5, value: 0.5 },
  { key: "helpCost", mode: "czolko", group: "Punkty", label: "Koszt pomocy", min: 0, max: 10, step: 0.5, value: 0 },
  { key: "authorFree", mode: "czolko", group: "Limity na gracza (na całą grę)", label: "Darmowe odkrycia autora (potem płatne)", min: 0, max: 20, step: 1, value: 0 },
  { key: "authorLimit", mode: "czolko", group: "Limity na gracza (na całą grę)", label: "Limit odkryć autora (0 = wyłączone, 99 = bez limitu)", min: 0, max: 99, step: 1, value: 99 },
  { key: "helpFree", mode: "czolko", group: "Limity na gracza (na całą grę)", label: "Darmowe pomoce (potem płatne; ile pomocy w ogóle: „Pomoce na gracza”)", min: 0, max: 20, step: 1, value: 0 },
  { key: "passFree", mode: "czolko", group: "Limity na gracza (na całą grę)", label: "Darmowe passy (potem z karą)", min: 0, max: 20, step: 1, value: 0 },
  { key: "turnSeconds", mode: "czolko", group: "Czas (sekundy)", label: "Tura", min: 10, max: 300, step: 5, value: 45 },
  { key: "voteSeconds", mode: "czolko", group: "Czas (sekundy)", label: "Głosowanie „Zgadłem”", min: 10, max: 120, step: 5, value: 30 },
  { key: "helpSeconds", mode: "czolko", group: "Czas (sekundy)", label: "Rozmowa w pomocy", min: 10, max: 300, step: 5, value: 60 },
  { key: "customChance", mode: "czolko", group: "Losowanie", label: "Szansa na hasło wpisane przez graczy (%)", min: 0, max: 100, step: 5, value: 80 },

  { key: "wavePerfect", mode: "wskazowka", group: "Punkty", label: "Idealnie co do wartości", min: 0, max: 20, step: 1, value: 5 },
  { key: "waveBull", mode: "wskazowka", group: "Punkty", label: "Sam środek", min: 0, max: 10, step: 1, value: 4 },
  { key: "waveNear", mode: "wskazowka", group: "Punkty", label: "Blisko", min: 0, max: 10, step: 1, value: 3 },
  { key: "waveFar", mode: "wskazowka", group: "Punkty", label: "Dalej", min: 0, max: 10, step: 1, value: 2 },
  { key: "wavePsychicMax", mode: "wskazowka", group: "Punkty", label: "Maks. dla podpowiadającego (+1 za każde trafienie blisko)", min: 0, max: 10, step: 1, value: 3 },
  { key: "waveScaleSeconds", mode: "wskazowka", group: "Czas (sekundy)", label: "Wymyślanie skali", min: 15, max: 300, step: 5, value: 60 },
  { key: "waveClueSeconds", mode: "wskazowka", group: "Czas (sekundy)", label: "Podpowiedź", min: 15, max: 300, step: 5, value: 60 },
  { key: "waveGuessSeconds", mode: "wskazowka", group: "Czas (sekundy)", label: "Ustawianie wskazówki", min: 10, max: 300, step: 5, value: 45 },

  { key: "liarSurvive", mode: "klamca", group: "Punkty", label: "Kłamca nie wykryty", min: 0, max: 10, step: 1, value: 3 },
  { key: "liarSaved", mode: "klamca", group: "Punkty", label: "Kłamca złapany, ale zgadł hasło", min: 0, max: 10, step: 1, value: 2 },
  { key: "liarCaughtCrew", mode: "klamca", group: "Punkty", label: "Dla każdego z ekipy, gdy kłamca przegra", min: 0, max: 10, step: 1, value: 1 },
  { key: "liarVoteBonus", mode: "klamca", group: "Punkty", label: "Dodatkowo za głos na kłamcę", min: 0, max: 10, step: 1, value: 0 },
  { key: "liarLaps", mode: "klamca", group: "Przebieg", label: "Maks. kółek (potem kłamca wygrywa)", min: 1, max: 10, step: 1, value: 5 },
  { key: "liarClueSeconds", mode: "klamca", group: "Czas (sekundy)", label: "Na jedno słowo", min: 10, max: 120, step: 5, value: 30 },
  { key: "liarVoteSeconds", mode: "klamca", group: "Czas (sekundy)", label: "Dyskusja i głosowanie po kółku", min: 30, max: 900, step: 10, value: 300 },
  { key: "liarGuessSeconds", mode: "klamca", group: "Czas (sekundy)", label: "Kłamca zgaduje hasło", min: 10, max: 180, step: 5, value: 60 },
  { key: "fiveLives", mode: "piec", group: "Przebieg", label: "Życia na start", min: 1, max: 10, step: 1, value: 3, startOnly: true },
  { key: "fiveStartCards", mode: "piec", group: "Przebieg", label: "Karty na start", min: 0, max: 3, step: 1, value: 1, startOnly: true },
  { key: "fiveCardChance", mode: "piec", group: "Przebieg", label: "Szansa na kartę po zaliczeniu (%)", min: 0, max: 100, step: 5, value: 30 },
  { key: "fiveOwnChance", mode: "piec", group: "Przebieg", label: "Faworyzowanie waszych zadań (% szansy, 0 = równo z WK)", min: 0, max: 100, step: 10, value: 0 },
  { key: "fiveRerolls", mode: "piec", group: "Przebieg", label: "Zmiany zadania na gracza (na całą grę, 99 = bez limitu)", min: 0, max: 99, step: 1, value: 3 },
  { key: "fiveAnswerSeconds", mode: "piec", group: "Czas (sekundy)", label: "Czas na odpowiedź", min: 3, max: 15, step: 1, value: 10 },
  { key: "fiveVoteSeconds", mode: "piec", group: "Czas (sekundy)", label: "Głosowanie: zaliczamy?", min: 5, max: 60, step: 5, value: 20 },
  { key: "liarJudgeSeconds", mode: "klamca", group: "Czas (sekundy)", label: "Ocena strzału kłamcy", min: 10, max: 120, step: 5, value: 30 }
];

const SETTINGS_BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));

function defaultSettings() {
  return Object.fromEntries(SETTINGS.map((setting) => [setting.key, setting.value]));
}

module.exports = { SETTINGS, SETTINGS_BY_KEY, defaultSettings };
