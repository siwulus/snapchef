# Snapchef

## Ogolny pomysl na aplikacje
Często jest tak, że wstajemy rano z łóżka, patrzymy do lodówki, co mamy w domu do jedzenia. Jest tam jakiś zbiór produktów, ale brakuje nam pomysłu na ugotowanie jakiegoś fajnego obiadu, śniadania czy kolacji. DzKonczy się to gotowaniem tych samych potraw, które jemy już do znudzenia i których mamy powoli serdecznie dość.
Oczywiście, moglibyśmy spisać listę produktów, którą posiadamy, wrzucić to do internetu albo do czata i zacząć konwersację o nowym, smacznym daniu, które można by ugotować z posiadanych produktów.Niemniej proces taki jest dość bolesny, ponieważ trzeba wylistować, co posiadamy, zapisać to często na telefonie, bo telefon mamy przy sobie w kuchni. Co nie jest wygodne, jest czasochłonne i najczęściej kończy się tym, że porzucamy taki pomysł i gotujemy znowu nasz kolejny nudny obiad.

A co jeśli zbieranie informacji o tym, co posiadamy w naszej kuchni, byłoby proste, szybkie, bezbolesne, a także wyszukiwanie czy tworzenie nowych przepisów byłoby znacznie przyspieszone i ułatwione? Ułatwiając proces zbierania informacji, co posiadamy, oraz rekomendacji najlepszych przepisów do tego, co w danej chwili posiadamy w kuchni,znacznie zwiększamy szanse, że będziemy jeść ciekawiej, zdrowiej i smaczniej.

## Wymagania funkcjonalne
Stąd pomysł na aplikację która bedzie ułatwiała taki proces kreatywnego tworzenia przepisów na bazie posiadanych produktów. Ogólny zarys głownej funkcjonalności wyglądałby następująco.

1. Robimy zdjęcia tego, co mamy w lodówce, w szafkach, bądź tego, z czego po prostu chcielibyśmy ugotować posiłek.
2. Aplikacja analizuje zrobione zdjęcia pod kątem rozpoznania, jakie produkty na nich się znajdują oraz w jakiej ilości.
3. Jako wynik uzyskujemy listę produktów, które posiadamy w formie: *nazwa produktu* *ilość*.
4. Jesteśmy przez aplikację pytani, czy produkty zostały poprawnie rozpoznane, z możliwością wprowadzenia poprawek oraz dodania dodatkowych produktów, które, przykładowo, nie były na zdjęciach, a które wiemy, że mamy.
5. Następnie jesteśmy dopytywani o to, jaki rodzaj posiłku byśmy chcieli gotować: czy śniadanie, obiad, czy kolację, oraz w jakim stylu (orientalnym, meksykanskim, etc), które smaki preferujemy, etc.
6. Po zebraniu tych wszystkich informacji aplikacja generuje propozycje przepisu do wykonania.
7. Wynik pracy aplikacji jest nam prezentowany. Z możliwością dalszego i iteracyjnego doprecyzowywania osiągniętych wyników poprzez feedback użytkownika oraz powtórzenie generacji przepisu z uwzględnieniem jego uwag.
8. Jeśli jesteśmy zadowoleni z finalnego wyniku, możemy go zapisać, a następnie ugotować. Smacznego!

W ramach dodatkowych funkcjonalności wokół opisanej głównej, byłoby oczywiście:
1. Przeglądanie listy wcześniej wygenerowanych i zapamietanych przepisów.
2. Prezentowanie szczegółów zapamiętanego przepisu.
3. Usuwanie zapamiętanego przepisu, z którego nie jesteśmy już zadowoleni i nie chcemy go dłużej przechowywać.

## Wymagania niefunkcjonalne
1. Aplikacja byłaby zrealizowana jako aplikacja webowa z responsywnym UI-em, tak aby była wygodna do użytkowania na telefonie.
2. Aplikacja wymagałaby autentykacji. Wszystkie działania byłyby wykonywane w kontekście użytkownika, który musi się wcześniej zarejestrować i zalogować do aplikacji.
3. Dane przechowywane przez aplikację są per użytkownik. Są to jego prywatne dane i wymagają autoryzacji do odczytu. 

## Założenia architektoniczne.
W aplikacji rysują się dwa główne moduły. Pierwszy to moduł rozpoznawania oraz analizy obrazów, oraz drugi generacji przepisów. Moduły te powinny być zrealizowane jako niezależne paczki o dobrze zdefiniowanym API, kontrakcie.
Każdy z tych modułów może mieć wiele implementacji, które docelowo będą mogły być wymieniane w sposób transparentny dla działania całości rozwiązania.

## Zakres MVP
- Autentykacja bazująca na mechanizmie login(email) i hasło.
- Aplikacja przewiduje płaską strukturę użytkowników, tak więc nie będzie rozróżnienia, na admina oraz zwykłego użytkownika.
- Uproszczony mechanizm dodawania zdjęć, zaimplementowany jako przesyłanie plików w formularzu. Zaawansowane mobilne funkcje, takie jak robienie zdjęcia i dołączanie go do aplikacji, etc., są poza zakresem MVP.
- Moduł rozpoznawania produktów będzie bazował na mozliwościach wspolczesnych LLMow.
- Moduł generowania przepisu również będzie używał współczesnych modeli LLM.

## Zakres poza MVP
- Zaawansowany interfejs użytkownika na uządzeniach mobilnych, który pozwala na używanie kamery w ramach robienia zdjęć produktów.
- Współdzielenie przepisów pomiędzy użytkownikami.
- Share'owanie przepisów na social media.
- Generowanie przepisów inspirowanych konkretnymi blogami kulinarnymi czy przepisami znanych szefów kuchni.
- Generowanie przepisów na bazie third party API lub customowych baz z przepisami.