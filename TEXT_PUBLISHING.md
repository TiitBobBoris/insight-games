# Tekstide avaldamine

Staatus: teostus vajab enne productionisse viimist serveri saladuste seadistamist ja päris Verceli otspunkti kontrolli.

„Salvesta muudatused“ avab avaldatava lihtteksti eelvaate ja küsib omaniku avaldamisvõtit. Ainult selles redaktoris muudetud tekstid saadetakse serverisse. Mängude localStorage'i sisu ei saadeta. Brauseris säilivad seni avaldamata tekstid eraldi `insightGamesPublishDraftV1` võtmes; mänguandmete kustutamine neid ei kustuta.

Server salvestab `published-texts.json` faili GitHubi main-harus. Muudatused on versiooniajaloos taastatavad. Külastaja loeb avaldatud tekste serverist lehe avamisel ja brauseriaknasse naasmisel; kogu rakenduse järgmist deploy'd pole vaja oodata. Juba avatud aktiivne leht ei uuene ise taustal. Vana brauseri kohalik tekst ei varjuta avaldatud sama algteksti muudatust; avaldamata parandused jäävad nende omaniku brauseris eelisjärjekorda.

## Ühekordne seadistus

Lisa Verceli `eluvaldkonnad` projekti Production keskkonnamuutujad:

- `TEXTS_GITHUB_TOKEN`: GitHubi fine-grained token ainult `TiitBobBoris/insight-games` repositooriumile, Contents read/write õigusega. Ära lisa seda vestlusse, lähtekoodi ega brauserisse.
- `TEXTS_PUBLISH_KEY`: vähemalt 32 märgi pikkune juhuslik saladus (soovitatav 32 juhuslikku baiti). Omanik hoiab seda paroolihalduris ning sisestab avaldamisel. Seda ei salvestata brauseri localStorage'i.

Pärast seadistamist deploy uus kood. Preview-keskkonda ära anna productioni kirjutamisõigust: testimiseks kasuta eraldi lahendust või mock-teste. Server puuduvate saladustega ei avalda midagi ega väljasta ekslikku õnnestumist.

## Kontroll enne kasutuselevõttu

1. Muuda avalehe tekst, ava eelvaade ning katkesta: production ei tohi muutuda.
2. Vale avaldamisvõti peab jätma kohaliku paranduse alles.
3. Õige võtmega avaldamine peab olema nähtav teises brauseris pärast lehe avamist.
4. Kahe samaaegse redaktori konflikt peab andma veateate, mitte teise muudatust üle kirjutama.
5. Mänguvastused peavad jääma ainult oma brauserisse.

`npm test` kontrollib autentimist, sisendi valideerimist, riknenud faili säilitamist, revision-konflikti, avaldamist ja uut lugemist, lihttekstina renderdamist ning mänguandmete eraldatust. Päris productioni autentimise ja salvestuse kontroll jääb serveri seadistuse taha.

Piirangud: avaldamisel kaob muudetud lõigu HTML-vormindus; tekst rakendub sama algtekstiga kohtadele selle vaate sees. Vanad kohaliku redaktori muudatused ei lähe automaatselt üles: ava soovitud lõik ja muuda seda. GitHubi või võrgu tõrke puhul jäävad kasutusele rakenduse senised tekstid; avaldamise tulemust ei väideta kinnitatuks. Tokeni õigused piirduvad repoga, kuid GitHub ei võimalda Contents tokenit piirata ainult ühe failiga. Avaldamisvõtme vahetus toimub Verceli seadetes ja nõuab uut deploy'd.

Tehniline alus: [Verceli Node.js funktsioonid](https://vercel.com/docs/functions/runtimes/node-js) ja [GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).
