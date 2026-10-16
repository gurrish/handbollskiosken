# Handbollskiosken

Handbollskiosken visar ett automatiskt bildspel på en skärm vid handbollsplanen. Bildspelet kan innehålla uppladdade bilder eller länkar med rubrik och beskrivning. Endast e-postadresser i `GLOBAL_ADMIN_EMAILS` kan logga in och lägga till, ändra, visa/dölja eller ta bort innehåll.

## Teknik och lagring

- React, TypeScript och Vite.
- Azure Static Web Apps med integrerat Azure Functions-API.
- Azure Table Storage för bildspelsinnehåll och en privat Blob Storage-container för uppladdade bilder.
- Static Web Apps inbyggd Microsoft Entra ID-inloggning. API:et kontrollerar den betrodda Static Web Apps-identiteten och `GLOBAL_ADMIN_EMAILS` vid varje ändring.
- Bicep definierar Static Web App, Storage Account och Application Insights. Infrastrukturen distribueras manuellt en gång; GitHub Actions distribuerar webbplatsen och API:et.

Functions-API:et använder serverinställningen `STORAGE_CONNECTION_STRING` för lagring. Den skapas av Bicep och skickas aldrig till webbläsaren eller sparas i källkoden. Blob Storage är privat.

Bilder får vara JPEG, PNG eller WebP och högst 8 MB. API:et kontrollerar bildens faktiska signatur, inte bara filnamn eller webbläsarens MIME-typ. Länkinlägg visar den externa webbsidan inbäddad i bildspelet. Bildspelsinlägg kan visas i 5–120 sekunder. Inaktiva inlägg visas inte i bildspelet.

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

### 1. Skapa och distribuera infrastrukturen manuellt

- Skapa en Azure-resursgrupp.
- Kör Bicep-distributionen från en inloggad Azure CLI. Ange administratörsadresserna som en kommaavgränsad lista:

```powershell
az login
az deployment group create `
  --resource-group <resursgrupp> `
  --template-file infra/main.bicep `
  --parameters namePrefix=handbollskiosken globalAdminEmails="<admin-e-post>"
```

Infrastrukturen är en engångsmanuell distribution. Om Bicep-mallen eller infrastrukturen senare ändras, kör distributionen igen manuellt. Ändringar av `GLOBAL_ADMIN_EMAILS` görs också genom att distribuera Bicep på nytt.

Använd utdata `staticWebAppName` från distributionen för att hämta webbplatsens deployment-token:

```powershell
az staticwebapp secrets list --name <static-web-app-namn> --resource-group <resursgrupp> --query properties.apiKey --output tsv
```

Spara token som GitHub-hemligheten `SWA_DEPLOYMENT_TOKEN`. GitHub Actions använder den för att bygga och distribuera webbplatsen och API:et när programändringar skickas till `main`, eller när **Build and deploy application** startas manuellt. GitHub Actions distribuerar inte Azure-infrastrukturen och behöver inga Azure OIDC-hemligheter.

Logga in med en adress i `GLOBAL_ADMIN_EMAILS` för att hantera bildspelet. Webbplatsen använder Static Web Apps inbyggda `aad`-inloggning. Ingen egen identitetsleverantör är konfigurerad. Ange administratörsvariabeln innan redigering används.

### Azure-resurser och namn

Bicep definierar infrastrukturen som mall; resurser finns inte förrän den manuella distributionen har körts i Azure. `namePrefix` påverkar namn på Static Web App, Storage Account och Application Insights.

## API och åtkomst

- `GET /api/slides` returnerar aktiva bildspelsinlägg. Endast administratörer kan använda `GET /api/slides?all=true` för att även se dolda inlägg.
- `GET /api/slides/{id}/image` visar bilder för aktiva inlägg. Bilder från dolda inlägg kan endast hämtas av administratörer.
- `GET /api/me` rapporterar inloggningsstatus och om e-postadressen finns i administratörslistan.
- `POST /api/slides`, `PUT /api/slides/{id}` och `DELETE /api/slides/{id}` kräver en inloggad administratör.
- Bildspelsmetadata lagras i tabellen `KioskSlides`. Bilder lagras i den privata Blob-containern `kiosk-content`.

Publika visningar av bildspelet är avsiktliga. All ändring av innehåll kontrolleras på serversidan; en klientinskickad e-postadress eller roll används aldrig för behörighet.
