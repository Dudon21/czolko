const crypto = require("crypto");

const CATEGORIES = {
  chelsea: [
    "Cole Palmer", "Enzo Fernández", "Moisés Caicedo", "Reece James", "Marc Cucurella", "João Pedro",
    "Pedro Neto", "Frank Lampard", "Didier Drogba", "John Terry", "Eden Hazard", "Petr Čech",
    "N'Golo Kanté", "José Mourinho", "Roman Abramowicz"
  ],
  liverpool: [
    "Mohamed Salah", "Virgil van Dijk", "Alisson Becker", "Florian Wirtz", "Alexander Isak",
    "Dominik Szoboszlai", "Alexis Mac Allister", "Cody Gakpo", "Hugo Ekitike", "Arne Slot",
    "Jürgen Klopp", "Steven Gerrard", "Jerzy Dudek", "Luis Suárez", "Fernando Torres"
  ],
  arsenal: [
    "Bukayo Saka", "Martin Ødegaard", "Declan Rice", "William Saliba", "Gabriel Martinelli",
    "Kai Havertz", "Viktor Gyökeres", "David Raya", "Mikel Arteta", "Thierry Henry",
    "Arsène Wenger", "Łukasz Fabiański", "Dennis Bergkamp"
  ],
  premierLeague: [
    "Erling Haaland", "Pep Guardiola", "Phil Foden", "Kevin De Bruyne", "Bruno Fernandes",
    "Marcus Rashford", "Harry Kane", "Son Heung-min", "Wayne Rooney", "David Beckham",
    "Alex Ferguson", "Jamie Vardy"
  ],
  barcelona: [
    "Lamine Yamal", "Pedri", "Gavi", "Raphinha", "Frenkie de Jong", "Pau Cubarsí", "Dani Olmo",
    "Ferran Torres", "Marc-André ter Stegen", "Hansi Flick", "Xavi", "Andrés Iniesta",
    "Ronaldinho", "Carles Puyol", "Neymar", "Gerard Piqué"
  ],
  realMadryt: [
    "Kylian Mbappé", "Vinícius Júnior", "Jude Bellingham", "Federico Valverde", "Thibaut Courtois",
    "Rodrygo", "Antonio Rüdiger", "Trent Alexander-Arnold", "Xabi Alonso", "Carlo Ancelotti",
    "Luka Modrić", "Toni Kroos", "Sergio Ramos", "Zinedine Zidane", "Iker Casillas",
    "Karim Benzema", "Florentino Pérez"
  ],
  pilkaNozna: [
    "Robert Lewandowski", "Leo Messi", "Cristiano Ronaldo", "Wojciech Szczęsny", "Piotr Zieliński",
    "Jakub Błaszczykowski", "Zbigniew Boniek", "Kamil Glik", "Ronaldo Nazário", "Pelé",
    "Diego Maradona", "Zlatan Ibrahimović"
  ],
  tenis: [
    "Iga Świątek", "Hubert Hurkacz", "Magda Linette", "Magdalena Fręch", "Maja Chwalińska",
    "Kamil Majchrzak", "Agnieszka Radwańska", "Wojciech Fibak", "Jerzy Janowicz",
    "Jannik Sinner", "Carlos Alcaraz", "Novak Djoković", "Aryna Sabalenka", "Coco Gauff",
    "Elena Rybakina", "Jessica Pegula", "Mirra Andreeva", "Jasmine Paolini", "Daniil Miedwiediew",
    "Alexander Zverev", "Taylor Fritz", "Ben Shelton", "Roger Federer", "Rafael Nadal",
    "Serena Williams", "Andy Murray", "Naomi Osaka", "Emma Raducanu"
  ],
  starWars: [
    "Darth Vader", "Luke Skywalker", "Księżniczka Leia", "Han Solo", "Chewbacca", "Yoda",
    "Obi-Wan Kenobi", "Anakin Skywalker", "Imperator Palpatine", "R2-D2", "C-3PO", "Boba Fett",
    "Jabba", "Darth Maul", "Kylo Ren", "Rey", "Grogu", "Mandalorianin", "Szturmowiec",
    "Qui-Gon Jinn", "Padmé Amidala", "Jar Jar Binks", "Lando Calrissian", "Ahsoka Tano",
    "Hrabia Dooku", "Mace Windu", "Generał Grievous", "BB-8", "Ewok"
  ],
  polska: [
    "Karol Nawrocki", "Donald Tusk", "Andrzej Duda", "Jarosław Kaczyński", "Rafał Trzaskowski",
    "Sławomir Mentzen", "Szymon Hołownia", "Radosław Sikorski", "Grzegorz Braun", "Mateusz Morawiecki",
    "Lech Wałęsa", "Józef Piłsudski", "Jan Paweł II", "Mieszko I", "Bolesław Chrobry",
    "Kazimierz Wielki", "Tadeusz Kościuszko", "Mikołaj Kopernik", "Maria Skłodowska-Curie",
    "Fryderyk Chopin", "Adam Mickiewicz", "Juliusz Słowacki", "Henryk Sienkiewicz",
    "Wisława Szymborska", "Stanisław Lem", "Andrzej Sapkowski", "Jan Matejko", "Janosik",
    "Pan Tadeusz", "Smok Wawelski", "Geralt z Rivii", "Ferdynand Kiepski"
  ],
  polskieGwiazdy: [
    "Robert Makłowicz", "Magda Gessler", "Kuba Wojewódzki", "Krzysztof Ibisz", "Martyna Wojciechowska",
    "Doda", "Maryla Rodowicz", "Krzysztof Krawczyk", "Zenek Martyniuk", "Dawid Podsiadło", "Sanah",
    "Mata", "Quebonafide", "Taco Hemingway", "Friz", "Książulo",
    "Adam Małysz", "Kamil Stoch", "Mariusz Pudzianowski", "Robert Kubica", "Jan Błachowicz",
    "Bartosz Kurek", "Wilfredo León", "Anita Włodarczyk", "Justyna Kowalczyk", "Marcin Gortat"
  ],
  filmyIBajki: [
    "Harry Potter", "Hermiona Granger", "Ron Weasley", "Lord Voldemort", "Dumbledore",
    "Gandalf", "Frodo", "Gollum", "James Bond", "Jack Sparrow", "Indiana Jones", "Joker",
    "Walter White", "Sherlock Holmes", "Shrek", "Kubuś Puchatek", "Myszka Miki", "SpongeBob",
    "Homer Simpson", "Elsa", "Simba", "Scooby-Doo", "Reksio", "Krecik", "Świnka Peppa"
  ],
  superbohaterowie: [
    "Batman", "Superman", "Spider-Man", "Iron Man", "Kapitan Ameryka", "Thor", "Hulk",
    "Thanos", "Deadpool", "Wolverine"
  ],
  swiat: [
    "Albert Einstein", "Napoleon", "Kleopatra", "Juliusz Cezar", "Leonardo da Vinci",
    "Elon Musk", "Bill Gates", "Steve Jobs", "Mark Zuckerberg", "Donald Trump", "Władimir Putin",
    "Królowa Elżbieta II", "Michael Jackson", "Freddie Mercury", "Taylor Swift", "Eminem",
    "Rihanna", "Leonardo DiCaprio", "Brad Pitt", "Keanu Reeves", "Dwayne Johnson", "Mr Bean",
    "MrBeast", "Michael Jordan", "LeBron James", "Usain Bolt", "Mike Tyson", "Lewis Hamilton",
    "Max Verstappen", "Mario", "Pikachu", "Sonic"
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
