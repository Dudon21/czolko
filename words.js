const crypto = require("crypto");

const CATEGORIES = {
  zwierzeta: [
    "kot", "pies", "słoń", "żyrafa", "pingwin", "krokodyl", "małpa", "lew", "tygrys", "zebra",
    "wielbłąd", "kangur", "koala", "panda", "sowa", "papuga", "żółw", "ślimak", "jeż", "wiewiórka",
    "lis", "wilk", "niedźwiedź", "królik", "chomik", "koń", "krowa", "świnia", "owca", "koza",
    "kura", "kaczka", "gęś", "bocian", "orzeł", "rekin", "delfin", "wieloryb", "ośmiornica", "meduza",
    "krab", "homar", "pająk", "mrówka", "pszczoła", "motyl", "biedronka", "komar", "żaba", "wąż",
    "jaszczurka", "hipopotam", "nosorożec", "flaming", "struś", "foka", "mors", "bóbr", "kret", "nietoperz"
  ],
  przedmioty: [
    "parasol", "telefon", "lodówka", "pralka", "odkurzacz", "czajnik", "widelec", "łyżka", "nóż", "talerz",
    "kubek", "krzesło", "stół", "łóżko", "poduszka", "kołdra", "lampa", "zegar", "budzik", "klucz",
    "zamek", "drzwi", "okno", "lustro", "szczoteczka do zębów", "grzebień", "nożyczki", "ołówek", "długopis", "gumka",
    "linijka", "plecak", "walizka", "portfel", "okulary", "kapelusz", "czapka", "szalik", "rękawiczki", "but",
    "skarpeta", "koszulka", "spodnie", "rower", "hulajnoga", "samochód", "samolot", "statek", "pociąg", "rakieta",
    "gitara", "pianino", "bęben", "trąbka", "piłka", "deskorolka", "latawiec", "balon", "świeczka", "pilot do telewizora",
    "telewizor", "komputer", "klawiatura", "myszka komputerowa", "słuchawki", "aparat", "mikrofon", "drabina", "młotek", "śrubokręt"
  ],
  zawody: [
    "lekarz", "nauczyciel", "strażak", "policjant", "kucharz", "piekarz", "fryzjer", "listonosz", "kierowca", "pilot",
    "astronauta", "programista", "sprzedawca", "kelner", "rolnik", "weterynarz", "dentysta", "pielęgniarka", "aktor", "piosenkarz",
    "malarz", "fotograf", "dziennikarz", "sędzia", "prawnik", "architekt", "mechanik", "elektryk", "hydraulik", "stolarz",
    "krawiec", "ogrodnik", "rybak", "górnik", "żołnierz", "marynarz", "kosmonauta", "bibliotekarz", "ratownik", "trener",
    "piłkarz", "tancerz", "magik", "klaun", "detektyw", "naukowiec", "archeolog", "kominiarz", "pszczelarz", "youtuber"
  ],
  postacie: [
    "Shrek", "Batman", "Superman", "Spider-Man", "Harry Potter", "Myszka Miki", "Kaczor Donald", "Kubuś Puchatek", "Pinokio", "Kopciuszek",
    "Królewna Śnieżka", "Czerwony Kapturek", "Smerf", "Reksio", "Bolek", "Lolek", "Pippi", "Sherlock Holmes", "Święty Mikołaj", "Pikachu",
    "Mario", "Sonic", "Gandalf", "Frodo", "Darth Vader", "Yoda", "Hulk", "Iron Man", "Kapitan Ameryka", "Thor",
    "Elsa", "Olaf", "Simba", "Nemo", "Dora", "Scooby-Doo", "Garfield", "Homer Simpson", "SpongeBob", "Asterix",
    "Kot w butach", "Piotruś Pan", "Tarzan", "Robin Hood", "Zorro", "Dracula", "Frankenstein", "Smok Wawelski", "Pan Kleks", "Muminek"
  ]
};

const ALL_WORDS = [...new Set(Object.values(CATEGORIES).flat())];

function randomWords(count, exclude = []) {
  const amount = Math.max(0, Math.min(10, Number(count) || 0));
  const excluded = new Set(
    (Array.isArray(exclude) ? exclude : [])
      .filter((word) => typeof word === "string")
      .map((word) => word.trim().toLocaleLowerCase("pl"))
  );
  const available = ALL_WORDS.filter((word) => !excluded.has(word.toLocaleLowerCase("pl")));
  const picked = [];
  while (picked.length < amount && available.length > 0) {
    const index = crypto.randomInt(available.length);
    picked.push(available.splice(index, 1)[0]);
  }
  return picked;
}

module.exports = { CATEGORIES, randomWords };
