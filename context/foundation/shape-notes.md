---
project: Snapchef
context_type: greenfield
updated: 2026-05-19
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 12
  quality_check_status: accepted
---

## Vision & Problem Statement

Codzienny problem osoby gotującej w domu: ma w lodówce i szafkach jakiś zbiór produktów, ale nie ma pomysłu na ciekawe danie z tego, co już posiada. Kończy się to gotowaniem w kółko tych samych potraw, których ma dość, albo marnowaniem produktów, które się psują niezużyte.

Istniejące alternatywy (spisanie produktów ręcznie i konwersacja z ChatGPT, klasyczne apki typu SuperCook / Whisk) są na tyle uciążliwe w fazie inwentaryzacji — pisanie produktu po produkcie na telefonie w kuchni — że proces zostaje porzucony, zanim dojdzie do rekomendacji. Pain ma trzy nakładające się warstwy: **decision paralysis** ("co dziś ugotować?"), **workflow friction** (spisywanie wszystkiego ręcznie) oraz **food waste** (produkty się marnują, bo nie wiem, jak je zużyć).

**Insight** odróżniający Snapchef od istniejących rozwiązań:
1. **Foto zamiast listy** — multimodalny LLM rozpoznaje produkty bezpośrednio ze zdjęć lodówki/szafek, eliminując etap ręcznego spisywania.
2. **Iteracyjny dialog z aplikacją** — przepis nie jest statycznym jednorazowym wynikiem; użytkownik doprecyzowuje go w rozmowie, aż pasuje.
3. **Personalizacja kontekstem posiłku** — nie tylko "co mam", ale też "jaki posiłek, jaki styl kuchni, jakie smaki" — wynik dopasowany do okazji, nie tylko do składników.

## User & Persona

**Primary persona: domowy kucharz-amator (autor projektu + bliskie otoczenie).**

Osoba gotująca codziennie dla siebie / rodziny, mająca w domu zmienny zestaw produktów, ceniąca różnorodność smaków i chcąca ograniczyć marnowanie żywności. Komputer/telefon ma pod ręką, ale w kuchni — woli interakcję wymagającą minimum wpisywania. MVP świadomie celuje wąsko: jeden użytkownik (autor) i kilka osób z otoczenia, bez ambicji skalowania na początku.

## Access Control

Autentykacja: login po **emailu + haśle**. Konto wymagane do wszystkich akcji aplikacji — zarówno przesyłania zdjęć / generowania przepisów, jak i przeglądania zapisanych przepisów. Wszystkie dane (zdjęcia, rozpoznane produkty, przepisy) są **prywatne per użytkownik** i wymagają autoryzacji do odczytu.

Model ról: **płaska struktura** — brak rozróżnienia admin / user. Każdy użytkownik widzi wyłącznie własne dane.

## Success Criteria

### Primary

Użytkownik przechodzi pełny flow end-to-end: loguje się, wgrywa zdjęcia produktów, akceptuje/koryguje rozpoznaną listę, podaje kontekst posiłku, otrzymuje wygenerowany przepis i zapisuje go. Później jest w stanie wyświetlić zapisany przepis lub go usunąć. Sukces = ten przebieg działa od początku do końca, na własnych danych autora, bez ręcznych obejść.

### Secondary

Brak. v1 robi tylko to, co konieczne — żadnych nice-to-have w MVP.

### Guardrails

- **Prywatność danych**: zdjęcia, rozpoznane produkty i przepisy jednego użytkownika nie są widoczne ani dostępne dla innych użytkowników. Każda operacja odczytu / zapisu wymaga autoryzacji właściciela danych.

## Functional Requirements

### Authentication

- FR-001: Użytkownik może utworzyć konto (email + hasło). Priority: must-have
  > Socrates: Counter-argument considered: "rejestracja zbędna w MVP z jednym hardcoded userem" — odrzucone; per-user data od dnia 1 jest fundamentem prywatności.
- FR-002: Użytkownik może zalogować się i wylogować. Priority: must-have
  > Socrates: Counter-argument considered: "logout zbędny / sesja powinna być trwała" — odrzucone; standardowy mechanizm sesji jest wystarczający.

### Image ingestion & product recognition

- FR-003: Zalogowany użytkownik może wgrać 1–N zdjęć produktów przez formularz upload. Priority: must-have
  > Socrates: Counter-argument considered: "tylko 1 zdjęcie / problemy z dużymi plikami HEIC" — odrzucone; 1–N pozostaje, walidacja formatu/wielkości jest detalem implementacyjnym.
- FR-004: System rozpoznaje na zdjęciach produkty wraz z szacowaną ilością i prezentuje listę [nazwa, ilość]. Priority: must-have
  > Socrates: Counter-argument considered: "ilość ze zdjęcia jest nierzetelna / halucynacje produktów" — odrzucone; FR-005 (edycja listy) łapie błędy rozpoznania, więc imperfect output jest akceptowalny.
- FR-005: Użytkownik może edytować rozpoznaną listę: poprawić nazwę / ilość, usunąć pozycję, dodać produkt spoza zdjęć. Priority: must-have
  > Socrates: Counter-argument considered: "edycja komplikuje UI / brak dodawania poza zdjęciami" — odrzucone; bez ręcznego dodania soli/oliwy/przypraw rekomendacja byłaby nierealistyczna.

### Recipe generation

- FR-006: Użytkownik może podać kontekst posiłku jako swobodny opis tekstowy (free-text, np. "obiad w stylu śródziemnomorskim, lekki, bez ostrych przypraw"). Priority: must-have
  > Socrates: Counter-argument considered: "3 osobne pola select to za dużo tarcia" — **zaakceptowane i FR zrewidowane**: zamiast strukturalnych pól typ/styl/smaki, jedno pole tekstowe; LLM sam interpretuje. Mniej pracy implementacyjnej i bardziej elastyczne.
- FR-007: System generuje propozycję przepisu na bazie zaakceptowanej listy produktów i kontekstu posiłku. Priority: must-have
  > Socrates: Counter-argument considered: "LLM zignoruje listę i wymyśli składniki / 1 wynik to za mało" — odrzucone; constraint na produkty z listy jest detalem promptu, multi-result trafia do v2.
- FR-008: Użytkownik widzi wygenerowany przepis (składniki + instrukcje) i decyduje, czy go zapisać. Priority: must-have
  > Socrates: Counter-argument considered: "brak 'odrzuć i regeneruj' / brakuje servings/czasu" — odrzucone; w scope-down nie ma regeneracji, format przepisu jest detalem promptu.

### Recipe persistence

- FR-009: Użytkownik może zapisać wygenerowany przepis razem z kontekstem wejściowym sesji (zdjęcia, rozpoznana / skorygowana lista produktów, opis kontekstu posiłku) na swoim koncie. Priority: must-have
  > Socrates: Counter-argument considered: "zapisuj też wejście dla reprodukcji sesji" — **zaakceptowane i FR zrewidowane**: zapis obejmuje całą sesję (input + output), żeby user mógł później zrozumieć / zreprodukować skąd wziął się przepis.
- FR-010: Użytkownik może wyświetlić listę swoich zapisanych przepisów. Priority: must-have
  > Socrates: Counter-argument considered: "bez filtrów lista staje się bezużyteczna przy skali" — odrzucone w MVP (target_scale: small); filtrowanie/preview do v2.
- FR-011: Użytkownik może wyświetlić szczegóły zapisanego przepisu. Priority: must-have
  > Socrates: Counter-argument considered: "powinno być 'mark as cooked'" — odrzucone; tracking gotowania to nice-to-have, nie blokuje MVP.
- FR-012: Użytkownik może usunąć zapisany przepis, po explicit potwierdzeniu (confirm dialog). Priority: must-have
  > Socrates: Counter-argument considered: "bez potwierdzenia / undo user przypadkiem skasuje" — **zaakceptowane i FR zrewidowane**: dodano wymóg confirm-dialog przed hard-delete. Soft-delete / undo nie wchodzi w MVP.

## User Stories

### US-01: Pierwsza udana sesja generowania przepisu

**Given** zalogowany użytkownik ma przed sobą produkty w lodówce i nie ma pomysłu na obiad,
**When** robi zdjęcia produktów, wgrywa je do aplikacji, akceptuje / koryguje rozpoznaną listę, wskazuje że szuka obiadu w stylu śródziemnomorskim,
**Then** otrzymuje propozycję przepisu wykorzystującą rozpoznane produkty, dopasowaną do wskazanego stylu, i może zapisać przepis do późniejszego użytku.

## Business Logic

Aplikacja generuje przepis kulinarny dopasowany do rzeczywiście posiadanych przez użytkownika produktów (rozpoznanych ze zdjęć i ewentualnie skorygowanych) oraz subiektywnego opisu kontekstu posiłku.

**Wejście użytkownika**: zestaw zdjęć produktów + (po rozpoznaniu i edycji) lista [nazwa, ilość] + swobodny opis kontekstu posiłku (typ posiłku, styl, smaki, ograniczenia — wszystko w jednym polu tekstowym).

**Wyjście aplikacji**: jeden przepis kulinarny zawierający składniki (z listy lub powszechnie dostępne dodatki) i instrukcję wykonania, dopasowany do opisanego kontekstu.

**Jak user encountuje regułę w flow**: po wgraniu zdjęć i akceptacji listy produktów oraz po wpisaniu opisu kontekstu, użytkownik widzi wygenerowany przepis na ekranie. Reguła jest istotą produktu — bez niej aplikacja byłaby tylko galerią zdjęć z notatką tekstową.

## Non-Functional Requirements

- **Prywatność danych**: dane (zdjęcia, rozpoznane listy, przepisy) jednego użytkownika nie są dostępne dla innych użytkowników w żadnej operacji aplikacji. Każda operacja odczytu wymaga autoryzacji właściciela.
- **Doświadczenie mobilne**: aplikacja jest wygodna w użyciu na telefonie trzymanym w kuchni — UI dostosowuje się do ekranu mobilnego (responsywność), kluczowe akcje są dostępne bez zoomu i bez poziomego scrollu.
- **Czas odpowiedzi przy operacjach LLM**: rozpoznanie produktów ze zdjęć i wygenerowanie przepisu kończą się dla użytkownika w okolicach 30 sekund od momentu inicjacji każdej z operacji (przy normalnych warunkach sieci).
- **Widoczny feedback podczas oczekiwania**: dla każdej operacji trwającej dłużej niż ~2 sekundy użytkownik widzi ciągłą wizualną informację, że trwa przetwarzanie (loader / progres / komunikat).
- **Podstawowa dostępność**: kontrast tekstu i elementów interaktywnych spełnia minimalny próg, elementy formularzy mają etykiety zrozumiałe dla czytników ekranowych.
- **Wsparcie nowoczesnych przeglądarek**: aplikacja działa poprawnie w aktualnej i poprzedniej wersji Chrome, Safari, Firefox i Edge (desktop i mobile).

## Non-Goals

- **Brak robienia zdjęć kamerą z poziomu aplikacji**: w MVP wyłącznie upload plików przez formularz. Zaawansowane mobilne flow (camera API, integracja z natywnym pickerem) poza zakresem v1.
- **Brak iteracyjnej pętli feedbacku przy generacji przepisu**: jednorazowa generacja na wejście; doprecyzowanie wyniku przez rozmowę z LLM zostaje na v2 (oryginalny krok 7 z idei świadomie wycięty w fazie 3).
- **Brak współdzielenia przepisów między użytkownikami i sharingu na social media**: aplikacja jest ściśle single-tenant, każdy widzi wyłącznie własne dane.
- **Brak integracji z zewnętrznymi blogami kulinarnymi i third-party API z przepisami**: w MVP wyłącznie generacja przez LLM, bez własnej bazy lub łączenia z gotowymi źródłami przepisów.

## Open Questions

- Weryfikacja emaila przy rejestracji — czy wymagana od v1, czy dopiero później? (Wpływa na pracę implementacyjną i UX rejestracji.)
- Format wyjściowy przepisu — czy zawiera servings / czas / poziom trudności, czy minimum (składniki + instrukcja)?
- Limit wielkości i liczby zdjęć w jednej sesji uploadu — do ustalenia w fazie implementacji.
- Confidence threshold rozpoznawania produktów — czy LLM ma sygnalizować niepewność per pozycja (np. "może być cytryna lub limonka"), czy zawsze deklaruje jednoznacznie?

## Quality cross-check

Wszystkie elementy bramki jakości obecne — `quality_check_status: accepted`.

- Access Control: present
- Business Logic (one-sentence rule): present
- Project artifacts: present
- Timeline-cost: present (mvp_weeks = 3, w progu, bez osobnego acknowledgment)
- Non-Goals: present (4 entries)
- Preserved behavior: n/a (greenfield)

## Forward: tech-stack

(Informacyjnie — przekazane do `/10x-tech-stack-selector`, NIE część PRD.)

Z idea-doc wynika kierunkowo:

- Aplikacja webowa z responsywnym UI (działa na desktop i mobile bez rozróżnienia natywnego mobile).
- Moduł rozpoznawania produktów ze zdjęć: bazuje na multimodalnym LLM.
- Moduł generowania przepisu: bazuje na LLM.
- Architektoniczna intencja autora: dwa moduły (rozpoznawanie obrazów / generacja przepisów) jako **niezależne paczki o dobrze zdefiniowanym kontrakcie**, z możliwością wymiany implementacji w sposób transparentny dla reszty aplikacji.

Stack-shaped decyzje (framework, baza, dostawca LLM, hosting, CI/CD) są celowo NIE ustalone w fazie shaping i czekają na `/10x-tech-stack-selector`.
