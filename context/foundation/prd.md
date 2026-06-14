---
project: Snapchef
version: 1
status: draft
created: 2026-05-20
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Codzienny problem osoby gotującej w domu: ma w lodówce i szafkach jakiś zbiór produktów, ale nie ma pomysłu na ciekawe danie z tego, co już posiada. Kończy się to gotowaniem w kółko tych samych potraw, których ma dość, albo marnowaniem produktów, które się psują niezużyte. Istniejące alternatywy (spisanie produktów ręcznie i konwersacja z asystentem konwersacyjnym, klasyczne apki typu SuperCook / Whisk) są na tyle uciążliwe w fazie inwentaryzacji — pisanie produktu po produkcie na telefonie w kuchni — że proces zostaje porzucony, zanim dojdzie do rekomendacji.

Pain ma trzy nakładające się warstwy: **decision paralysis** ("co dziś ugotować?"), **workflow friction** (spisywanie wszystkiego ręcznie) oraz **food waste** (produkty się marnują, bo nie wiem, jak je zużyć). Insight odróżniający Snapchef: (1) foto zamiast listy — rozpoznanie produktów bezpośrednio ze zdjęć lodówki/szafek eliminuje etap ręcznego spisywania; (2) iteracyjny dialog z aplikacją — przepis nie jest statycznym jednorazowym wynikiem; użytkownik doprecyzowuje go w rozmowie, aż pasuje (intencja długoterminowa; w MVP wycięte na rzecz jednorazowej generacji — patrz Non-Goals); (3) personalizacja kontekstem posiłku — nie tylko "co mam", ale też "jaki posiłek, jaki styl kuchni, jakie smaki".

## User & Persona

**Primary persona: domowy kucharz-amator (autor projektu + bliskie otoczenie).**

Osoba gotująca codziennie dla siebie / rodziny, mająca w domu zmienny zestaw produktów, ceniąca różnorodność smaków i chcąca ograniczyć marnowanie żywności. Komputer/telefon ma pod ręką, ale w kuchni — woli interakcję wymagającą minimum wpisywania. MVP świadomie celuje wąsko: jeden użytkownik (autor) i kilka osób z otoczenia, bez ambicji skalowania na początku.

## Success Criteria

### Primary

- Użytkownik przechodzi pełny flow end-to-end: loguje się, wgrywa zdjęcia produktów, akceptuje/koryguje rozpoznaną listę, podaje kontekst posiłku, otrzymuje wygenerowany przepis i zapisuje go. Później jest w stanie wyświetlić zapisany przepis lub go usunąć.
- Sukces = ten przebieg działa od początku do końca, na własnych danych autora, bez ręcznych obejść.

### Secondary

- Brak. v1 robi tylko to, co konieczne — żadnych nice-to-have w MVP.

### Guardrails

- **Prywatność danych**: zdjęcia, rozpoznane produkty i przepisy jednego użytkownika nie są widoczne ani dostępne dla innych użytkowników. Każda operacja odczytu / zapisu wymaga autoryzacji właściciela danych.

## User Stories

### US-01: Pierwsza udana sesja generowania przepisu

- **Given** zalogowany użytkownik ma przed sobą produkty w lodówce i nie ma pomysłu na obiad,
- **When** robi zdjęcia produktów, wgrywa je do aplikacji, akceptuje / koryguje rozpoznaną listę, wskazuje że szuka obiadu w stylu śródziemnomorskim,
- **Then** otrzymuje propozycję przepisu wykorzystującą rozpoznane produkty, dopasowaną do wskazanego stylu, i może zapisać przepis do późniejszego użytku.

#### Acceptance Criteria

- Wgranie 1–5 zdjęć kończy się: prezentacją rozpoznania per zdjęcie (każde zdjęcie wraz z rozpoznanymi na nim pozycjami [nazwa, ilość]) oraz finalną, skonsolidowaną listą [nazwa, ilość] scaloną ze wszystkich zdjęć, bez zduplikowanych pozycji wynikających z nakładania się zdjęć.
- Użytkownik może zmodyfikować finalną (skonsolidowaną) listę przed generacją przepisu (edycja nazwy/ilości, usunięcie pozycji, dodanie produktu spoza zdjęć).
- Wygenerowany przepis zawiera składniki i instrukcje wykonania, dopasowane do podanego kontekstu posiłku.
- Zapisany przepis jest później dostępny do podglądu na koncie użytkownika.

## Functional Requirements

### Authentication

- FR-001: Użytkownik może utworzyć konto (email + hasło). Rejestracja wymaga weryfikacji emaila — konto pozostaje nieaktywne (logowanie zablokowane) do momentu potwierdzenia adresu przez link wysłany na email. Priority: must-have
  > Socratic: Counter-argument considered: "rejestracja zbędna w MVP z jednym hardcoded userem" — odrzucone; per-user data od dnia 1 jest fundamentem prywatności. Weryfikacja emaila wymagana od v1 (decyzja użytkownika, OQ1) — zapobiega rejestracji na cudze adresy i jest standardową praktyką zaufania.
- FR-002: Użytkownik może zalogować się i wylogować. Priority: must-have
  > Socratic: Counter-argument considered: "logout zbędny / sesja powinna być trwała" — odrzucone; standardowy mechanizm sesji jest wystarczający.

### Image ingestion & product recognition

- FR-003: Zalogowany użytkownik może wgrać od 1 do 5 zdjęć produktów w jednej sesji uploadu, każde do 5 MB. Próba wgrania pliku przekraczającego limit kończy się czytelnym komunikatem o błędzie. Priority: must-have
  > Socratic: Counter-argument considered: "tylko 1 zdjęcie / problemy z dużymi plikami HEIC" — odrzucone; 1–5 pozostaje. Limity (5 zdjęć × 5 MB) ustalone przez użytkownika (OQ3) — kompromis między pokryciem typowej szafki a kosztem przetwarzania.
- FR-004: System rozpoznaje produkty na wgranych zdjęciach w trzech etapach. (a) **Rozpoznanie per zdjęcie**: dla każdego wgranego w FR-003 zdjęcia system rozpoznaje widoczne produkty wraz z ich szacowaną ilością; każda pozycja jest deklarowana jednoznacznie (jeden produkt na pozycję) — system nie zwraca alternatyw typu "cytryna lub limonka". (b) **Prezentacja per zdjęcie**: system prezentuje dla każdego zdjęcia parę — samo zdjęcie oraz rozpoznane na nim pozycje [nazwa, ilość] — czytelny zapis (log) tego, co zostało rozpoznane na danym zdjęciu. (c) **Scalenie i konsolidacja**: po przetworzeniu wszystkich zdjęć system scala wyniki ze wszystkich zdjęć w jedną finalną listę, usuwając potencjalne duplikaty wynikające z nakładania się zdjęć (ten sam produkt uchwycony na kilku zdjęciach nie jest liczony wielokrotnie). Wynikiem jest finalne podsumowanie rozpoznania — skonsolidowana lista [nazwa, ilość], która stanowi wejście do edycji w FR-005. Priority: must-have
  > Socratic: Counter-argument considered: "ilość ze zdjęcia jest nierzetelna / halucynacje produktów / sygnalizacja niepewności per pozycja" — odrzucone; FR-005 (edycja listy) łapie błędy rozpoznania, więc imperfect output i jednoznaczna deklaracja są akceptowalne. Decyzja jednoznaczności potwierdzona przez użytkownika (OQ4) — prostszy UX, korekta przez edycję. Etap konsolidacji (c) jest konieczny, bo kilka zdjęć może częściowo pokrywać te same produkty; bez deduplikacji finalna lista byłaby zmultiplikowana (ten sam produkt policzony tyle razy, na ilu zdjęciach się pojawił). Reguła rozstrzygania konfliktu ilości przy deduplikacji pozostaje do doprecyzowania — patrz OQ7.
- FR-005: Użytkownik może edytować finalną (skonsolidowaną) listę rozpoznanych produktów z FR-004c: poprawić nazwę / ilość, usunąć pozycję, dodać produkt spoza zdjęć. Priority: must-have
  > Socratic: Counter-argument considered: "edycja komplikuje UI / brak dodawania poza zdjęciami" — odrzucone; bez ręcznego dodania soli/oliwy/przypraw rekomendacja byłaby nierealistyczna. Edycja operuje na finalnej liście po scaleniu (FR-004c), a nie na pojedynczych per-zdjęciowych rozpoznaniach.

### Recipe generation

- FR-006: Użytkownik może podać kontekst posiłku jako swobodny opis tekstowy (free-text, np. "obiad w stylu śródziemnomorskim, lekki, bez ostrych przypraw"). Priority: must-have
  > Socratic: Counter-argument considered: "3 osobne pola select to za dużo tarcia" — **zaakceptowane i FR zrewidowane**: zamiast strukturalnych pól typ/styl/smaki, jedno pole tekstowe; mniej pracy implementacyjnej i bardziej elastyczne.
- FR-007: System generuje propozycję przepisu na bazie zaakceptowanej listy produktów i kontekstu posiłku. Priority: must-have
  > Socratic: Counter-argument considered: "system zignoruje listę i wymyśli składniki / 1 wynik to za mało" — odrzucone; constraint na produkty z listy jest detalem implementacyjnym, multi-result trafia do v2.
- FR-008: Użytkownik widzi wygenerowany przepis i decyduje, czy go zapisać. Minimalny format przepisu obejmuje: nazwę dania, listę składników (z ilościami) oraz instrukcję wykonania krok po kroku. Bez dodatkowych metadanych (servings / czas / poziom trudności). Priority: must-have
  > Socratic: Counter-argument considered: "brak 'odrzuć i regeneruj' / brakuje servings/czasu/trudności" — odrzucone; w scope-down nie ma regeneracji. Minimalny format (nazwa + składniki + instrukcja) potwierdzony przez użytkownika (OQ2) — metadane (servings/czas/trudność) trafiają do v2.

### Recipe persistence

- FR-009: Użytkownik może zapisać wygenerowany przepis razem z kontekstem wejściowym sesji (zdjęcia, rozpoznana / skorygowana lista produktów, opis kontekstu posiłku) na swoim koncie. Priority: must-have
  > Socratic: Counter-argument considered: "zapisuj też wejście dla reprodukcji sesji" — **zaakceptowane i FR zrewidowane**: zapis obejmuje całą sesję (input + output), żeby user mógł później zrozumieć / zreprodukować skąd wziął się przepis.
- FR-010: Użytkownik może wyświetlić listę swoich zapisanych przepisów. Priority: must-have
  > Socratic: Counter-argument considered: "bez filtrów lista staje się bezużyteczna przy skali" — odrzucone w MVP (target_scale: small); filtrowanie/preview do v2.
- FR-011: Użytkownik może wyświetlić szczegóły zapisanego przepisu. Priority: must-have
  > Socratic: Counter-argument considered: "powinno być 'mark as cooked'" — odrzucone; tracking gotowania to nice-to-have, nie blokuje MVP.
- FR-012: Użytkownik może usunąć zapisany przepis, po explicit potwierdzeniu (confirm dialog). Priority: must-have
  > Socratic: Counter-argument considered: "bez potwierdzenia / undo user przypadkiem skasuje" — **zaakceptowane i FR zrewidowane**: dodano wymóg confirm-dialog przed hard-delete. Soft-delete / undo nie wchodzi w MVP.

## Non-Functional Requirements

- **Prywatność danych**: dane (zdjęcia, rozpoznane listy, przepisy) jednego użytkownika nie są dostępne dla innych użytkowników w żadnej operacji aplikacji. Każda operacja odczytu wymaga autoryzacji właściciela.
- **Doświadczenie mobilne**: aplikacja jest wygodna w użyciu na telefonie trzymanym w kuchni — UI dostosowuje się do ekranu mobilnego (responsywność), kluczowe akcje są dostępne bez zoomu i bez poziomego scrollu.
- **Czas odpowiedzi przy długich operacjach**: rozpoznanie produktów ze zdjęć oraz wygenerowanie przepisu kończą się dla użytkownika w okolicach 30 sekund od momentu inicjacji każdej z operacji, przy normalnych warunkach sieci.
- **Widoczny feedback podczas oczekiwania**: dla każdej operacji trwającej dłużej niż ~2 sekundy użytkownik widzi ciągłą wizualną informację o trwającym przetwarzaniu.
- **Podstawowa dostępność**: kontrast tekstu i elementów interaktywnych spełnia minimalny próg, elementy formularzy mają etykiety zrozumiałe dla czytników ekranowych.
- **Wsparcie nowoczesnych przeglądarek**: aplikacja działa poprawnie w aktualnej i poprzedniej wersji czterech mainstreamowych przeglądarek desktopowych i mobilnych (Chrome, Safari, Firefox, Edge).

## Business Logic

**Aplikacja generuje przepis kulinarny dopasowany do rzeczywiście posiadanych przez użytkownika produktów oraz do swobodnego opisu kontekstu posiłku.**

**Wejście użytkownika**: zestaw zdjęć produktów + (po rozpoznaniu per zdjęcie, scaleniu w jedną skonsolidowaną listę i edycji) lista [nazwa, ilość] + swobodny opis kontekstu posiłku (typ posiłku, styl, smaki, ograniczenia — wszystko w jednym polu tekstowym).

**Wyjście aplikacji**: jeden przepis kulinarny zawierający nazwę dania, listę składników z ilościami (z listy lub powszechnie dostępne dodatki) oraz instrukcję wykonania krok po kroku, dopasowany do opisanego kontekstu.

**Jak user encountuje regułę w flow**: po wgraniu zdjęć, przejrzeniu rozpoznania per zdjęcie i akceptacji finalnej (skonsolidowanej) listy produktów oraz po wpisaniu opisu kontekstu, użytkownik widzi wygenerowany przepis na ekranie. Reguła jest istotą produktu — bez niej aplikacja byłaby tylko galerią zdjęć z notatką tekstową.

## Access Control

Autentykacja: login po **emailu + haśle**. Konto wymagane do wszystkich akcji aplikacji — zarówno przesyłania zdjęć / generowania przepisów, jak i przeglądania zapisanych przepisów. Wszystkie dane (zdjęcia, rozpoznane produkty, przepisy) są **prywatne per użytkownik** i wymagają autoryzacji do odczytu.

Model ról: **płaska struktura** — brak rozróżnienia admin / user. Każdy użytkownik widzi wyłącznie własne dane. Próba dostępu do gated route bez ważnej sesji kończy się przekierowaniem do ekranu logowania.

## Non-Goals

- **Brak robienia zdjęć kamerą z poziomu aplikacji**: w MVP wyłącznie upload plików przez formularz. Zaawansowane mobilne flow (kamera, integracja z natywnym pickerem) poza zakresem v1.
- **Brak iteracyjnej pętli feedbacku przy generacji przepisu**: jednorazowa generacja na wejście; doprecyzowanie wyniku przez rozmowę zostaje na v2 (oryginalny krok 7 z idei świadomie wycięty w fazie shaping).
- **Brak współdzielenia przepisów między użytkownikami i sharingu na social media**: aplikacja jest ściśle single-tenant, każdy widzi wyłącznie własne dane.
- **Brak integracji z zewnętrznymi blogami kulinarnymi i third-party źródłami przepisów**: w MVP wyłącznie generacja, bez własnej bazy lub łączenia z gotowymi źródłami przepisów.
- **Brak filtrowania / wyszukiwania / kategoryzacji listy zapisanych przepisów**: lista jest płaska. Filtry trafiają do v2 (uzasadnione target_scale: small).
- **Brak trackingu "ugotowane / nieugotowane"**: aplikacja nie śledzi, które przepisy zostały już wykonane.
- **Brak soft-delete / undo dla usunięcia przepisu**: skasowanie po confirm-dialogu jest twarde.

## Open Questions

Jedno otwarte pytanie wprowadzone w iteracji rozpoznawania wielozdjęciowego (2026-06-14); pytania z poprzedniej iteracji pozostają rozstrzygnięte:

- OQ7 (scalenie / konsolidacja, FR-004c): Jaką regułą etap konsolidacji rozstrzyga, że pozycje z różnych zdjęć to ten sam produkt, oraz jak ustala finalną ilość, gdy zdjęcia podają różne ilości tego samego produktu (np. te same cytryny sfotografowane dwukrotnie vs. dwie odrębne porcje na dwóch zdjęciach)? — TBD przez właściciela produktu. Block: nie — FR-004c określa cel (usunięcie duplikatów z nakładających się zdjęć); reguła rozstrzygania konfliktu ilości to detal do doprecyzowania przed implementacją etapu konsolidacji.

Rozstrzygnięte wcześniej (właściciel produktu, 2026-05-26):

- ~~OQ1 Weryfikacja emaila~~ → rozstrzygnięte: wymagana od v1 (FR-001).
- ~~OQ2 Format wyjściowy przepisu~~ → rozstrzygnięte: minimum — nazwa + składniki + instrukcja (FR-008, Business Logic).
- ~~OQ3 Limit zdjęć w uploadzie~~ → rozstrzygnięte: do 5 zdjęć, max 5 MB każde (FR-003).
- ~~OQ4 Sygnalizacja niepewności rozpoznania~~ → rozstrzygnięte: zawsze jednoznacznie (FR-004).
- ~~OQ5 `target_scale.qps`~~ → rozstrzygnięte: `low` (frontmatter).
- ~~OQ6 `target_scale.data_volume`~~ → rozstrzygnięte: `small` (frontmatter).
