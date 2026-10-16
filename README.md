# Handbollskiosken

Handbollskiosken visar ett automatiskt bildspel på en skärm vid handbollsplanen. Bildspelet kan innehålla uppladdade bilder eller länkar med rubrik och beskrivning. Endast e-postadresser i `GLOBAL_ADMIN_EMAILS` kan logga in och lägga till, ändra, visa/dölja eller ta bort innehåll.

## Teknik och lagring

- React, TypeScript och Vite.
- Azure Static Web Apps med integrerat Azure Functions-API.
- Azure Table Storage för bildspelsinnehåll och en privat Blob Storage-container för uppladdade bilder.
- Static Web Apps inbyggd Microsoft Entra ID-inloggning. API:et kontrollerar den betrodda Static Web Apps-identiteten och `GLOBAL_ADMIN_EMAILS` vid varje ändring.
- Bicep skapar Static Web App, Storage Account och Application Insights. GitHub Actions distribuerar webbplatsen och infrastrukturen med Azure OIDC.

Functions-API:et använder serverinställningen `STORAGE_CONNECTION_STRING` för lagring. Den skapas av Bicep och skickas aldrig till webbläsaren eller sparas i källkoden. Blob Storage är privat.

Bilder får vara JPEG, PNG eller WebP och högst 8 MB. API:et kontrollerar bildens faktiska signatur, inte bara filnamn eller webbläsarens MIME-typ. Bildspelsinlägg kan visas i 5–120 sekunder. Inaktiva inlägg visas inte i bildspelet.

## Lokal utveckling

Krav: Node.js 20+, npm, Azure Functions Core Tools v4 och Azurite.

1. Installera beroenden:

   ```powershell
   npm ci
   Set-Location api
   npm ci
   Set-Location ..
   ```

2. Installera och starta Azurite om det behövs:

   ```powershell
   npm install --global azurite
   azurite --silent --location .azurite
   ```

3. I en annan terminal, skapa lokala Functions-inställningar och starta API:et:

   ```powershell
   Copy-Item api/local.settings.example.json api/local.settings.json
   Set-Location api
   npm run build
   func start
   ```

4. Starta webbplatsen i ytterligare en terminal:

   ```powershell
   npm run dev
   ```

Öppna Vites lokala adress. Besök `/admin` och välj **Logga in**. Den lokala inloggningen frågar efter e-postadress; använd `admin@local.test`, som är administratör i exempelfilen. Lokal identitet fungerar bara när `DEV_AUTH=true` och `NODE_ENV` inte är `production`. Minneslagrad data försvinner när Functions-processen startas om.

För lokal lagring i Azure Storage, ange `STORAGE_MODE=table` och `STORAGE_CONNECTION_STRING` i den ej versionshanterade `api/local.settings.json`. Lägg aldrig in lokala autentiseringsuppgifter i källkoden.

Byggkontroller:

```powershell
npm run build
Set-Location api
npm run build
```

## Distribuera till Azure

### 1. Konfigurera Azure och GitHub

- Skapa en Azure-resursgrupp.
- Skapa en Entra-appregistrering/tjänsteprincipal för infrastrukturdistribution och ge den rollen Contributor på resursgruppen.
- Konfigurera dess federerade GitHub OIDC-uppgifter med utfärdare `https://token.actions.githubusercontent.com`, målgrupp `api://AzureADTokenExchange` och ämne `repo:<OWNER>/handbollskiosken:ref:refs/heads/main`.
- Lägg till GitHub-hemligheterna `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` och `SWA_DEPLOYMENT_TOKEN` (efter den första infrastrukturdistributionen).
- Lägg till GitHub-variablerna `AZURE_RESOURCE_GROUP` och `GLOBAL_ADMIN_EMAILS` (kommaavgränsade inloggningsadresser). `NAME_PREFIX` är valfri och standardvärdet är `handbollskiosken`.

Azure-inloggningen använder OIDC; skapa ingen Entra-klienthemlighet.

### 2. Distribuera infrastrukturen

Skicka en ändring under `infra/**` till `main`, eller starta **Deploy infrastructure** i GitHub Actions. För lokal distribution från en inloggad Azure CLI:

```powershell
az login
az deployment group create `
  --resource-group <resursgrupp> `
  --template-file infra/main.bicep `
  --parameters namePrefix=handbollskiosken globalAdminEmails=<admin-e-post>
```

Använd utdata `staticWebAppName` för att hämta deployment-token:

```powershell
az staticwebapp secrets list --name <static-web-app-namn> --resource-group <resursgrupp> --query properties.apiKey --output tsv
```

Spara token som GitHub-hemligheten `SWA_DEPLOYMENT_TOKEN`. Skicka sedan en programändring till `main` eller starta **Build and deploy application** för att publicera webbplats och API.

Logga in med en adress i `GLOBAL_ADMIN_EMAILS` för att hantera bildspelet. Webbplatsen använder Static Web Apps inbyggda `aad`-inloggning. Ingen egen identitetsleverantör är konfigurerad. Ange administratörsvariabeln innan redigering används.

### Azure-resurser och namn

Bicep distribuerar infrastrukturen som mall; resurser finns inte förrän den har körts i Azure. `namePrefix` påverkar namn på Static Web App, Storage Account och Application Insights.

## API och åtkomst

- `GET /api/slides` returnerar aktiva bildspelsinlägg. Endast administratörer kan använda `GET /api/slides?all=true` för att även se dolda inlägg.
- `GET /api/slides/{id}/image` visar bilder för aktiva inlägg. Bilder från dolda inlägg kan endast hämtas av administratörer.
- `GET /api/me` rapporterar inloggningsstatus och om e-postadressen finns i administratörslistan.
- `POST /api/slides`, `PUT /api/slides/{id}` och `DELETE /api/slides/{id}` kräver en inloggad administratör.
- Bildspelsmetadata lagras i tabellen `KioskSlides`. Bilder lagras i den privata Blob-containern `kiosk-content`.

Publika visningar av bildspelet är avsiktliga. All ändring av innehåll kontrolleras på serversidan; en klientinskickad e-postadress eller roll används aldrig för behörighet.
