const crypto = require("crypto");

const CATEGORIES = {
  chelsea: [
    "Cole Palmer", "Enzo Fernández", "Moisés Caicedo", "Marc Cucurella", "Frank Lampard",
    "Didier Drogba", "John Terry", "Eden Hazard", "N'Golo Kanté", "José Mourinho", "Roman Abramowicz"
  ],
  liverpool: [
    "Mohamed Salah", "Virgil van Dijk", "Alisson Becker", "Florian Wirtz", "Alexander Isak",
    "Dominik Szoboszlai", "Jürgen Klopp", "Steven Gerrard", "Jerzy Dudek", "Luis Suárez",
    "Fernando Torres"
  ],
  arsenal: [
    "Bukayo Saka", "Martin Ødegaard", "Declan Rice", "William Saliba", "Viktor Gyökeres",
    "Mikel Arteta", "Thierry Henry", "Arsène Wenger"
  ],
  premierLeague: [
    "Erling Haaland", "Pep Guardiola", "Kevin De Bruyne", "Phil Foden", "Bruno Fernandes",
    "Marcus Rashford", "Harry Kane", "Son Heung-min", "Wayne Rooney", "David Beckham", "Alex Ferguson"
  ],
  barcelona: [
    "Lamine Yamal", "Pedri", "Gavi", "Raphinha", "Frenkie de Jong", "Marc-André ter Stegen",
    "Hansi Flick", "Xavi", "Andrés Iniesta", "Ronaldinho", "Carles Puyol", "Neymar", "Gerard Piqué"
  ],
  realMadryt: [
    "Kylian Mbappé", "Vinícius Júnior", "Jude Bellingham", "Federico Valverde", "Thibaut Courtois",
    "Trent Alexander-Arnold", "Carlo Ancelotti", "Luka Modrić", "Toni Kroos", "Sergio Ramos",
    "Zinedine Zidane", "Iker Casillas", "Karim Benzema"
  ],
  pilkaNozna: [
    "Robert Lewandowski", "Leo Messi", "Cristiano Ronaldo", "Wojciech Szczęsny", "Piotr Zieliński",
    "Jakub Błaszczykowski", "Zbigniew Boniek", "Pelé", "Diego Maradona", "Zlatan Ibrahimović"
  ],
  tenis: [
    "Iga Świątek", "Hubert Hurkacz", "Magda Linette", "Magdalena Fręch", "Maja Chwalińska",
    "Agnieszka Radwańska", "Jannik Sinner", "Carlos Alcaraz", "Novak Djoković", "Aryna Sabalenka",
    "Coco Gauff", "Daniil Miedwiediew", "Alexander Zverev", "Roger Federer", "Rafael Nadal",
    "Serena Williams", "Andy Murray"
  ],
  starWars: [
    "Darth Vader", "Luke Skywalker", "Księżniczka Leia", "Han Solo", "Chewbacca", "Yoda",
    "Obi-Wan Kenobi", "Anakin Skywalker", "Imperator Palpatine", "R2-D2", "C-3PO", "Boba Fett",
    "Jabba", "Darth Maul", "Kylo Ren", "Grogu", "Mandalorianin", "Szturmowiec", "Jar Jar Binks"
  ],
  polska: [
    "Karol Nawrocki", "Donald Tusk", "Andrzej Duda", "Jarosław Kaczyński", "Rafał Trzaskowski",
    "Sławomir Mentzen", "Szymon Hołownia", "Grzegorz Braun", "Mateusz Morawiecki", "Lech Wałęsa",
    "Józef Piłsudski", "Jan Paweł II", "Mieszko I", "Bolesław Chrobry", "Kazimierz Wielki",
    "Tadeusz Kościuszko", "Mikołaj Kopernik", "Maria Skłodowska-Curie", "Fryderyk Chopin",
    "Adam Mickiewicz", "Juliusz Słowacki", "Henryk Sienkiewicz", "Janosik", "Pan Tadeusz",
    "Smok Wawelski", "Geralt z Rivii", "Ferdynand Kiepski"
  ],
  polskieGwiazdy: [
    "Robert Makłowicz", "Magda Gessler", "Kuba Wojewódzki", "Krzysztof Ibisz", "Martyna Wojciechowska",
    "Doda", "Maryla Rodowicz", "Krzysztof Krawczyk", "Zenek Martyniuk", "Dawid Podsiadło", "Sanah",
    "Mata", "Quebonafide", "Taco Hemingway", "Adam Małysz", "Kamil Stoch", "Mariusz Pudzianowski",
    "Robert Kubica", "Justyna Kowalczyk", "Marcin Gortat"
  ],
  filmyIBajki: [
    "Harry Potter", "Hermiona Granger", "Ron Weasley", "Lord Voldemort", "Dumbledore", "Gandalf",
    "Frodo", "Gollum", "James Bond", "Jack Sparrow", "Indiana Jones", "Joker", "Sherlock Holmes",
    "Shrek", "Kubuś Puchatek", "Myszka Miki", "SpongeBob", "Homer Simpson", "Elsa", "Simba",
    "Scooby-Doo", "Reksio", "Krecik", "Świnka Peppa"
  ],
  superbohaterowie: [
    "Batman", "Superman", "Spider-Man", "Iron Man", "Kapitan Ameryka", "Thor", "Hulk", "Thanos",
    "Deadpool"
  ],
  swiat: [
    "Albert Einstein", "Napoleon", "Kleopatra", "Juliusz Cezar", "Leonardo da Vinci", "Elon Musk",
    "Bill Gates", "Steve Jobs", "Donald Trump", "Władimir Putin", "Królowa Elżbieta II",
    "Michael Jackson", "Freddie Mercury", "Taylor Swift", "Eminem", "Rihanna", "Leonardo DiCaprio",
    "Brad Pitt", "Keanu Reeves", "Dwayne Johnson", "Mr Bean", "Michael Jordan", "Usain Bolt",
    "Mike Tyson", "Lewis Hamilton", "Mario", "Pikachu"
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
