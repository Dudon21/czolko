const crypto = require("crypto");

const CATEGORIES = {
  bajki: [
    "Shrek", "Osioł ze Shreka", "Kot w Butach", "Myszka Miki", "Kaczor Donald", "Goofy", "Kubuś Puchatek",
    "Prosiaczek", "Tygrysek", "Kłapouchy", "SpongeBob", "Patryk Rozgwiazda", "Homer Simpson",
    "Bart Simpson", "Scooby-Doo", "Królik Bugs", "Kot Tom", "Pinokio", "Kopciuszek", "Śpiąca Królewna",
    "Królewna Śnieżka", "Czerwony Kapturek", "Smerfetka", "Papa Smerf", "Gargamel", "Elsa", "Olaf",
    "Simba", "Mufasa", "Pumba", "Timon", "Nemo", "Dory", "Buzz Astral", "Chudy",
    "Zygzak McQueen", "Pikachu", "Świnka Peppa", "Bolek i Lolek", "Reksio", "Krecik", "Miś Uszatek",
    "Pszczółka Maja", "Muminek", "Piotruś Pan", "Kapitan Hak", "Dzwoneczek",
    "Aladyn", "Dżin z lampy", "Mała Syrenka", "Bestia", "Garfield", "Snoopy", "Asterix", "Obelix",
    "Minionek", "Gru", "Kung Fu Panda", "Stich"
  ],
  filmy: [
    "Harry Potter", "Hermiona Granger", "Ron Weasley", "Lord Voldemort", "Dumbledore", "Hagrid",
    "Gandalf", "Frodo", "Gollum", "Darth Vader", "Luke Skywalker", "Yoda", "Chewbacca", "R2-D2",
    "James Bond", "Jack Sparrow", "Indiana Jones", "Rocky Balboa", "Terminator", "Rambo", "Forrest Gump",
    "King Kong", "Godzilla", "Drakula", "Frankenstein", "E.T.", "Kevin sam w domu", "Joker", "Batman",
    "Superman", "Spider-Man", "Iron Man", "Kapitan Ameryka", "Thor", "Hulk", "Thanos", "Wonder Woman",
    "Deadpool", "Wolverine", "Sherlock Holmes", "Robin Hood", "Tarzan", "Zorro", "Mr Bean", "Mario",
    "Sonic", "Lara Croft", "Geralt z Rivii", "Św. Mikołaj"
  ],
  slawni: [
    "Albert Einstein", "Isaac Newton", "Leonardo da Vinci", "Napoleon", "Kleopatra", "Juliusz Cezar",
    "Krzysztof Kolumb", "Szekspir", "Mozart", "Beethoven", "Picasso", "Elon Musk", "Bill Gates", "Steve Jobs",
    "Mark Zuckerberg", "Donald Trump", "Barack Obama", "Królowa Elżbieta II", "Papież Franciszek",
    "Michael Jackson", "Elvis Presley", "Freddie Mercury", "Madonna", "Taylor Swift", "Rihanna",
    "Beyoncé", "Eminem", "Justin Bieber", "Lady Gaga", "Ed Sheeran", "Leonardo DiCaprio", "Brad Pitt",
    "Angelina Jolie", "Tom Cruise", "Johnny Depp", "Keanu Reeves", "Will Smith", "Dwayne Johnson",
    "Arnold Schwarzenegger", "Jackie Chan", "Charlie Chaplin", "Marilyn Monroe", "Kim Kardashian",
    "MrBeast"
  ],
  sport: [
    "Leo Messi", "Cristiano Ronaldo", "Robert Lewandowski", "Neymar", "Kylian Mbappé", "Pelé",
    "Diego Maradona", "Zlatan Ibrahimović", "David Beckham", "Iga Świątek", "Roger Federer",
    "Rafael Nadal", "Serena Williams", "Michael Jordan", "LeBron James", "Usain Bolt", "Mike Tyson",
    "Muhammad Ali", "Lewis Hamilton", "Adam Małysz", "Mariusz Pudzianowski", "Robert Kubica"
  ],
  polska: [
    "Mikołaj Kopernik", "Maria Skłodowska-Curie", "Fryderyk Chopin", "Adam Mickiewicz", "Jan Paweł II",
    "Lech Wałęsa", "Józef Piłsudski", "Mieszko I", "Smok Wawelski", "Janosik", "Pan Twardowski",
    "Syrenka Warszawska", "Robert Makłowicz", "Magda Gessler", "Doda", "Maryla Rodowicz",
    "Krzysztof Krawczyk", "Zenek Martyniuk", "Dawid Podsiadło", "Ferdynand Kiepski", "Andrzej Duda",
    "Donald Tusk"
  ]
};

const ALL_WORDS = [...new Set(Object.values(CATEGORIES).flat())];
const LISTED = new Set(ALL_WORDS.map((word) => word.toLocaleLowerCase("pl")));

function isListedWord(text) {
  return LISTED.has(String(text).trim().toLocaleLowerCase("pl"));
}

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

module.exports = { CATEGORIES, randomWords, isListedWord };
