# Raport zależności procedur

MVP do analizy zależności procedur SQL Server z backendem `ASP.NET Core` i frontendem `Angular`.

## Zakres

- `POST /api/dependencies` buduje graf `nodes[]` / `edges[]`
- obsługuje zależności bezpośrednie i pośrednie
- nadaje flagę `RequiresPermissionCheck` według heurystyk:
  - inny schemat niż procedura startowa
  - inna baza niż procedura startowa
  - nierozwiązana zależność
  - obiekt pośredni typu `view` lub `procedure`
- eksportuje wynik jako `JSON` lub `CSV`

## Struktura

- `backend/` API `.NET 9`
- `frontend/` aplikacja `Angular 21`

## Uruchomienie

### Backend

```bash
dotnet restore RaportDependencies.slnx
dotnet run --project backend
```

Backend startuje na `http://localhost:5199`.

### Frontend

```bash
cd frontend
npm install
npm start
```

Frontend używa proxy do `http://localhost:5199`.

Przy `ng serve` / `npm start` proxy jest podpięte także w `angular.json`.
Jeżeli frontend jest uruchomiony lokalnie na innym porcie niż backend i bez proxy, klient automatycznie kieruje API na `http://localhost:5199/api`.
Backend dopuszcza skonfigurowane originy z `Cors:AllowedOrigins` oraz lokalne originy `localhost` / `127.0.0.1` na dowolnym porcie, więc niestandardowy port dev-servera nie blokuje testów lokalnych także poza profilem `Development`.

## Konfiguracja bazy

Development connection string jest ustawiony w:

- `backend/appsettings.Development.json`

Aktualna aplikacja wymaga działającej bazy `RaportDb` w lokalnym SQL Server.

Przygotowane skrypty:

- `sql/setup-raportdb-sa.sql` tworzy bazę i ustawia login `sa`
- `sql/seed-raportdb-demo.sql` dodaje demo tabele, widoki, funkcje, procedury, synonym oraz zależność `External` do `AnalyticsDb`

Kolejność uruchomienia:

```sql
:r sql/setup-raportdb-sa.sql
:r sql/seed-raportdb-demo.sql
```

## Przykładowy request

```json
{
  "procedures": [
    "dbo.usp_PenaltySummary",
    "dbo.usp_PenaltyDrilldown",
    "dbo.usp_RunNightlyPenaltyPipeline"
  ],
  "includeTransitive": true,
  "maxDepth": 5
}
```

Uwaga:

- `dbo.usp_PenaltyDrilldown` prowadzi do celowo nierozwiązanej zależności `security.ManualReviewBacklog`, żeby UI pokazał typ `Unknown`
- backend analizuje metadane zależności, nie wykonuje tych procedur

## Weryfikacja lokalna

Zostały sprawdzone:

- `dotnet build backend/backend.csproj`
- `dotnet test backend.tests/backend.tests.csproj`
- `npm run build`
- `GET /api/health`

Aktualny blocker środowiskowy:

- SQL Server odpowiada, ale login `sa` nie może otworzyć bazy `RaportDb`
- endpoint `POST /api/dependencies` zwraca wtedy kontrolowany `503` z komunikatem diagnostycznym
