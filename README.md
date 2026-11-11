# Czółko

Imprezowe gry przeglądarkowe dla znajomych. Jedna osoba tworzy pokój, reszta dołącza kodem. Rozmowa głosowa odbywa się poza grą (np. Discord), kamerki są opcjonalne.

## Tryby

- **🙈 Czółko**: zgadujesz hasło, które widzą wszyscy oprócz ciebie.
- **🔮 Wskazówka**: ktoś podpowiada, reszta ustawia wskazówkę na skali.
- **🕵️ Kłamca**: wszyscy znają hasło oprócz kłamcy (od 7 graczy kłamców jest dwóch).
- **⏱️ 5 sekund**: zadanie na czas, głosowanie, życia i tajne karty.
- **🫵 Kto z nas?**: pytanie „kto najprawdopodobniej…”, punkt za głos zgodny z większością.

Po każdej grze wyniki trafiają do tabeli wieczoru, a gracze głosują na następny tryb.

## Uruchomienie

```
npm install
npm start
```

Gra działa pod adresem http://localhost:3000.

## Ustawienia (zmienne środowiskowe)

| Zmienna | Do czego |
| --- | --- |
| `PORT` | Port serwera (domyślnie 3000). |
| `ADMIN_PASSWORD` | Hasło do przejęcia hosta w pokoju. Bez niego logowanie admina jest wyłączone. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Dane serwera LiveKit. Bez nich kamerki są wyłączone. |

Wzór jest w pliku `.env.example`. Hasła nie wpisuj do kodu.

## Testy

```
npm test
```

Uruchamia wszystkie pliki `test/*.test.js`. Testy, które potrzebują serwera, same go włączają.

## Układ kodu

- `server.js`: połączenia, akcje graczy, wysyłka stanu.
- `lib/`: pokój, rejestr pokoi, czat, ustawienia, teksty.
- `modes/`: logika trybów.
- `data/`: hasła, skale, zadania i pytania.
- `public/`: strona (`js/`, `css/`, `index.html`).
- `test/`: testy logiki.

## Wdrożenie (Render)

Po wypchnięciu zmian: Manual Deploy → Deploy latest commit. Otwarte karty same pokażą komunikat o nowej wersji.
