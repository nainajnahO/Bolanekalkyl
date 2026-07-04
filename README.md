# Bolånekalkyl

https://nainajnaho.github.io/Bolanekalkyl/

En kalkylator för att utforska hur ett bolån utvecklas över åren. Ändra ett värde
och se direkt hur skulden, månadskostnaden och den totala räntekostnaden påverkas.
Räntan och amorteringen kan ändras vid valfria år ("3,5 % nu, 4,5 % från år 3"),
och flera scenarier kan jämföras sida vid sida i samma diagram. Allt sparas i
webbläsaren. Utseendet är Windows 98 — med flit.

Varje scenario kan också visa ett räntespann: ange lägsta och högsta förväntade
ränta, så ritas ett skuggat band i kostnadsdiagrammen. Bandets kanter är bästa
och sämsta möjliga utfall — så länge räntan håller sig inom spannet håller sig
kostnaden inom bandet, varje månad. Går räntebanan utanför spannet lämnar
linjen bandet — det är med avsikt: då motsäger banan dina egna förväntningar.
Det är alltså inte ett sannolikhetsintervall — det säger inget om vad som är
troligt, bara om gränserna. Skulden och slutbetalningsdatumet påverkas inte av
räntan: amorteringen styrs av lagkravet eller din egen plan, och räntan läggs
aldrig på skulden.

## Reglerna som kalkylatorn räknar med

Kalkylatorn utgår som standard från de svenska bolåneregler som gäller enligt
lagen från den 1 april 2026 (kontrollerade 2026-07-04). Alla regelvärden —
bolånetaket, amorteringskravets gränser och nivåer samt ränteavdraget — kan
ändras i appen under "Regler". Kalkylatorn visar en tydlig markering när
värdena avviker från lagens nivåer.

### Bolånetak

Du får låna högst 90 % av bostadens värde — minst 10 % ska vara kontantinsats.
Kalkylatorn varnar om lånet är över 90 % men hindrar dig inte från att räkna på det.

Taket på 80 % för att *utöka ett befintligt* bolån ingår inte i kalkylen,
som utgår från ett nytt lån vid köp.

### Amorteringskrav

Kravet beror på belåningsgraden (skulden delat med bostadens värde) och räknas
per år som andel av det ursprungliga lånebeloppet:

| Belåningsgrad | Amorteringskrav per år |
| --- | --- |
| över 70 % | 2 % |
| 50–70 % | 1 % |
| under 50 % | inget krav |

Det tidigare skärpta kravet — 1 % extra vid lån över 4,5 gånger bruttoinkomsten —
är avskaffat sedan den 1 april 2026 och används inte i kalkylen.

I läget "Egen plan" kan du amortera hur du vill. Ligger planen under lagkravet
visas en varning, men beräkningen stoppas inte.

### Ränteavdrag

Du får tillbaka 30 % av räntekostnaden i skatteavdrag, upp till 100 000 kr i
räntekostnad per person och år. På belopp över det är avdraget 21 %. Gränsen
gäller per låntagare: två som delar räntan ger 200 000 kr, fyra ger
400 000 kr. Avdraget förutsätter att varje låntagare faktiskt betalar sin del
av räntan — ställ in antalet efter hur ni delar den, inte hur många som står
på lånet. Kalkylatorn visar månadskostnaden netto, alltså efter avdraget.

Avdraget för lån *utan* säkerhet togs bort 2026, men bolån med bostaden som
säkerhet behåller avdraget.

## Förenklingar

- Amorteringskravet räknas om varje månad utifrån aktuell skuld och ett konstant
  bostadsvärde. I verkligheten omvärderar banker bostaden högst vart femte år,
  så kravet sänks stegvis snarare än löpande.
- Lånet antas starta i januari.
- Ränteavdraget antas inte begränsas av hur mycket skatt du faktiskt betalar.
- Månadskostnaden avser bara lånet. Avgift, drift och försäkring ingår inte.

## Friskrivning

Det här är ett planeringsverktyg, inte finansiell rådgivning. Siffrorna är
förenklade och kan avvika från din banks beräkning. Stäm alltid av med din bank
och Skatteverket innan du fattar beslut.

## Köra och bygga

```
npm install
npm run dev      # utvecklingsserver på localhost
npm run build    # statisk sajt i dist/, kan läggas på valfritt webbhotell
```

## Källor

Kontrollerade 2026-07-04:

- [Regeringen — höjt bolånetak och slopat skärpt amorteringskrav](https://www.regeringen.se/pressmeddelanden/2025/12/forslag-pa-hojt-bolanetak-och-slopande-av-skarpt-amorteringskrav/)
- [Finansinspektionen — föreskrifterna upphävs, lag tar över](https://www.fi.se/sv/publicerat/nyheter/2026/fi-upphaver-foreskrifter-och-allmanna-rad-om-bolan--lag-tar-over/)
- [Konsumenternas — nya amorteringsregler](https://www.konsumenternas.se/arkiv---nyheter-bloggar-och-poddar/nyheter/2026/mars/nya-amorteringsregler/)
