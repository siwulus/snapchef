---
project: Snapchef
version: 4
status: draft
created: 2026-05-26
updated: 2026-06-15
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: Snapchef

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Adaptacja 2026-06-14: FR-004 rozszerzone o wieloetapowe rozpoznanie (per zdjęcie → prezentacja per zdjęcie → scalenie/konsolidacja w jedną odduplikowaną listę); FR-005 edytuje finalną skonsolidowaną listę. Zmiana mieści się w istniejącym slice S-01 — bez nowych slice'ów ani zmian w grafie zależności. PRD OQ7 (reguła deduplikacji) otwarte i śledzone jako non-blocking Unknown w S-01.
> Adaptacja 2026-06-15: PRD FR-013 (reset zapomnianego hasła) dodane — domyka pełny flow autentykacji. Nowe foundation **F-03** (Stream B, obok F-02); ortogonalne do pionu produktowego (S-01–S-04 i graf zależności bez zmian). Bez nowych Open Questions.
> Edit-in-place; archive when superseded. Poprzednia wersja: `context/foundation/archive/2026-05-26-roadmap.md`.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Snapchef rozwiązuje codzienny problem domowego kucharza: ma produkty, nie ma pomysłu na danie. Wyróżnik produktu (jego **wedge** — jedyna cecha, której wycięcie sprawiłoby, że aplikacja przestaje być Snapchefem) to **rozpoznawanie produktów ze zdjęć zamiast ręcznego spisywania** połączone z generacją przepisu dopasowaną do swobodnie opisanego kontekstu posiłku. MVP celuje wąsko: autor + kilka osób z otoczenia, prywatne dane per-user, pełny flow end-to-end bez ręcznych obejść.

## North star

**S-02: Generacja przepisu z rozpoznanej listy produktów i kontekstu posiłku** — najmniejszy slice, który dowodzi rdzennej hipotezy produktu (foto → rozpoznanie → przepis działa na danych autora). Wszystko poniżej (zapis sesji, readback) ma sens tylko jeśli ten flow daje wartościowy wynik.

> "North star" tutaj oznacza: najmniejszy end-to-end przepływ, którego dowiezienie udowadnia, że produkt działa — uszeregowany tak wcześnie, jak pozwalają Prerequisites, bo reszta roadmapy ma sens tylko jeśli ten flow daje wynik.

## At a glance

| ID   | Change ID                    | Outcome (user can …)                                                                                              | Prerequisites | PRD refs                                      | Status |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------- | ------ |
| F-01 | domain-schema-and-storage    | (foundation) per-user domain tables + RLS + Storage bucket na zdjęcia                                             | —             | NFR-Prywatność, FR-009, Access Control        | ready  |
| F-02 | email-verification-gating    | (foundation) weryfikacja emaila wymagana do aktywacji konta                                                       | —             | FR-001                                        | ready  |
| F-03 | password-reset               | Zresetować zapomniane hasło przez link wysłany na email i ustawić nowe hasło                                      | F-02          | FR-013, Access Control                        | ready  |
| S-01 | photo-upload-and-recognition | Wgrać 1–5 zdjęć (≤5 MB), zobaczyć rozpoznanie per zdjęcie i finalną skonsolidowaną listę [nazwa, ilość] do edycji | F-01, F-02    | FR-001, FR-002, FR-003, FR-004, FR-005, US-01 | ready  |
| S-02 | recipe-generation-from-list  | Podać kontekst posiłku i zobaczyć przepis (nazwa + składniki + instrukcje)                                        | S-01          | FR-006, FR-007, FR-008, US-01                 | ready  |
| S-03 | save-session-and-recipe      | Zapisać przepis razem z kontekstem sesji (zdjęcia, lista, opis) na koncie                                         | S-02          | FR-009, US-01                                 | ready  |
| S-04 | saved-recipes-readback       | Zobaczyć listę zapisanych przepisów, otworzyć szczegóły, usunąć z potwierdzeniem                                  | S-03          | FR-010, FR-011, FR-012                        | ready  |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives w grafie zależności poniżej.

| Stream | Theme                      | Chain                                      | Note                                                                                 |
| ------ | -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| A      | Dane i prywatność per-user | `F-01` → `S-01` → `S-02` → `S-03` → `S-04` | Główny pion produktu; w `S-01` dołącza się wymóg zweryfikowanego konta ze Streamu B. |
| B      | Domknięcie autentykacji    | `F-02` → `F-03`                            | Weryfikacja emaila (F-02) + reset hasła (F-03); domknięcie tożsamości i dostępu.     |

## Baseline

What's already in place w codebase as of 2026-05-26 (auto-researched + user-confirmed; aktualizacja: Auth zdegradowany do PARTIAL po doprecyzowaniu FR-001).

- **Frontend:** PARTIAL — Astro 6.3.7 + React 19.2.6 + Tailwind 4 + shadcn/ui zainicjalizowany ([components.json](components.json)); tylko `button` dodany; auth UI obecne w [src/components/auth/](src/components/auth/); ekrany feature (upload, recipe, lista przepisów) jeszcze nie istnieją.
- **Backend / API:** PARTIAL — `@astrojs/cloudflare` + `output:"server"` ([astro.config.mjs](astro.config.mjs)); endpointy auth pod [src/pages/api/auth/](src/pages/api/auth/); brak `src/lib/services/`.
- **Data:** PARTIAL — klient Supabase SSR ([src/lib/supabase.ts](src/lib/supabase.ts)); jedyna migracja to smoke-test ([supabase/migrations/20260525171800_initial_smoke_test.sql](supabase/migrations/20260525171800_initial_smoke_test.sql)); brak tabel domenowych i bucketu Storage.
- **Auth:** PARTIAL — email+password sign-in/up/out i middleware ([src/middleware.ts](src/middleware.ts)) z `locals.user` + gate na `/dashboard` działają (FR-002 ✓). FR-001 wymaga weryfikacji emaila przed aktywacją konta — **nie jest jeszcze wpięta** (Supabase email confirmations + ekrany "potwierdź email" / "konto nieaktywne"). Patrz F-02.
- **Deploy / infra:** PARTIAL — Cloudflare Workers ([wrangler.jsonc](wrangler.jsonc)); CI lint+build na main ([.github/workflows/ci.yml](.github/workflows/ci.yml)); produkcyjny deploy własnością Cloudflare Workers Builds; `SUPABASE_URL`/`SUPABASE_KEY` zadeklarowane w `astro:env`.
- **Observability:** PARTIAL — flaga `observability` aktywna w `wrangler.jsonc`; brak loggera / Sentry; `wrangler tail` dostępny do live debugu. Wystarczające dla MVP per `main_goal: speed`.

## Foundations

### F-01: Schemat domeny + Storage bucket z RLS

- **Outcome:** (foundation) tabele domenowe (`recipes`, `recipe_sessions`, ewentualnie `recognized_items`) wraz z politykami RLS per-operacja/per-rola; bucket Supabase Storage na zdjęcia produktów z polityką "owner-only read/write". Wszystko additive/nullable, kompatybilne wstecz z poprzednią wersją Workera.
- **Change ID:** domain-schema-and-storage
- **PRD refs:** NFR-Prywatność (privacy guardrail), FR-009 (zapis sesji), Access Control
- **Unlocks:** S-01 (Storage do uploadu), S-02 (referencje do zdjęć w prompt'cie), S-03 (zapis sesji), S-04 (czytanie/usuwanie własnych przepisów); redukuje ryzyko cross-user data leak we wszystkich slice'ach.
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Privacy NFR jest launch-gating — pomyłka w RLS daje cichy wyciek. Sequencing F-01 przed jakimkolwiek slice'em domenowym wymusza zaprojektowanie polityk raz, zanim cokolwiek je konsumuje. Pojedyncza warstwa danych zamiast iteracyjnego rozszerzania schematu w każdym slice'ie — tańsze przy `main_goal: speed`.
- **Status:** ready

### F-02: Weryfikacja emaila gate'ująca aktywację konta

- **Outcome:** (foundation) Supabase Auth wymusza potwierdzenie emaila przed aktywacją konta; nieaktywny użytkownik nie może się zalogować (czytelny komunikat); rejestracja zwraca ekran "wysłaliśmy link na email"; po kliknięciu link aktywuje konto i prowadzi do logowania. Email/template dostosowane do języka produktu.
- **Change ID:** email-verification-gating
- **PRD refs:** FR-001 (doprecyzowany 2026-05-26: weryfikacja wymagana od v1)
- **Unlocks:** S-01 (i wszystkie kolejne) — gwarancja, że "zalogowany użytkownik" w US-01 to konto faktycznie należące do osoby kontrolującej email; redukuje ryzyko rejestracji na cudze adresy.
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mała powierzchnia (toggle w Supabase + 2 ekrany), ale pominięcie przed S-01 oznacza, że pierwsi użytkownicy zakładają konta bez weryfikacji i trzeba je później audytować. Sequencing przed slice'ami produktowymi wymusza domknięcie polityki tożsamości raz, zanim pojawią się dane domenowe powiązane z `auth.users.id`.
- **Status:** ready

### F-03: Reset zapomnianego hasła

- **Outcome:** (foundation) Użytkownik, który zapomniał hasła, odzyskuje dostęp samodzielnie: inicjuje reset podając adres email konta, otrzymuje na ten adres link umożliwiający ustawienie nowego hasła i po jego ustawieniu loguje się przy użyciu nowego hasła. Ekrany: formularz "podaj email" → potwierdzenie "wysłaliśmy link" → formularz "ustaw nowe hasło" (z linka) → przejście do logowania. Email/template w języku produktu (reuse infrastruktury mailowej z F-02).
- **Change ID:** password-reset
- **PRD refs:** FR-013 (reset zapomnianego hasła), Access Control (self-service recovery)
- **Unlocks:** — (domyka pełny flow autentykacji: rejestracja + weryfikacja emaila → logowanie / wylogowanie → odzyskanie dostępu; nie jest prerequisitem żadnego slice'a produktowego)
- **Prerequisites:** F-02 (reuse konfiguracji wysyłki maili + szablonów w języku produktu; spójny model zweryfikowanego konta)
- **Parallel with:** S-01–S-04 (ortogonalne do pionu produktowego ze Streamu A — można dowieźć niezależnie)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mała powierzchnia (Supabase Auth recovery flow + 2–3 ekrany; reuse szablonu/wysyłki z F-02). Pominięcie nie blokuje pionu produktowego, ale zostawia użytkownika z zapomnianym hasłem trwale odciętego od prywatnych danych — luka w domknięciu autentykacji. Do rozważenia w `/10x-plan`: brak ujawniania, czy konto istnieje przy żądaniu resetu (standard anty-enumeracyjny), oraz czas ważności linka resetującego.
- **Status:** ready

## Slices

### S-01: Foto upload (1–5 zdjęć × ≤5 MB), rozpoznanie per zdjęcie i skonsolidowana lista produktów

- **Outcome:** Zweryfikowany, zalogowany użytkownik wgrywa od 1 do 5 zdjęć produktów (każde ≤5 MB; przekroczenie → czytelny błąd). Rozpoznanie przebiega trójetapowo (FR-004): (a) **per zdjęcie** — system rozpoznaje widoczne pozycje wraz z szacowaną ilością, **jednoznacznie** (jeden produkt na pozycję, bez alternatyw typu "cytryna lub limonka"); (b) **prezentacja per zdjęcie** — każde zdjęcie wraz z rozpoznanymi na nim pozycjami [nazwa, ilość] (czytelny zapis/log rozpoznania); (c) **scalenie i konsolidacja** — wyniki ze wszystkich zdjęć łączone w jedną finalną listę z usunięciem duplikatów z nakładających się zdjęć (ten sam produkt uchwycony na kilku zdjęciach nie jest liczony wielokrotnie). Na finalnej, skonsolidowanej liście użytkownik może poprawić nazwę/ilość, usunąć pozycję, dodać produkt spoza zdjęć (FR-005). Sesja zapisywana progresywnie w bazie ze `state` lifecycle (`photos_uploaded → products_recognized`); edycja listy pozostaje client-side do S-03. _(Sesja in-memory zastąpiona persystowaną sesją — decyzja #4, 2026-06-06; rozpoznanie rozszerzone o etapy per zdjęcie + konsolidację — PRD FR-004, 2026-06-14.)_
- **Change ID:** photo-upload-and-recognition
- **PRD refs:** FR-001, FR-002 (auth gate'owane przez F-02), FR-003 (limity 1–5 × 5 MB), FR-004 (rozpoznanie per zdjęcie + prezentacja per zdjęcie + scalenie/konsolidacja; jednoznaczność per pozycja), FR-005 (edycja finalnej listy), US-01 (kroki 1–3)
- **Prerequisites:** F-01 (Storage bucket), F-02 (zweryfikowane konto)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Reguła rozstrzygania konfliktu ilości w etapie konsolidacji (FR-004c): kiedy dwie pozycje z różnych zdjęć to ten sam produkt i jak ustalić finalną ilość (te same sztuki sfotografowane dwukrotnie vs. dwie odrębne porcje na różnych zdjęciach). — Owner: właściciel produktu. Block: no (PRD OQ7; FR-004c określa cel — usunięcie duplikatów — a reguła rozstrzygania konfliktu to detal do doprecyzowania w `/10x-plan`, nie blokuje planowania).
- **Risk:** Pierwszy realny test integracji z multimodalnym LLM — czas odpowiedzi musi się mieścić w NFR ~30 s. Rozpoznanie jest teraz wieloetapowe (do 5 rozpoznań per zdjęcie + etap scalenia/konsolidacji), co zwiększa presję na budżet czasowy — całość operacji rozpoznania musi nadal mieścić się w NFR; loader/feedback obowiązkowy (NFR widoczny feedback >2 s). Reguła deduplikacji (OQ7) nierozstrzygnięta, ale non-blocking — domyślne zachowanie do doprecyzowania w `/10x-plan`. Walidacja limitów (5 zdjęć, 5 MB) musi być po stronie serwera, nie tylko klienta. Bez tego slice'a north-star jest nieosiągalny.
- **Status:** ready

### S-02: Generacja przepisu z listy i kontekstu posiłku _(north star)_

- **Outcome:** Po zaakceptowaniu finalnej (skonsolidowanej) listy produktów użytkownik wpisuje swobodny opis kontekstu posiłku (jedno pole tekstowe — typ posiłku, styl, smaki, ograniczenia razem) i otrzymuje wygenerowany przepis: **nazwa dania + lista składników z ilościami + instrukcja krok po kroku**. Bez servings / czasu / poziomu trudności (per FR-008). Decyduje, czy zapisać (przekazanie do S-03) czy odrzucić.
- **Change ID:** recipe-generation-from-list
- **PRD refs:** FR-006 (free-text kontekst), FR-007 (generacja z listy + kontekstu), FR-008 (minimalny format), US-01 (kroki 4–5)
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** To jest validation milestone — gdy ten slice działa na danych autora, rdzenna hipoteza Snapchefa jest udowodniona. Druga zależność od LLM (z constraintem na produkty z listy — detal promptu, nie roadmapy). Zmieszczenie się w NFR ~30 s na tym kroku jest krytyczne; jeśli przekroczymy, trzeba będzie rozważyć streaming lub model swap (poza zakresem tej roadmapy, ale wpływa na timing).
- **Status:** ready

### S-03: Zapis sesji i przepisu na koncie

- **Outcome:** Użytkownik klika "zapisz" na wygenerowanym przepisie. Istniejący wiersz `recipe_sessions` jest finalizowany (UPDATE `state = 'saved'`), skorygowana lista i kontekst są zapisywane, a przepis ląduje w tabeli `recipes` — całość dostępna tylko właścicielowi. _(S-03 to finalizacja istniejącej sesji, nie pierwszy insert — decyzja #4, 2026-06-06.)_
- **Change ID:** save-session-and-recipe
- **PRD refs:** FR-009, US-01 (krok 6)
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwsze realne testowanie polityk RLS z F-01 na ścieżce write. Jeśli baseline RLS jest źle skonfigurowany, ten slice to ujawni — celowo wcześniej niż dopiero w S-04 (read path), żeby błąd kosztował mniej.
- **Status:** ready

### S-04: Lista, szczegóły i usunięcie zapisanych przepisów

- **Outcome:** Użytkownik widzi listę swoich zapisanych przepisów (płaską, bez filtrów per PRD Non-Goals), otwiera szczegóły wybranego, oraz usuwa przepis po explicit confirm-dialog (hard-delete, bez undo).
- **Change ID:** saved-recipes-readback
- **PRD refs:** FR-010, FR-011, FR-012
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Read-path test polityk RLS z F-01: lista MUSI zwracać tylko własne przepisy. Confirm-dialog na delete jest twardy per FR-012 (zaakceptowane Counter-argument w PRD). Slice zamyka pętlę MVP — po nim Success Criteria primary jest spełnione.
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                                          | Ready for `/10x-plan` | Notes                                                   |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------- |
| F-01       | domain-schema-and-storage    | Schemat domeny + Storage bucket z RLS dla danych użytkownika                   | yes                   | `/10x-plan domain-schema-and-storage`                   |
| F-02       | email-verification-gating    | Weryfikacja emaila wymagana do aktywacji konta                                 | yes                   | `/10x-plan email-verification-gating`                   |
| F-03       | password-reset               | Reset zapomnianego hasła (link na email → ustaw nowe hasło)                    | yes (po F-02)         | `/10x-plan password-reset`                              |
| S-01       | photo-upload-and-recognition | Upload zdjęć (1–5 × ≤5 MB) + rozpoznanie per zdjęcie + scalenie listy + edycja | yes (po F-01, F-02)   | `/10x-plan photo-upload-and-recognition`                |
| S-02       | recipe-generation-from-list  | Generacja przepisu z listy produktów i kontekstu posiłku                       | yes (po S-01)         | **North star.** `/10x-plan recipe-generation-from-list` |
| S-03       | save-session-and-recipe      | Zapis pełnej sesji (zdjęcia + lista + przepis) na koncie                       | yes (po S-02)         | `/10x-plan save-session-and-recipe`                     |
| S-04       | saved-recipes-readback       | Lista zapisanych przepisów + szczegóły + usuwanie z confirmem                  | yes (po S-03)         | `/10x-plan saved-recipes-readback`                      |

## Open Roadmap Questions

Brak otwartych pytań na poziomie całej roadmapy. Pierwotne 6 Open Questions z PRD v1 zostało rozstrzygniętych przez właściciela produktu (2026-05-26) i wprowadzonych do FR / frontmatter PRD; per-slice Unknowns z tamtej iteracji zostały zdjęte wraz z tymi decyzjami.

Nowe **OQ7** (reguła deduplikacji w etapie konsolidacji, FR-004c), wprowadzone 2026-06-14, jest **slice-scoped** — dotyczy wyłącznie S-01 — więc śledzone jest jako non-blocking Unknown w S-01, a nie jako pytanie roadmap-wide. Block: no (nie blokuje sekwencjonowania ani planowania S-01).

## Parked

- **Robienie zdjęć kamerą z poziomu aplikacji** — Why parked: PRD §Non-Goals (zaawansowane mobilne flow poza zakresem v1).
- **Iteracyjna pętla feedbacku przy generacji przepisu** — Why parked: PRD §Non-Goals (jednorazowa generacja w MVP; doprecyzowanie przez rozmowę → v2).
- **Współdzielenie przepisów między użytkownikami / social sharing** — Why parked: PRD §Non-Goals (single-tenant).
- **Integracja z zewnętrznymi blogami kulinarnymi i bazami przepisów** — Why parked: PRD §Non-Goals (wyłącznie generacja w MVP).
- **Filtrowanie / wyszukiwanie / kategoryzacja listy zapisanych przepisów** — Why parked: PRD §Non-Goals (lista płaska; target_scale: small).
- **Tracking "ugotowane / nieugotowane"** — Why parked: PRD §Non-Goals.
- **Soft-delete / undo dla usunięcia przepisu** — Why parked: PRD §Non-Goals (hard-delete po confirm-dialog).
- **Strukturalne pola kontekstu posiłku (typ/styl/smaki jako selecty)** — Why parked: PRD FR-006 zrewidowany na rzecz jednego pola free-text; mniej tarcia, LLM interpretuje.
- **Multi-result na generacji przepisu** — Why parked: PRD FR-007 Counter-argument odrzucony — single result w MVP.
- **Servings / czas przygotowania / poziom trudności w wyjściu przepisu** — Why parked: FR-008 zrewidowany na minimum (nazwa + składniki + instrukcja); metadane → v2.
- **Sygnalizacja niepewności rozpoznania per pozycja ("cytryna lub limonka")** — Why parked: FR-004 zrewidowany na jednoznaczność — korekta przez edycję listy (FR-005).
- **Rich observability (Sentry, strukturalny logger)** — Why parked: `main_goal: speed` + wystarczy `wrangler tail` + flaga observability w wrangler.jsonc dla MVP; promocja do v2 jeśli pojawi się produkcyjny incident.

## Done

(Empty on first generation. `/10x-archive` appends entries here when a change whose `Change ID` matches a roadmap item is archived.)
